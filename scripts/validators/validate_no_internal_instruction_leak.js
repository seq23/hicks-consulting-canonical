#!/usr/bin/env node
'use strict';
// No published page may contain internal build instructions.
//
// The external review agent sends recommendations as build directives shaped like
//   "FILEPATH: x || CURRENT: ... || MISSING: ... || EDIT: ..."
// In a sibling repo two generator paths rendered those as reader-facing copy: a
// fallback "acceptance checklist" card, and target.answer via
// "Citation-ready update: ". 163 published pages carried the first and 100 the
// second - the second inside the direct-answer block, which is the exact text an
// answer engine extracts.
//
// It also explains a reported symptom: the agent kept re-flagging pages marked
// released, because it was reading its own instruction back off the page instead
// of the content it asked for.
//
// This repo runs the same shape of loop (scripts/autonomy/run_self_heal_cycle
// and scripts/search/apply_bounded_search_repairs write page copy from agent
// output), so the same defect is possible here.
//
// dist/ is skipped: scripts/site_build.js copies it wholesale from pages/, which
// is scanned, so scanning both would double-report the same defect. data/,
// reports/ and _ops/ hold the agent's own queues, freeze snapshots and
// recommendations and are supposed to contain this text.
//
// Findings are emitted through the registered VALIDATION_FINDING protocol so the
// matrix runner can classify them; anything else on stderr is an execution fault.

const fs = require('fs');
const path = require('path');
const { fail } = require('../../_ops/validation/protocol');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/internal-instruction-leak.json');
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates',
  'dist', '_ops', 'coverage',
]);

const PATTERNS = [
  [/FILEPATH:/, 'raw agent recommendation (FILEPATH:)'],
  [/\|\|\s*(CURRENT|MISSING|EDIT)\s*:/i, 'raw agent recommendation field separator'],
  [/Citation-ready update:/i, 'instruction appended to the answer block'],
  [/Marker-only framework cards/i, 'build policy text rendered as page copy'],
  [/Required semantic acceptance:/i, 'build policy text rendered as page copy'],
];

const offenders = [];
let scanned = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(abs);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    scanned += 1;
    const html = fs.readFileSync(abs, 'utf8');
    const rel = path.relative(ROOT, abs);
    for (const [re, why] of PATTERNS) {
      if (re.test(html)) { offenders.push({ path: rel, reason: why }); break; }
    }
  }
})(ROOT);

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schemaVersion: '1.0.0',
  validator: 'no-internal-instruction-leak',
  generatedAt: new Date().toISOString(),
  status: offenders.length ? 'FAIL' : 'PASS',
  filesScanned: scanned,
  offenderCount: offenders.length,
  offenders: offenders.slice(0, 200),
}, null, 2)}\n`);

if (offenders.length) {
  const lines = [`${offenders.length} published page(s) contain internal build instructions.`];
  for (const o of offenders.slice(0, 15)) lines.push(`- ${o.path} :: ${o.reason}`);
  if (offenders.length > 15) lines.push(`- ...and ${offenders.length - 15} more`);
  lines.push('- remedy: publish the requested content, never the recommendation text that asked for it.');
  fail(lines.join('\n'));
}
console.log(`No internal instruction leak: ${scanned} published pages contain no build directives.`);
