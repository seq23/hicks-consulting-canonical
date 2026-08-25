#!/usr/bin/env node
'use strict';
// Enforce the blocks the external review agent keeps asking for.
//
// Across ~2,750 recommendations audited on two sibling sites, the agent asks for
// the same small set of things over and over. 27% of distinct defects were
// re-reported on later runs despite being marked released - the same page
// missing the same block, found again. This measures those blocks before
// publish instead of after audit.
//
// Derived from the recommendations themselves (.clarity/content-pattern-spec.json):
//
//   1 checklist / numbered protocol      730 occurrences (36.4%)
//   2 comparison / decision / cost table 529 (26.4%)
//   3 direct-answer block                512 (25.5%)
//   5 concrete numbers                   365 (18.2%)
//   6 named primary sources              288 (14.3%)
//   7 query present in a heading         261 (13.0%)
//   9 FAQ block                          136 (6.8%)
//  10 structured data                     70 (3.5%)
//
// Severity is split. The blocks that decide whether a page can be quoted at all
// are marked blocking; the rest report as gaps.
//
// This check is registered STRONG_WARNING, not HARD_FAIL. The first run measured
// 7 pages with no approved conversion path - the whole llm-atlas/ machine-surface
// family. Closing that would mean editing published page copy, which this repo
// does not permit from tooling work, so the count is reported by name rather
// than hidden by a weakened check. Promote to HARD_FAIL once the blocking count
// reaches zero.
//
// Same scan surface as the other content-governance guards: published copy under
// pages/. dist/ is the build mirror of the same source. Findings go through the
// VALIDATION_FINDING protocol; nothing is written to stderr without it.

const fs = require('fs');
const path = require('path');
const { warn } = require('../../_ops/validation/protocol');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/content-pattern-contract.json');
const ENFORCEMENT = 'report'; // 'block' | 'report'
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates',
  'dist', '_ops', 'coverage',
]);
// Legal boilerplate answers no search query.
const SKIP_FILES = new Set([
  'pages/disclaimer/index.html',
  'pages/privacy-policy/index.html',
  'pages/cookie-policy/index.html',
  'pages/terms/index.html',
]);

// Archive indexes are navigational, not query-answering: "Articles", "Guides"
// and "Insights" are the correct h1 there. Content pages have no such excuse -
// a topic-label h1 carries none of the phrasing a person typed, which is the
// agent's #7 recurring finding.
const NAV_INDEXES = new Set([
  'pages/resources/index.html',
  'pages/resources/articles/index.html',
  'pages/resources/guides/index.html',
  'pages/resources/insights/index.html',
]);

// The repo's own approved conversion destinations, read from the same source
// _ops/validators/validate_conversion_contract.js reads so the two cannot drift.
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/system/config.json'), 'utf8'));
const forms = config.forms || {};
const CONVERSION_TARGETS = [
  forms.therapy, forms.coaching, forms.corporate, forms.groups,
  '/intake-quiz/', '/request-consult/', '/book-discovery-call/',
  '/organizational-training-inquiry/',
].filter(Boolean);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CONVERSION = new RegExp(CONVERSION_TARGETS.map(escape).join('|'), 'i');
// clientsecure.me is the booking destination, not a cited source; fonts and
// schema.org are assets. None of them may satisfy the named-source check.
const EXTERNAL_SOURCE = /<a[^>]+href="https?:\/\/(?!(?:www\.)?hicksconsulting\.org)(?!monika-hicks\.clientsecure\.me)(?!fonts\.(?:googleapis|gstatic)\.com)(?!schema\.org)/i;

