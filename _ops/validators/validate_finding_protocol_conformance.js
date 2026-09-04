#!/usr/bin/env node
/**
 * Every registered validator that CLAIMS to report through the finding protocol
 * must actually be able to.
 *
 * Why this exists
 * ---------------
 * `_ops/validation/run_validation_matrix.js` tells two very different things
 * apart by exactly one signal: the string `VALIDATION_FINDING` on the child's
 * output.
 *
 *   marker + exit 1   -> the validator FOUND something. Report it at the
 *                        severity the registry assigns, name the finding.
 *   no marker, exit 1 -> the validator did not COMPLETE. "Validator exited 1
 *                        without the registered finding protocol." An
 *                        EXECUTION HARD FAIL - i.e. the validator is broken.
 *
 * Every check in `_repo_validation_registry.json` declares
 * `"findingProtocol": "VALIDATION_FINDING"`. Nothing ever checked that the
 * declaration was TRUE, and for eight checks it was not: they reported real
 * findings with a bare `console.error` and `process.exit(1)`.
 *
 * That is not a cosmetic difference. On 2026-09-04 the Social Ingestion lane on
 * main went red with "Hard fail findings: 0 / Execution hard fail: 1". The
 * summary said no check had found anything and one validator was broken. Both
 * halves were false: `discovery-gap-contract` had correctly found four
 * ungoverned queries and said so in plain English, and the orchestrator threw
 * that diagnosis away and relabelled it a crash. An execution hard fail sends
 * whoever is paged looking for a missing dependency or a bad environment. The
 * misdiagnosis is the recurring cost, and it recurs because the registry's claim
 * was never verified.
 *
 * What it asserts
 * ---------------
 *  1. STATIC. Every enabled check declaring the protocol can emit the marker -
 *     either the shared module is reachable in its local module graph, or it
 *     emits the marker literally - and every non-zero `process.exit` site in the
 *     entrypoint is reached through an emission.
 *  2. BEHAVIOURAL, on a real validator. `validate_discovery_gap.js` is driven to
 *     a genuine failure against a fixture repo and must exit 1 WITH the marker.
 *     If the fixture fails to provoke a failure at all, that is a hard fail too -
 *     a probe that proves nothing is worse than no probe.
 *  3. BEHAVIOURAL, on the consequence. The real orchestrator is run over two
 *     fixture validators, identical but for the marker, and must classify them
 *     differently: HARD_FAIL vs EXECUTION_HARD_FAIL. This is what makes (1) and
 *     (2) worth asserting.
 *
 * Hard-fails if it examines zero checks, zero exit sites, or runs zero probes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { emitFinding, FINDING_MARKER } = require('../validation/protocol');

const root = process.cwd();
const problems = [];
const fail = (m) => problems.push(m);

const PROTOCOL = path.normalize('_ops/validation/protocol.js');

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch (error) {
    fail(`unreadable JSON: ${rel} (${error.message})`);
    return null;
  }
}

/** Local (relative) module graph of a file. Package imports are not followed. */
function moduleGraph(rel, seen = new Set()) {
  const full = path.join(root, rel);
  if (seen.has(rel) || !fs.existsSync(full)) return seen;
  seen.add(rel);
  const text = fs.readFileSync(full, 'utf8');
  for (const match of text.matchAll(/(?:require\(|from\s+)['"](\.[^'"]+)['"]/g)) {
    const base = path.normalize(path.join(path.dirname(rel), match[1]));
    for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, path.join(base, 'index.js')]) {
      if (fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile()) {
        moduleGraph(candidate, seen);
        break;
      }
    }
  }
  return seen;
}

/**
 * Blank out comments and string/template literals, preserving line numbers and
 * newlines so reported line numbers stay true.
 *
 * Necessary because validators legitimately CONTAIN the text `process.exit(1)`
 * without executing it: this file writes fixture validators as string literals,
 * validate_orchestrator_contract.js does the same, and several validators quote
 * an exit in a comment while explaining themselves. Scanning raw text reports
 * those as unguarded exit sites, which is a false positive - and a guard that
 * cries wolf gets switched off, which is how the defect it watches comes back.
 */
