#!/usr/bin/env node
'use strict';
/*
 * The content-quality gates must be incapable of passing on nothing.
 *
 * The defect this exists to prevent, reproduced in a sibling repo. Three
 * HARD_FAIL gates with blocksRelease:true - instruction-leak, empty-cells,
 * content-pattern - globbed for built *.html. dist/ was gitignored, and the
 * workflow ran validate:all BEFORE npm run build. So on every PR and every push
 * they walked an empty tree, examined zero pages, and exited 0. Three release
 * gates that were structurally incapable of failing, and nothing said so,
 * because a pass on zero items reads exactly like a pass on every item.
 *
 * The ordering half does not apply here, and that was established rather than
 * assumed: a fresh clone with no dist/ present, running validate:all with no
 * build first exactly as `Validate` does, was checked and the three gates
 * reported 277, 277 and 270 pages. They walk the committed pages/ tree and
 * exclude dist/ by name.
 *
 * This is the other half, and it is the durable one. Ordering is a property of a
 * workflow file that anyone can reorder; "cannot pass on zero" is a property of
 * the gate itself. Each gate is run here against a synthetic empty scan surface
 * and must exit non-zero. It is a faux-data trace, not an assertion about the
 * source: a gate rewritten to drop its zero-items guard fails here even if its
 * code still contains the words.
 *
 * The synthetic surface is a throwaway directory under the OS temp dir with the
 * repo's layout and no pages. Nothing in the real tree is touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fail } = require('../validation/protocol');

const root = path.resolve(__dirname, '..', '..');

// Every gate that walks published page content and blocks a release on what it
// finds. Discovered from the registry rather than listed, so a new content gate
// inherits the requirement.
const GATES = [
  { id: 'no-internal-instruction-leak', script: 'scripts/validators/validate_no_internal_instruction_leak.js' },
  { id: 'no-empty-table-cells', script: 'scripts/validators/validate_no_empty_table_cells.js' },
  { id: 'content-pattern-contract', script: 'scripts/validators/validate_content_pattern_contract.js' }
];

const errors = [];

// A repo-shaped directory with every input the gates need except pages.
//
// The gates resolve their scan root from __dirname, not from cwd - which is a
// good property, since it means no change of working directory can quietly point
// them at an empty tree. It also means running them with cwd set elsewhere
// proves nothing: they would still walk the real pages/. So the gate scripts and
// the _ops/ tree they require are copied into the surface, and each gate is
// executed from its copy, where __dirname/../.. resolves to the empty repo.
function emptySurface() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-gate-coverage-'));
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'artifacts', 'validation'), { recursive: true });
  for (const rel of ['.clarity', 'data', 'config', 'scripts', '_ops']) {
    const src = path.join(root, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, rel), { recursive: true });
  }
  if (!fs.existsSync(path.join(dir, 'scripts', 'validators'))) {
    fail('surface-build-failed: could not copy scripts/validators into the synthetic surface; the trace would be vacuous.');
  }
  return dir;
}

const surface = emptySurface();
let traced = 0;
try {
  for (const gate of GATES) {
    const abs = path.join(root, gate.script);
    const surfaceAbs = path.join(surface, gate.script);
    if (!fs.existsSync(abs)) {
      errors.push(`gate-missing: ${gate.script} does not exist, so ${gate.id} governs nothing.`);
      continue;
    }
    const run = spawnSync(process.execPath, [surfaceAbs], { cwd: surface, encoding: 'utf8' });
    traced += 1;
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    if (run.status === 0) {
      errors.push(
        `gate-passes-on-zero-pages: ${gate.id} exited 0 against a scan surface with no pages. It is structurally ` +
          'incapable of failing, and a green run tells nobody whether it examined 277 pages or none. Make it hard-fail ' +
          `when its scanned count is zero. Its output was: ${output.trim().slice(0, 300) || '(silent)'}`
      );
      continue;
    }
    if (!/examined-no-pages|scanned 0 files/i.test(output)) {
      errors.push(
        `gate-fails-for-the-wrong-reason: ${gate.id} exited ${run.status} on an empty surface but did not name the ` +
          `empty scan surface as the cause, so an on-call reader would chase the wrong thing. Output: ${output.trim().slice(0, 300)}`
      );
    }
  }
} finally {
  fs.rmSync(surface, { recursive: true, force: true });
}

if (!traced) fail('no-gates-traced: this check ran zero gates and proved nothing.');

// And the positive control: on the real tree each gate must examine a non-trivial
// number of pages. A gate that hard-fails on zero but only ever sees three pages
// is still not covering the library.
const EVIDENCE = {
  'no-internal-instruction-leak': ['artifacts/validation/internal-instruction-leak.json', 'filesScanned'],
  'no-empty-table-cells': ['artifacts/validation/empty-table-cells.json', 'filesScanned'],
  'content-pattern-contract': ['artifacts/validation/content-pattern-contract.json', 'pagesChecked']
};
const publishedPages = fs.existsSync(path.join(root, 'pages'))
  ? (function count(dir) {
      let total = 0;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) total += count(path.join(dir, entry.name));
        else if (entry.name.endsWith('.html')) total += 1;
      }
      return total;
    })(path.join(root, 'pages'))
  : 0;
if (!publishedPages) fail('no-pages-in-repo: pages/ holds no HTML, so the positive control examined nothing.');

const coverage = [];
for (const [id, [rel, field]] of Object.entries(EVIDENCE)) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    errors.push(`no-evidence-artifact: ${id} wrote no ${rel}, so its coverage cannot be audited after the fact.`);
    continue;
  }
  let scanned = 0;
  try {
    scanned = Number(JSON.parse(fs.readFileSync(abs, 'utf8'))[field]) || 0;
  } catch {
    errors.push(`unreadable-evidence: ${rel} is not valid JSON.`);
    continue;
  }
  coverage.push(`${id}=${scanned}`);
  if (scanned < publishedPages / 2) {
    errors.push(
      `gate-covers-too-little: ${id} last examined ${scanned} of the ${publishedPages} HTML page(s) under pages/. ` +
        'A gate covering under half the library is closer to inert than to enforcing.'
    );
  }
}

if (errors.length) fail(errors);

console.log(
  `Content gate coverage OK (${traced} release-blocking content gate(s) traced against a synthetic empty scan ` +
    `surface - each exited non-zero naming the empty surface, so none can pass having checked nothing; on the real ` +
    `tree they cover ${coverage.join(', ')} of ${publishedPages} HTML page(s) under pages/).`
);
