#!/usr/bin/env node
'use strict';
// No published page may ship a table with empty cells.
//
// An empty <td></td> is a generator that ran out of data mid-row and emitted the
// cell anyway. To a reader it is a blank box; to an answer engine it is a
// malformed table whose columns no longer line up with their headers, so the
// whole table becomes unusable as an extractable fact source. A sibling repo
// shipped 257 pages in this state.
//
// A cell holding &nbsp;, a dash, or "n/a" is a deliberate authored placeholder
// and passes: this only catches cells with nothing in them at all.
//
// Same exemptions as the instruction-leak guard: dist/ is the build mirror of
// pages/, and data/, reports/ and _ops/ are operator surfaces rather than
// published pages. Findings go through the VALIDATION_FINDING protocol.

const fs = require('fs');
const path = require('path');
const { fail } = require('../../_ops/validation/protocol');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/empty-table-cells.json');
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates',
  'dist', '_ops', 'coverage',
]);

// <td>, <td class="x">, <td></td> and <td>\n  </td> all count as empty.
const EMPTY_CELL = /<(td|th)\b[^>]*>\s*<\/\1>/gi;

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
    const matches = fs.readFileSync(abs, 'utf8').match(EMPTY_CELL);
    if (matches) offenders.push({ path: path.relative(ROOT, abs), emptyCells: matches.length });
  }
})(ROOT);

const totalCells = offenders.reduce((sum, o) => sum + o.emptyCells, 0);
fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schemaVersion: '1.0.0',
  validator: 'no-empty-table-cells',
  generatedAt: new Date().toISOString(),
  status: offenders.length ? 'FAIL' : 'PASS',
  filesScanned: scanned,
  offenderCount: offenders.length,
  emptyCellCount: totalCells,
  offenders: offenders.slice(0, 200),
}, null, 2)}\n`);

if (offenders.length) {
  const lines = [`${offenders.length} published page(s) ship ${totalCells} empty table cell(s).`];
  for (const o of offenders.slice(0, 15)) lines.push(`- ${o.path} :: ${o.emptyCells} empty cell(s)`);
  if (offenders.length > 15) lines.push(`- ...and ${offenders.length - 15} more`);
  lines.push('- remedy: omit the row, or fill the cell with real content.');
  fail(lines.join('\n'));
}
console.log(`No empty table cells: ${scanned} published pages contain no empty <td>/<th>.`);