function stripNonCode(source, { keepStrings = false } = {}) {
  let out = '';
  let i = 0;
  let quote = null;      // "'", '"' or '`' while inside a string
  let comment = null;    // 'line' or 'block' while inside a comment
  let regex = false;     // inside a /.../ literal
  let charClass = false; // inside a [...] within a regex, where / is literal
  let lastCode = '';     // last significant code character emitted

  // Regex-or-division. A `/` opens a regex only where a VALUE may begin. This
  // matters concretely: validate_discovery_gap.js contains
  // `src.match(/^const\s+TARGETS\s*=\s*'([^']+)'/m)`, and treating that
  // apostrophe as a string opener silently swallowed the rest of the file -
  // including three real `process.exit(1)` sites, which this guard would then
  // never have examined. A guard blinded by its own parser is worse than none.
  const opensValue = (c) => c === '' || '(,=:[!&|?{};+-*%~^<>'.includes(c);

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (comment === 'line') {
      if (ch === '\n') { comment = null; out += ch; } else out += ' ';
      i++;
      continue;
    }
    if (comment === 'block') {
      if (ch === '*' && next === '/') { comment = null; out += '  '; i += 2; continue; }
      out += ch === '\n' ? ch : ' ';
      i++;
      continue;
    }
    if (quote) {
      if (ch === '\\') { out += keepStrings ? source.slice(i, i + 2) : '  '; i += 2; continue; }
      if (ch === quote) { quote = null; out += keepStrings ? ch : ' '; i++; continue; }
      out += (keepStrings || ch === '\n') ? ch : ' ';
      i++;
      continue;
    }
    if (regex) {
      if (ch === '\\') { out += '  '; i += 2; continue; }
      if (ch === '\n') { regex = false; charClass = false; out += ch; i++; continue; }
      if (ch === '[') charClass = true;
      else if (ch === ']') charClass = false;
      else if (ch === '/' && !charClass) { regex = false; out += ' '; i++; continue; }
      out += ' ';
      i++;
      continue;
    }
    if (ch === '/' && next === '/') { comment = 'line'; out += '  '; i += 2; continue; }
    if (ch === '/' && next === '*') { comment = 'block'; out += '  '; i += 2; continue; }
    if (ch === '/' && opensValue(lastCode)) { regex = true; charClass = false; out += ' '; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += keepStrings ? ch : ' '; i++; continue; }
    out += ch;
    if (!/\s/.test(ch)) lastCode = ch;
    i++;
  }
  return out;
}

/**
 * Which protocol emitters this file actually imported. Matters because a local
 * `const fail = (m) => problems.push(m)` collects a message; it does not emit
 * one. Only an identifier bound to the shared module counts.
 */
