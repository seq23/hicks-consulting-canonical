#!/usr/bin/env node
// Validate -> repair -> re-validate, until clean or out of attempts.
//
// Why this exists
// ---------------
// This repo already owned repairs for several of its own defects - the ingestion
// builders that write the exact artifacts four ingestion checks inspect, the
// continuity replenisher that writes the exact report the continuity check reads,
// the authority builders behind the recommendation and distribution manifests.
// None of them were wired to the validator that detects the defect they fix, so a
// failing run stopped and waited for a human even when the remedy was one npm
// script away.
//
// This runs the registered validation matrix, reads which checks reported
// findings, runs the repair each one declares in _repo_validation_registry.json
// (`repair_command`), and re-validates. It stops early when clean, and stops when
// a pass produces no repair it has not already tried - looping again would just
// repeat the same result.
//
//   node _ops/selfheal/heal_until_clean.js [--profile all] [--max 3] [--dry-run]
//
// Exit 0 means the matrix is green and it is safe to push. Non-zero means it is
// not, and the report names what could not be healed and why.
//
// Placed under _ops/ because that is where this repo keeps validation and release
// governance tooling; scripts/ holds build, content, and autonomy runtime code.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PROFILE = arg('--profile', 'all');
const MAX = Math.max(1, Math.min(5, Number(arg('--max', '3')) || 3));
const DRY = argv.includes('--dry-run');
const REPORT = path.join(root, 'reports', 'self-heal-loop.json');

const registry = JSON.parse(fs.readFileSync(path.join(root, '_repo_validation_registry.json'), 'utf8'));
const repairFor = new Map(
  (registry.checks || [])
    .filter((check) => check.repair_command)
    .map((check) => [check.id, check.repair_command])
);
const severityOf = new Map((registry.checks || []).map((check) => [check.id, check.severity]));

function run(cmd) {
  const started = Date.now();
  const result = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', stdio: 'inherit' });
  return { cmd, code: result.status === null ? 1 : result.status, ms: Date.now() - started };
}

// The matrix runner writes this; prefer it over parsing console output, which
// changes shape between validators.
function findingsFromSummary() {
  const slug = `profile-${PROFILE}`;
  const candidates = [
    path.join(root, '.tmp', 'validation', `validation-summary-${slug}.json`),
    path.join(root, '.tmp', 'validation', 'validation-summary-latest.json')
  ];
  for (const file of candidates) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (doc.selection === `profile=${PROFILE}`) return doc.findings || [];
    } catch {
      // try the next one
    }
  }
  return null;
}

const attempts = [];
const alreadyTried = new Set();
let clean = false;
let lastFindings = [];
let summaryMissing = false;

for (let attempt = 1; attempt <= MAX; attempt += 1) {
  console.log(`\n[self-heal] attempt ${attempt}/${MAX}: validating (profile ${PROFILE})`);
  const validate = run(`node _ops/validation/run_validation_matrix.js --profile ${PROFILE}`);
  const findings = findingsFromSummary();
  if (findings === null) {
    summaryMissing = true;
    console.error('[self-heal] no machine-readable validation summary was produced; cannot identify failing checks.');
  }
  lastFindings = findings || [];

  const repairableNow = lastFindings
    .map((f) => f.id)
    .filter((id) => repairFor.has(id));
  const untried = repairableNow.filter((id) => !alreadyTried.has(id));
  const unrepairable = lastFindings.map((f) => f.id).filter((id) => !repairFor.has(id));

  // `clean` is the repo's own release gate: HARD_FAIL and execution failures block,
  // warnings do not. Do not invent a stricter gate than the registry declares.
  clean = validate.code === 0;

  console.log(`[self-heal] attempt ${attempt}: exit ${validate.code}, ${lastFindings.length} finding(s), `
    + `${untried.length} with an untried repair`);
  for (const id of unrepairable) console.log(`  no registered repair: ${id}`);
  for (const id of repairableNow.filter((id) => alreadyTried.has(id))) {
    console.log(`  repair already attempted and did not clear: ${id}`);
  }

  if (!untried.length) {
    // Nothing left to change, so another pass would produce the same result. Stop
    // and say so rather than burning attempts to reach the same place.
    attempts.push({
      attempt,
      validation_exit: validate.code,
      findings: lastFindings,
      repaired: [],
      result: clean ? 'CLEAN' : (summaryMissing ? 'NO_SUMMARY_AVAILABLE' : 'NO_REPAIR_AVAILABLE')
    });
    if (clean) console.log(`[self-heal] clean on attempt ${attempt} (${lastFindings.length} non-blocking finding(s))`);
    break;
  }

  if (attempt === MAX) {
    // Repairing now would leave the result unverified: there is no attempt left to
    // re-validate in. Report honestly instead of implying the repairs worked.
    attempts.push({
      attempt,
      validation_exit: validate.code,
      findings: lastFindings,
      repaired: [],
      result: clean ? 'CLEAN' : 'ATTEMPTS_EXHAUSTED',
      note: `${untried.length} repair(s) still untried; raise --max to run them.`
    });
    break;
  }

  // Repairs run for any check that reported a finding, warnings included: this
  // repo classes STRONG_WARNING as a defect requiring prompt repair, so healing it
  // while we are here is the point. Only `clean` keys off the blocking gate.
  const repaired = [];
  for (const id of untried) {
    const cmd = repairFor.get(id);
    alreadyTried.add(id);
    if (DRY) {
      console.log(`  would repair ${id}: ${cmd}`);
      repaired.push({ id, cmd, dry_run: true });
      continue;
    }
    console.log(`  repairing ${id}: ${cmd}`);
    const r = run(cmd);
    if (r.code !== 0) console.log(`  repair FAILED for ${id} (exit ${r.code})`);
    repaired.push({ id, cmd, code: r.code });
  }
  attempts.push({
    attempt,
    validation_exit: validate.code,
    findings: lastFindings,
    repaired,
    result: DRY ? 'WOULD_REPAIR' : 'REPAIRED_RETRYING'
  });
  if (DRY) break;
}

const report = {
  schema_version: '1.0',
  repo: registry.repo,
  profile: PROFILE,
  max_attempts: MAX,
  dry_run: DRY,
  generated_at: new Date().toISOString(),
  status: clean ? 'CLEAN' : 'NOT_CLEAN',
  safe_to_push: clean,
  registered_repairs: [...repairFor.entries()].map(([id, cmd]) => ({
    id,
    severity: severityOf.get(id) || 'UNKNOWN',
    repair_command: cmd
  })),
  // Everything still reporting a finding after the last pass, blocking or not, so a
  // green run still shows what it could not clear rather than hiding it.
  remaining_findings: lastFindings.map((f) => ({
    id: f.id,
    severity: f.severity,
    blocking: f.severity === 'HARD_FAIL' || f.severity === 'EXECUTION_HARD_FAIL',
    repair_command: repairFor.get(f.id) || null
  })),
  attempts
};
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

if (!clean) {
  console.error(`\n[self-heal] NOT CLEAN after ${attempts.length} attempt(s) - refusing to declare the tree publishable.`);
  console.error('  see reports/self-heal-loop.json');
  process.exit(1);
}
console.log('\n[self-heal] safe to push');
console.log('  see reports/self-heal-loop.json');
