#!/usr/bin/env node
/*
 * Nothing is put in front of the client as her own decision unless a named
 * person actually made it.
 *
 * On 2026-08-29 the /admin/ page showed Monika Hicks a filter chip reading
 * "Revoked 54". She had decided against nothing. data/admin/publication_declines.json
 * was empty, not one of the 54 carried a revokedReason or a revokedBy, and all
 * 54 ids matched, exactly, the mappings in
 * reports/BING_INDEXATION_CONSOLIDATION_REPORT.json -- an automated index-quality
 * pass on 2026-08-08 that pulled near-duplicate insight pages (>=0.85 similarity,
 * duplicate <title>) out of the public sitemap and 301-redirected each to the
 * article it duplicated. Its own fields say editorialContentRewritten: false.
 *
 * The page had inferred the decision from a status string. A machine wrote that
 * string; the word "Revoked" told a human she had made 54 choices she had never
 * been asked to make. Nothing failed, no test went red, and the only symptom was
 * a label on a client's screen that misattributed a machine's housekeeping to her.
 *
 * Two rules, and every removal is under one of them:
 *
 *   1. If the page presents it as HER decision, a named person made it, and that
 *      person gave a reason.
 *   2. If a machine removed it, the machine recorded a reason -- in plain
 *      language, rendered on the page beside the item. A reason that exists only
 *      in a file nobody renders is the same defect as no reason at all.
 *
 * So this does not check copy. It runs the page's own groupFor() and whenLine()
 * over the real manifest and asserts both rules item by item, and that no client
 * filter label asserts a choice she may not have made.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../../..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const readText = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const manifestDoc = readJson('data/admin/content_manifest.json');
// The manifest is a bare array on disk. Reading `.items` off it would find
// undefined, iterate nothing, and report success -- the "exits 0 having done
// nothing" failure this file exists to prevent, so it is spelled out.
const manifest = Array.isArray(manifestDoc) ? manifestDoc : (manifestDoc.items || []);
const approvals = readJson('data/admin/publication_approvals.json');
const declines = readJson('data/admin/publication_declines.json');
const consolidations = fs.existsSync(path.join(root, 'data/admin/content_consolidations.json'))
  ? readJson('data/admin/content_consolidations.json')
  : null;
const report = readJson('reports/BING_INDEXATION_CONSOLIDATION_REPORT.json');
const source = readText('assets/js/admin.js');
const adminHtml = readText('pages/admin/index.html');

const errors = [];

// Lift the page's real decision logic and run it here, so what gets tested is
// the code the browser executes -- not a paraphrase of it that can drift.
const sandbox = {
  APPROVAL_RECORD: approvals,
  DECLINE_RECORD: declines,
  CONSOLIDATION_RECORD: consolidations || { consolidations: [] },
  ADMIN_ITEMS: manifest
};
for (const fn of ['approvalFor', 'declineFor', 'consolidationFor', 'humanDecisionFor', 'systemRemovalReasonFor', 'groupFor']) {
  const m = source.match(new RegExp(`\\nfunction ${fn}\\(([\\s\\S]*?)\\n}\\n`));
  if (!m) {
    console.log('VALIDATION_FINDING check=client-decision-attribution');
    console.error(`HARD FAIL  client-decision-attribution: cannot locate ${fn}() in assets/js/admin.js`);
    process.exit(1);
  }
  vm.runInNewContext(`function ${fn}(${m[1]}\n}`, sandbox);
}

const clientGroupsMatch = source.match(/const CLIENT_GROUPS = \[([^\]]*)\]/);
if (!clientGroupsMatch) {
  console.log('VALIDATION_FINDING check=client-decision-attribution');
  console.error('HARD FAIL  client-decision-attribution: cannot locate CLIENT_GROUPS in assets/js/admin.js');
  process.exit(1);
}
const clientGroups = clientGroupsMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

/* ---- 1. Every item shown as her decision names the person who made it. ---- */
//
// The examined set is deliberately broader than the presented set: it is every
// item that could plausibly be dressed up as a decision -- anything taken off the
// site, plus every recorded decline. If that set is empty this check has proved
// nothing and must say so rather than pass.
const declinedIds = new Set((declines.declines || []).map((e) => e && e.id).filter(Boolean));
const candidates = manifest.filter((item) => item.status === 'revoked' || declinedIds.has(item.id));
let examined = 0;
let attributed = 0;
let systemExplained = 0;
const faults = [];