const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const CHECKS = [
  { id: 'direct_answer', blocking: true,
    // This repo's direct-answer block is the short-answer section, already
    // required above the fold by validate_above_fold.js.
    test: (h) => /short-answer/i.test(h),
    why: 'no short-answer block - nothing here is quotable without surrounding context' },
  { id: 'query_in_heading', blocking: true,
    appliesTo: (rel) => !NAV_INDEXES.has(rel),
    test: (h) => { const m = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); return Boolean(m && text(m[1]).length > 10); },
    why: 'h1 missing or too short to carry the searcher phrasing' },
  { id: 'no_empty_table_cells', blocking: true,
    test: (h) => !/<t[dh][^>]*>\s*<\/t[dh]>/i.test(h),
    why: 'table ships empty cells - the agent calls these impossible to cite' },
  { id: 'conversion_path', blocking: true,
    test: (h) => CONVERSION.test(h),
    why: 'no approved conversion path - an answer-engine citation lands with nowhere to go' },
  { id: 'checklist', blocking: false,
    test: (h) => /<ol[\s>]|<ul[\s>]/i.test(h),
    why: 'no checklist or numbered protocol (agent request #1, 730 occurrences)' },
  { id: 'comparison_table', blocking: false,
    test: (h) => /<table[\s>]/i.test(h),
    why: 'no comparison or cost table (agent request #2, 529 occurrences)' },
  { id: 'concrete_numbers', blocking: false,
    test: (h) => /\$\s?\d|\d+\s?(?:days?|weeks?|months?|years?|hours?|minutes?)\b/i.test(text(h)),
    why: 'no concrete cost or timeline figures (agent request #5, 365 occurrences)' },
  { id: 'named_sources', blocking: false,
    test: (h) => /data-source|Primary sources|Sources?:/i.test(h) || EXTERNAL_SOURCE.test(h),
    why: 'no named primary source (agent request #6, 288 occurrences)' },
  { id: 'faq', blocking: false,
    test: (h) => /FAQPage|data-faq|class="[^"]*faq/i.test(h),
    why: 'no FAQ block or FAQPage schema (agent request #9)' },
  { id: 'structured_data', blocking: false,
    test: (h) => /application\/ld\+json/i.test(h),
    why: 'no JSON-LD structured data (agent request #10)' },
];

const pages = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(abs); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const rel = path.relative(ROOT, abs);
    if (SKIP_FILES.has(rel)) continue;
    const html = fs.readFileSync(abs, 'utf8');
    // Same exclusions validate_above_fold.js applies: a noindex page and the
    // operator console are not published answers.
    if (html.includes('noindex,nofollow')) continue;
    if (rel.includes(`${path.sep}admin${path.sep}`)) continue;
    pages.push({ rel, html });
  }
})(ROOT);
pages.sort((a, b) => a.rel.localeCompare(b.rel));

const blockingFailures = [];
const gaps = {};
for (const check of CHECKS) gaps[check.id] = [];

for (const page of pages) {
  for (const check of CHECKS) {
    if (typeof check.appliesTo === 'function' && !check.appliesTo(page.rel)) continue;
    if (check.test(page.html)) continue;
    if (check.blocking) blockingFailures.push({ path: page.rel, check: check.id, why: check.why });
    else gaps[check.id].push(page.rel);
  }
}

const summary = CHECKS.map((check) => {
  const missing = check.blocking
    ? blockingFailures.filter((f) => f.check === check.id).length
    : gaps[check.id].length;
  return {
    id: check.id,
    blocking: check.blocking,
    pagesMissing: missing,
    coveragePct: Number((100 * (1 - missing / Math.max(pages.length, 1))).toFixed(1)),
    why: check.why,
  };
});

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schemaVersion: '1.0.0',
  validator: 'content-pattern-contract',
  spec: '.clarity/content-pattern-spec.json',
  generatedAt: new Date().toISOString(),
  enforcement: ENFORCEMENT,
  pagesChecked: pages.length,
  status: blockingFailures.length ? (ENFORCEMENT === 'block' ? 'FAIL' : 'REPORTED') : 'PASS',
  blockingFailures: blockingFailures.length,
  summary,
  worstGaps: Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, v.slice(0, 25)])),
  blockingBacklog: blockingFailures.slice(0, 200),
}, null, 2)}\n`);

const report = [`Content pattern contract: ${pages.length} published pages checked.`];
for (const s of summary) {
  const tag = s.blocking ? 'BLOCKING' : 'gap     ';
  report.push(`  ${tag} ${s.id.padEnd(22)} coverage ${String(s.coveragePct).padStart(5)}%  missing on ${s.pagesMissing}`);
}
console.log(report.join('\n'));

if (blockingFailures.length) {
  const lines = [`${blockingFailures.length} page(s) miss a blocking content block.`];
  for (const f of blockingFailures.slice(0, 15)) lines.push(`- ${f.path} :: ${f.why}`);
  if (blockingFailures.length > 15) lines.push(`- ...and ${blockingFailures.length - 15} more`);
  lines.push(`- full backlog: ${path.relative(ROOT, EVIDENCE)}`);
  warn(lines.join('\n'), `blocking=${blockingFailures.length}`);
  process.exit(1);
}
console.log('Content pattern contract: no blocking gaps.');
