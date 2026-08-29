#!/usr/bin/env node
/*
 * An item that must be approved one at a time is never swept in by a standing
 * approval, whatever its date.
 *
 * Six finished guides were kept out of Monika's June 2026 standing approval by
 * being scheduled 2027-01-05 through 2027-02-09 - past the window's 2026-12-31
 * end date. It worked. It also meant six pages answering searches people were
 * making in August 2026 would not go live for four to five months, for a reason
 * that has nothing to do with when they should run. A date was doing a
 * permission's job, and the site was paying for it in months.
 *
 * The requirement now lives on the item: requiresIndividualApproval (or the
 * autonomy queue's routineApprovalRequired / publicOnlyAfterApproval, which mean
 * the same thing). Two independent implementations have to honour it -
 * scripts/publishing/process_manifest.js decides what actually publishes,
 * assets/js/admin.js decides what the client is shown - so this asserts both,
 * and then asserts the behaviour end to end: a publish run on the item's own
 * scheduled date, with the real standing approvals in force, must publish
 * nothing.
 *
 * The date is deliberately no longer load-bearing. This check would pass with
 * the guides scheduled in 2027 too; what it will not pass is the flag being
 * dropped, either side reading a different spelling of it, or the publisher
 * releasing a flagged item because its date fell inside a window.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../../..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const {
  loadApprovedIds,
  loadStandingApprovals,
  requiresIndividualApproval,
  standingApprovalFor,
  processManifest
} = require(path.join(root, 'scripts/publishing/process_manifest.js'));

const manifestDoc = readJson('data/admin/content_manifest.json');
const manifest = Array.isArray(manifestDoc) ? manifestDoc : (manifestDoc.items || []);
const approvals = readJson('data/admin/publication_approvals.json');
const declines = fs.existsSync(path.join(root, 'data/admin/publication_declines.json'))
  ? readJson('data/admin/publication_declines.json')
  : { declines: [] };

const errors = [];

// The page's own approvalFor(), lifted and run here rather than re-described.
const source = fs.readFileSync(path.join(root, 'assets/js/admin.js'), 'utf8');
const sandbox = { APPROVAL_RECORD: approvals, DECLINE_RECORD: declines, ADMIN_ITEMS: manifest };
const fnMatch = source.match(/\nfunction approvalFor\(([\s\S]*?)\n}\n/);
if (!fnMatch) {
  console.log('VALIDATION_FINDING check=individual-approval-gate');
  console.error('HARD FAIL  individual-approval-gate: cannot locate approvalFor() in assets/js/admin.js');
  process.exit(1);
}
vm.runInNewContext(`function approvalFor(${fnMatch[1]}\n}`, sandbox);

const standing = loadStandingApprovals();
const perItemIds = new Set(
  (approvals.approvals || [])
    .filter((e) => e && typeof e.id === 'string' && String(e.approvedBy || '').trim())
    .map((e) => e.id)
);

const gated = manifest.filter((item) => requiresIndividualApproval(item));

// Rule 0. If nothing carries the flag this check has proved nothing, and the
// most likely reason is that the flag was quietly dropped from the manifest -
// which is exactly the regression it exists to catch.
if (!gated.length) {
  errors.push('examined-no-items -- no manifest item requires individual approval, so this gate governs nothing');
}
if (!standing.length) {
  errors.push('no-standing-approval-in-force -- with no window to be swept in by, this check cannot prove the flag beats one');
}

/* Which items must carry the flag at all.
 *
 * Checking only the items that still carry it would let the gate be removed one
 * item at a time: drop the flag, the standing window silently swallows the item,
 * and every check still passes because the item is no longer in scope. That is
 * the same shape as the original defect.
 *
 * The rule comes from what the standing approval actually says. Monika approved
 * "the scheduled content calendar she reviewed" in June 2026 - which is exactly
 * the frozen baseline in data/system/source_preservation_manifest.json, the same
 * set validate_velocity_immutability.js pins. Content that did not exist when she
 * reviewed cannot be part of what she reviewed, so no item outside that baseline
 * may ride the window. Either it carries the flag, or it has her name on a
 * per-item approval, or it is already published (which is a separate decision,
 * audited by validate_owner_publication_attribution.js).
 */