// A reason the page will not render is not a reason. The fallback string
// systemRemovalReasonFor() returns when the record is empty says so in as many
// words, and is treated here as the absence it is.
const MISSING_REASON_FALLBACK = /reason was not recorded/i;

for (const item of candidates) {
  examined += 1;
  const group = sandbox.groupFor(item);
  if (group === 'declined') {
    const who = sandbox.humanDecisionFor(item);
    const name = who && String(who.by || '').trim();
    const why = who && String(who.reason || '').trim();
    if (!name) faults.push(`presented-as-her-decision-without-a-named-decider:${item.id}`);
    else if (!why) faults.push(`her-decision-recorded-with-no-reason:${item.id}`);
    else attributed += 1;
    continue;
  }
  if (group === 'system-removed') {
    const why = String(sandbox.systemRemovalReasonFor(item) || '').trim();
    if (!why || MISSING_REASON_FALLBACK.test(why)) {
      faults.push(`removed-by-the-system-with-no-recorded-reason:${item.id}`);
      continue;
    }
    // The reason has to name what actually triggered it, not just assert that
    // something happened. For a duplicate removal that means naming the article
    // it repeated and where the old link now goes.
    const record = sandbox.consolidationFor(item) || {};
    const parent = String(record.parentTitle || '').trim();
    const target = String(record.redirectsTo || '').trim();
    if (parent && !why.includes(parent)) faults.push(`system-reason-does-not-name-what-triggered-it:${item.id}`);
    else if (target && !why.includes(target)) faults.push(`system-reason-does-not-say-where-the-old-link-goes:${item.id}`);
    else systemExplained += 1;
    continue;
  }
  faults.push(`removed-item-in-an-unexpected-group:${item.id} group=${group}`);
}

if (!examined) {
  errors.push('examined-no-items -- no revoked or declined item exists to check, this validator is inert');
}
for (const f of faults.slice(0, 20)) errors.push(f);
if (faults.length > 20) errors.push(`...and ${faults.length - 20} more removal(s) with a missing name or missing reason`);

// The reason must reach the reader. whenLine() is what puts it on the row, so
// assert the group it renders for exists and returns the recorded text.
const whenLineMatch = source.match(/\nfunction whenLine\(([\s\S]*?)\n}\n/);
if (!whenLineMatch) errors.push('cannot-locate-whenLine()-in-assets/js/admin.js');
else {
  vm.runInNewContext(`function friendlyDate(){return ''}\nfunction isPast(){return false}\nfunction whenLine(${whenLineMatch[1]}\n}`, sandbox);
  const sample = manifest.filter((i) => sandbox.groupFor(i) === 'system-removed');
  for (const item of sample) {
    const rendered = String(sandbox.whenLine(item, 'system-removed') || '');
    if (rendered !== sandbox.systemRemovalReasonFor(item)) {
      errors.push(`system-removal-reason-is-recorded-but-not-rendered-on-the-row:${item.id}`);
      break;
    }
  }
}

/* ---- 2. Machine removals are labelled as the machine's, never as hers. ---- */
const machineRemoved = manifest.filter((item) => sandbox.groupFor(item) === 'system-removed');

// Machine removals belong in her view, under their own name. What must never
// happen is them sharing a group with her decisions.
if (!clientGroups.includes('system-removed')) {
  errors.push(`machine-removals-are-not-shown-to-the-client-at-all: CLIENT_GROUPS=${clientGroups.join(',')}`);
}
if (clientGroups.includes('draft')) {
  errors.push(`client-filters-expose-unwritten-work: CLIENT_GROUPS=${clientGroups.join(',')}`);
}
const offered = new Set();
for (const m of adminHtml.matchAll(/data-status-shortcut="([^"]+)"/g)) offered.add(m[1]);
const selectBlock = adminHtml.match(/<select id="status-filter">([\s\S]*?)<\/select>/);
if (!selectBlock) errors.push('cannot-locate-status-filter-select-in-pages/admin/index.html');
else for (const m of selectBlock[1].matchAll(/value="([^"]+)"/g)) offered.add(m[1]);
for (const value of offered) {
  if (value !== 'all' && !clientGroups.includes(value)) {
    errors.push(`admin-page-offers-a-filter-the-page-logic-does-not-serve-to-the-client:${value}`);
  }
}