function importedEmitters(text) {
  const names = new Set();
  const re = /(?:require\(|from\s+)['"][^'"]*validation\/protocol(?:\.js)?['"]/;
  for (const line of text.split('\n')) {
    if (!re.test(line)) continue;
    const braces = line.match(/\{([^}]*)\}/);
    if (!braces) continue;
    for (const raw of braces[1].split(',')) {
      const name = raw.split(':').pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

// ------------------------------------------------------------------ (1) static
const registry = readJson('_repo_validation_registry.json') || { checks: [] };
const declaring = (registry.checks || []).filter(
  (check) => check && check.enabled !== false && check.findingProtocol === FINDING_MARKER
);

let examined = 0;
let exitSites = 0;
for (const check of declaring) {
  const rel = check.entrypoint;
  if (!rel || !fs.existsSync(path.join(root, rel))) {
    fail(`${check.id}: registered entrypoint ${rel} does not exist.`);
    continue;
  }
  examined++;
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const graph = [...moduleGraph(rel)].map((f) => path.normalize(f));
  const viaModule = graph.includes(PROTOCOL);
  const viaLiteral = text.includes(FINDING_MARKER);

  if (!viaModule && !viaLiteral) {
    fail(
      `${check.id} (${rel}) declares findingProtocol "${FINDING_MARKER}" but cannot emit it: `
      + `it neither reaches ${PROTOCOL} nor writes the marker itself. Any finding it reports would be `
      + `relabelled an EXECUTION HARD FAIL - a broken validator - and its actual diagnosis discarded.`
    );
  }

  const emitters = new Set(['emitFinding']);
  if (viaModule) for (const name of importedEmitters(text)) emitters.add(name);

  const lines = text.split('\n');
  // Exit sites are located in CODE only; the emission window is read from the
  // original source, because a literal marker emission is itself a string.
  const codeLines = stripNonCode(text).split('\n');
  // The emission window keeps strings - a literal `console.log('VALIDATION_FINDING
  // check=x')` IS the emission - but drops comments. A comment that merely
  // MENTIONS the marker is not an emission, and letting one vouch for an exit
  // site is how a reverted validator slipped past the static rule.
  const windowLines = stripNonCode(text, { keepStrings: true }).split('\n');
  for (let i = 0; i < codeLines.length; i++) {
    for (const match of codeLines[i].matchAll(/process\.exit\(\s*([^)\s]+)\s*\)/g)) {
      if (match[1] === '0') continue;
      exitSites++;
      const window = windowLines.slice(Math.max(0, i - 8), i + 1).join('\n');
      const emits = window.includes(FINDING_MARKER)
        || [...emitters].some((name) => window.includes(`${name}(`));
      if (!emits) {
        fail(
          `${check.id} (${rel}:${i + 1}) exits ${match[1]} without emitting ${FINDING_MARKER} first. `
          + `Whatever it found on that path is reported to the operator as a crashed validator.`
        );
      }
    }
  }
}

if (examined === 0) {
  fail(`no registered check declares findingProtocol "${FINDING_MARKER}" - this guard examined nothing and must not pass on an empty loop.`);
}
if (exitSites === 0) {
  fail('found zero non-zero process.exit sites across every registered validator - the exit-site rule examined nothing, so it proves nothing.');
}

// -------------------------------------------- (2) behavioural, a real validator
//
// A static rule about where a marker appears in a file is not proof that the
// marker reaches the orchestrator. Drive a real registered validator to a real
// failure and read what it actually writes.
let probes = 0;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-finding-protocol-'));
try {
  for (const rel of [
    '_ops/validation/protocol.js',
    '_ops/validators/validate_discovery_gap.js',
    'scripts/lib/demand_titles.js',
    'scripts/queries/score_discovery_gap.mjs',
    'package.json',
    '_repo_validation_registry.json',
    '_repo_validation_matrix.json'
  ]) {
    const target = path.join(sandbox, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, rel), target);
  }
  fs.mkdirSync(path.join(sandbox, '.github', 'workflows'), { recursive: true });
  for (const workflow of fs.readdirSync(path.join(root, '.github', 'workflows'))) {
    fs.copyFileSync(path.join(root, '.github', 'workflows', workflow), path.join(sandbox, '.github', 'workflows', workflow));
  }

  // One bare "near me" target, governed by nothing. This is precisely the state
  // that turned the 2026-09-04 ingestion run red.
  fs.mkdirSync(path.join(sandbox, 'data', 'search'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'data', 'search', 'target_queries.json'), JSON.stringify({
    schemaVersion: 'fixture',
    queries: [{
      query: 'fixture therapist near me',
      intent: 'observed',
      primaryPage: '/',
      occupancy: { verdict: 'UNRESOLVABLE_WITHOUT_LOCATION', openness_score: null },
      blue_ocean_eligible: { eligible: true, reason: 'FIXTURE' }
    }]
  }, null, 2));

  const probe = spawnSync(process.execPath, ['_ops/validators/validate_discovery_gap.js'], {
    cwd: sandbox,
    encoding: 'utf8'
  });
  probes++;
  const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  if (probe.status === 0) {
    fail(
      'the behavioural probe did not provoke a failure in validate_discovery_gap.js: an ungoverned bare '
      + '"near me" target passed. Either the governance rule was weakened, or this probe no longer tests anything.'
    );
  } else if (!output.includes(FINDING_MARKER)) {
    fail(
      `validate_discovery_gap.js failed on a real finding without emitting ${FINDING_MARKER}. The orchestrator `
      + `will report it as an execution hard fail - "the validator is broken" - and discard the diagnosis. `
      + `This is the exact regression that blocked main on 2026-09-04.\n${output.trim().slice(0, 600)}`
    );
  }

  // ------------------------------------ (3) behavioural, the consequence
  //
  // Two fixture validators, identical but for the marker, through the REAL
  // orchestrator. If these are ever classified the same way, the marker has
  // stopped meaning anything and everything above is decoration.
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-finding-protocol-arena-'));
  const write = (rel, content) => {
    const target = path.join(arena, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  fs.mkdirSync(path.join(arena, '_ops', 'validation'), { recursive: true });
  for (const rel of ['_ops/validation/run_validation_matrix.js', '_ops/validation/protocol.js']) {
    fs.copyFileSync(path.join(root, rel), path.join(arena, rel));
  }
  write('_ops/validators/validate_validation_registry.js', "console.log('fixture registry ok');\n");
  write('_ops/validators/conforming.js', `console.error('${FINDING_MARKER} check=conforming');\nconsole.error('fixture finding');\nprocess.exit(1);\n`);
  write('_ops/validators/bare.js', "console.error('fixture finding');\nprocess.exit(1);\n");

  const fixtureChecks = [
    { id: 'validation-registry', entrypoint: '_ops/validators/validate_validation_registry.js', severity: 'HARD_FAIL', blocksRelease: true },
    { id: 'conforming', entrypoint: '_ops/validators/conforming.js', severity: 'HARD_FAIL', blocksRelease: true },
    { id: 'bare', entrypoint: '_ops/validators/bare.js', severity: 'HARD_FAIL', blocksRelease: true }
  ].map((entry) => ({
    npmScript: `validate:${entry.id}`,
    group: 'fixture',
    owner: 'fixture',
    scope: 'fixture',
    ciInvocation: 'MATRIX_ONLY',
    findingProtocol: FINDING_MARKER,
    enabled: true,
    rationale: 'fixture',
    ...entry
  }));
  write('_repo_validation_registry.json', JSON.stringify({
    schemaVersion: 'fixture',
    repo: 'finding-protocol-fixture',
    policy: { findingMarker: FINDING_MARKER },
    checks: fixtureChecks
  }, null, 2));
  write('_repo_validation_matrix.json', JSON.stringify({
    schemaVersion: 'fixture',
    registry: '_repo_validation_registry.json',
    profiles: { all: { checks: fixtureChecks.map((c) => c.id) } }
  }, null, 2));

  for (const [id, expected] of [['conforming', 'HARD FAIL  conforming'], ['bare', 'EXECUTION HARD FAIL  bare']]) {
    const run = spawnSync(process.execPath, ['_ops/validation/run_validation_matrix.js', '--check', id], {
      cwd: arena,
      encoding: 'utf8'
    });
    probes++;
    const combined = `${run.stdout || ''}\n${run.stderr || ''}`;
    if (!combined.includes(expected)) {
      fail(
        `the orchestrator no longer classifies the "${id}" fixture as "${expected}". A validator that emits the `
        + `marker and one that does not are being treated the same, so a real finding and a crashed validator are `
        + `indistinguishable to whoever is paged.\n${combined.trim().slice(0, 600)}`
      );
    }
  }
  fs.rmSync(arena, { recursive: true, force: true });
} catch (error) {
  fail(`behavioural probe could not run: ${error.message}`);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

if (probes === 0) {
  fail('ran zero behavioural probes - the static rules above are unproven and this guard must not pass having executed nothing.');
}

if (problems.length) {
  emitFinding(
    ['Finding-protocol conformance FAILED:', ...problems.map((p) => `  - ${p}`)],
    { summary: `non-conforming-validator(s)=${problems.length}` }
  );
  process.exit(1);
}

// NB: this success line must never contain the marker literal. The orchestrator
// scans a validator's whole output for it, so a passing run that prints it is
// read as a finding - which is how this guard first reported itself as a HARD
// FAIL whose only text was the word "OK".
console.log(
  `Finding-protocol conformance OK: ${examined} registered validator(s) declare the finding protocol and every one can emit it; `
  + `${exitSites} non-zero exit site(s) all reached through an emission; ${probes} behavioural probe(s) run - `
  + 'validate_discovery_gap.js driven to a real failure emitted the marker, and the real orchestrator still separates '
  + 'a marked finding (HARD FAIL) from an unmarked one (EXECUTION HARD FAIL).'
);