const preserved = readJson('data/system/source_preservation_manifest.json');
const baselineIds = new Set(((preserved.contentManifest || {}).items || []).map((x) => x && x.id).filter(Boolean));
if (!baselineIds.size) {
  errors.push('source_preservation_manifest.json holds no baseline items, so "content she reviewed in June" cannot be distinguished from content she has never seen');
}
let postBaselineChecked = 0;
for (const item of manifest) {
  if (baselineIds.has(item.id)) continue;
  if (item.status === 'published' || item.status === 'revoked') continue;
  if (perItemIds.has(item.id)) continue;
  if (!item.scheduledAt) continue;
  postBaselineChecked += 1;
  if (requiresIndividualApproval(item)) continue;
  // Not flagged. If a standing window reaches it, it will publish on a decision
  // she never made about a piece she has never seen.
  const covering = standingApprovalFor(item, standing);
  if (covering) {
    errors.push(`post-baseline-item-swept-in-by-a-standing-window:${item.id} (scheduled ${item.scheduledAt}, window ${covering.scheduledThrough})`);
  } else {
    errors.push(`post-baseline-item-carries-no-individual-approval-requirement:${item.id} -- it is held today only by its date, which is what this gate replaced`);
  }
}

const approvedIds = loadApprovedIds();

for (const item of gated) {
  if (perItemIds.has(item.id)) continue; // She approved this one by name. That is the route that works.
  if (standingApprovalFor(item, standing)) errors.push(`publisher-covers-it-by-a-standing-window:${item.id}`);
  if (approvedIds.has(item.id)) errors.push(`loadApprovedIds-returns-it-without-a-per-item-approval:${item.id}`);
  if (sandbox.approvalFor(item)) errors.push(`admin-page-shows-it-as-already-approved:${item.id}`);
  // A flagged item with no date is the old stuck state (five siblings sat at
  // scheduledAt:null and reached no view at all). It must carry a real date.
  if (item.status !== 'published' && !item.scheduledAt) errors.push(`gated-item-has-no-date:${item.id}`);
}

// End to end: run the real publisher at each gated item's own scheduled moment,
// with the real approvals file, and require that it releases nothing.
let simulated = 0;
for (const item of gated) {
  if (item.status === 'published' || perItemIds.has(item.id)) continue;
  const at = Date.parse(item.scheduledAt);
  if (!Number.isFinite(at)) continue;
  simulated += 1;
  // One second past its scheduled time: due, validated, and still not releasable.
  const result = processManifest(manifest, new Date(at + 1000));
  const released = (result.releases || []).map((r) => r.id);
  if (released.includes(item.id)) {
    errors.push(`a-publish-run-on-its-own-date-released-it:${item.id}`);
  }
  const wrongly = released.filter((id) => {
    const other = manifest.find((x) => x.id === id);
    return other && requiresIndividualApproval(other) && !perItemIds.has(id);
  });
  for (const id of wrongly) errors.push(`same-run-released-another-gated-item:${id}`);
}
if (gated.length && !simulated) {
  errors.push('simulated-no-publish-runs -- every gated item is already published or approved, so the behaviour is untested');
}

if (errors.length) {
  console.log('VALIDATION_FINDING check=individual-approval-gate');
  console.error(`HARD FAIL  individual-approval-gate (${errors.length})`);
  for (const e of errors.slice(0, 25)) console.error(`  ${e}`);
  process.exit(1);
}

console.log(
  `Individual-approval gate holds (${gated.length} item(s) require a named per-item decision; `
  + `${standing.length} standing window(s) in force cover none of them, the admin page agrees on every one, `
  + `${simulated} simulated publish run(s) on their own scheduled dates released nothing, `
  + `and all ${postBaselineChecked} scheduled item(s) outside the June editorial baseline carry the requirement rather than relying on a date).`
);