// The word that started this. A client-facing control must not label a group
// with a word that asserts a choice she did not make.
const CHOICE_WORDS = /\b(revoked|rejected|declined by you|you rejected)\b/i;
const controlLabels = [];
for (const m of adminHtml.matchAll(/data-status-shortcut="[^"]+"[^>]*>([^<]*)</g)) controlLabels.push(m[1]);
if (selectBlock) for (const m of selectBlock[1].matchAll(/<option[^>]*>([^<]*)</g)) controlLabels.push(m[1]);
for (const label of controlLabels) {
  if (CHOICE_WORDS.test(label)) errors.push(`client-filter-label-asserts-a-choice-she-may-not-have-made:"${label.trim()}"`);
}

/* ---- 3. The record behind the notes is complete. ---- */
//
// Every reason shown to the client is composed from this record, so a gap in it
// is a gap in what she is told.
if (!consolidations) {
  errors.push('missing:data/admin/content_consolidations.json -- machine removals must stay accounted for');
} else {
  const recorded = new Set((consolidations.consolidations || []).map((e) => e && e.id).filter(Boolean));
  const reported = new Set((report.mappings || []).map((e) => e && e.insightId).filter(Boolean));
  for (const item of machineRemoved) {
    if (!recorded.has(item.id)) errors.push(`machine-removed-but-not-recorded-for-the-site-owner:${item.id}`);
  }
  for (const id of recorded) {
    if (!reported.has(id)) errors.push(`recorded-consolidation-with-no-evidence-in-the-source-report:${id}`);
  }
  for (const id of reported) {
    if (!recorded.has(id)) errors.push(`source-report-mapping-missing-from-the-consolidation-record:${id}`);
  }
  if (consolidations.humanDecision !== false) {
    errors.push('content_consolidations.json must state humanDecision:false -- it is a machine record');
  }
  if (!/consolidated-tbody/.test(adminHtml) || !/consolidated-panel/.test(adminHtml)) {
    errors.push('the site-owner consolidation table is missing from pages/admin/index.html');
  }
  if (!/renderConsolidations\(\)/.test(source)) {
    errors.push('renderConsolidations() is never called -- the site-owner record would not render');
  }
}

/* ---- 4. A removal with no reason must not be possible in the first place. ----
 *
 * A backfill fixes 54 rows once. These are the two code paths that can create
 * row 55, and both must refuse to write a removal without a reason -- otherwise
 * this whole check is a snapshot with a shelf life.
 */
const workerSource = readText('worker/admin_runtime.mjs');
const takeDown = workerSource.slice(workerSource.indexOf('async function contentTakeDown'));
if (!/if \(!reason\) return json\(\{ ok: false/.test(takeDown.slice(0, 2000))) {
  errors.push('worker/admin_runtime.mjs contentTakeDown() accepts a take-down with no reason');
}
if (/revokedReason: reason \|\| null/.test(takeDown.slice(0, 2000))) {
  errors.push('worker/admin_runtime.mjs still writes revokedReason: null on take-down');
}
const migration = readText('scripts/agency/migrate_bing_indexation_consolidation.mjs');
if (!/build_content_consolidations\.js/.test(migration)) {
  errors.push('the automated consolidation migration removes items without composing their reasons');
}
if (!fs.existsSync(path.join(root, 'scripts/admin/removal_reasons.js'))) {
  errors.push('missing:scripts/admin/removal_reasons.js -- there is no single place a removal reason is written');
}

if (errors.length) {
  console.log('VALIDATION_FINDING check=client-decision-attribution');
  console.error(`HARD FAIL  client-decision-attribution (${errors.length})`);
  for (const e of errors.slice(0, 25)) console.error(`  ${e}`);
  process.exit(1);
}
console.log(
  `Every removal says why it happened and who decided it `
  + `(${examined} removal/decline record(s) examined: ${attributed} named human decision(s) with a reason, `
  + `${systemExplained} automated removal(s) each carrying a rendered plain-language reason naming what triggered it; `
  + `both write paths refuse a removal with no reason).`
);
