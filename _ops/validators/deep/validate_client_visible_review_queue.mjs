#!/usr/bin/env node
/*
 * An item that says it is waiting on the client cannot be invisible to the client.
 *
 * Five finished guides sat in data/admin/content_manifest.json at status:"draft"
 * with scheduledAt:null, each carrying the note "Awaiting client review". No
 * script promoted draft -> approved, assets/js/admin.js#groupFor() called every
 * non-approved item 'draft', and 'draft' was not in CLIENT_GROUPS - so
 * renderReview() and renderBrowse() both dropped them. The one screen where
 * Monika makes decisions showed no trace of five pieces whose own record said
 * they were waiting for her decision. Nothing failed, nothing warned, and they
 * would have sat there indefinitely.
 *
 * The five were promoted into her queue, so the live manifest no longer contains
 * one. That is the reason this is a behavioural check and not a data check: the
 * defect is in the routing logic, the logic is still reachable, and a data check
 * would now pass over an empty set forever.
 *
 * So it runs the page's own groupFor() over fixtures that reproduce the exact
 * shape - and over the shape that must still be held back, because "show her
 * everything" is not the fix either: a piece the machine is halfway through
 * writing is noise in a decision queue.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = fs.readFileSync(path.join(ROOT, 'assets/js/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT, 'pages/admin/index.html'), 'utf8');
const errors = [];

const sandbox = { APPROVAL_RECORD: { approvals: [] }, DECLINE_RECORD: { declines: [] }, CONSOLIDATION_RECORD: { consolidations: [] }, ADMIN_ITEMS: [] };
for (const fn of ['approvalFor', 'declineFor', 'consolidationFor', 'humanDecisionFor', 'groupFor']) {
  const m = source.match(new RegExp(`\\nfunction ${fn}\\(([\\s\\S]*?)\\n}\\n`));
  if (!m) {
    console.log('VALIDATION_FINDING check=client-visible-review-queue');
    console.error(`HARD FAIL  client-visible-review-queue: cannot locate ${fn}() in assets/js/admin.js`);
    process.exit(1);
  }
  vm.runInNewContext(`function ${fn}(${m[1]}\n}`, sandbox);
}

const clientGroupsMatch = source.match(/const CLIENT_GROUPS = \[([^\]]*)\]/);
if (!clientGroupsMatch) {
  console.log('VALIDATION_FINDING check=client-visible-review-queue');
  console.error('HARD FAIL  client-visible-review-queue: cannot locate CLIENT_GROUPS in assets/js/admin.js');
  process.exit(1);
}
const clientGroups = clientGroupsMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

// The exact shapes. The first is what the five actually looked like on disk.
const fixtures = [
  {
    name: 'the historical shape: finished, no date, notes say it awaits her',
    item: { id: 'fx-awaiting-notes', title: 'Fixture', status: 'draft', validationPassed: true, scheduledAt: null, notes: 'DRAFT. Not approved and not published. Awaiting client review.' },
    mustReachHer: true
  },
  {
    name: 'finished and explicitly flagged as needing her own decision',
    item: { id: 'fx-awaiting-flag', title: 'Fixture', status: 'draft', validationPassed: true, scheduledAt: '2026-09-15T13:00:00.000Z', requiresIndividualApproval: true, notes: '' },
    mustReachHer: true
  },
  {
    name: 'finished and marked awaiting review by field',
    item: { id: 'fx-awaiting-field', title: 'Fixture', status: 'draft', validationPassed: true, scheduledAt: null, awaitingClientReview: true, notes: '' },
    mustReachHer: true
  },
  {
    name: 'mid-generation: not finished, nothing claims it awaits her',
    item: { id: 'fx-unwritten', title: 'Fixture', status: 'draft', validationPassed: false, scheduledAt: null, notes: 'Drafting in progress.' },
    mustReachHer: false
  },
  {
    name: 'mid-generation but note-tagged: still unfinished, still held back',
    item: { id: 'fx-unwritten-tagged', title: 'Fixture', status: 'draft', validationPassed: false, scheduledAt: null, notes: 'Awaiting client review.' },
    mustReachHer: false
  }
];

let examined = 0;
for (const fixture of fixtures) {
  examined += 1;
  const group = sandbox.groupFor(fixture.item);
  const reaches = clientGroups.includes(group);
  if (fixture.mustReachHer && !reaches) {
    errors.push(`an-item-that-says-it-awaits-her-is-hidden-from-her: ${fixture.name} -> group="${group}"`);
  }
  if (!fixture.mustReachHer && reaches) {
    errors.push(`unfinished-work-is-being-put-in-her-queue: ${fixture.name} -> group="${group}"`);
  }
}

// The group has to be reachable in the interface, not just in the logic: a
// group with no filter and no label is another way of being invisible.
const awaitingGroup = clientGroups.find((g) => g !== 'draft' && /await|review|waiting/i.test(g));
if (!awaitingGroup) {
  errors.push(`no-client-group-exists-for-work-awaiting-her: CLIENT_GROUPS=${clientGroups.join(',')}`);
} else {
  if (!adminHtml.includes(`data-status-shortcut="${awaitingGroup}"`)) errors.push(`no-filter-button-for:${awaitingGroup}`);
  if (!adminHtml.includes(`value="${awaitingGroup}"`)) errors.push(`no-status-filter-option-for:${awaitingGroup}`);
  if (!new RegExp(`['"]${awaitingGroup}['"]\\s*:`).test(source)) errors.push(`no-row-label-for:${awaitingGroup}`);
  if (!new RegExp(`groupFor\\(item\\) === ['"]${awaitingGroup}['"]`).test(source)) errors.push(`the-review-panel-never-selects:${awaitingGroup}`);
}

// The five filter chips PR #16 landed must survive. Losing one of those is the
// same class of regression as the one this file guards.
for (const chip of ['ready', 'scheduled', 'published', 'declined', 'system-removed']) {
  if (!adminHtml.includes(`data-status-shortcut="${chip}"`)) errors.push(`pr16-filter-chip-lost:${chip}`);
  if (!clientGroups.includes(chip)) errors.push(`pr16-client-group-lost:${chip}`);
}

// Copy rule: the client does not write any of this. Every word on the decision
// screen has to frame it as hers to own and decide, never hers to have authored.
const AUTHORSHIP = /\b(your writing|you wrote|pieces you wrote|your voice|written by you|your words|authored by you)\b/i;
for (const [label, text] of [['assets/js/admin.js', source], ['pages/admin/index.html', adminHtml]]) {
  if (AUTHORSHIP.test(text)) errors.push(`authorship-language-in-client-copy:${label}`);
}

if (!examined) errors.push('examined-no-fixtures -- this check is inert');

if (errors.length) {
  console.log('VALIDATION_FINDING check=client-visible-review-queue');
  console.error(`HARD FAIL  client-visible-review-queue (${errors.length})`);
  for (const e of errors.slice(0, 25)) console.error(`  ${e}`);
  process.exit(1);
}

console.log(
  `Work awaiting the client reaches the client (${examined} routing fixture(s) run through the page's own groupFor(): `
  + `every finished piece that says it is waiting on her lands in a client group with a filter, a label and a place in the review panel; `
  + `unfinished drafts stay out; the five PR #16 filter chips are intact and no copy claims she wrote anything).`
);
