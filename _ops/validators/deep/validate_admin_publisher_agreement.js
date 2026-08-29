#!/usr/bin/env node
/*
 * The admin page and the publisher must answer "will this go out?" the same way.
 *
 * They are separate implementations -- assets/js/admin.js decides what Monika
 * sees, scripts/publishing/process_manifest.js decides what actually publishes
 * -- and on 2026-08-29 they silently disagreed about every scheduled item. The
 * publisher wrote `standing_approvals` with `scheduledThrough`; the page probed
 * for `standingApprovals` with `through`, found nothing, and told her 112 pieces
 * were waiting for her OK. They were not. Her June decision already covered 111
 * of them and the publisher was releasing them on schedule.
 *
 * Nothing failed. Both sides were internally consistent. The only symptom was a
 * number on a client's screen that asked her to redo a decision she had made.
 *
 * So this does not check key names -- it runs both implementations over the real
 * manifest and asserts they agree item by item.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { standingApprovalFor, loadStandingApprovals } = require('../../../scripts/publishing/process_manifest.js');

const root = path.resolve(__dirname, '../../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const manifestDoc = read('data/admin/content_manifest.json');
// The manifest is a bare array on disk. An earlier draft of this file read
// `.items` off it, found undefined, iterated nothing and reported agreement --
// the exact 'exits 0 having done nothing' failure it exists to catch.
const manifest = Array.isArray(manifestDoc) ? manifestDoc : (manifestDoc.items || []);
const approvals = read('data/admin/publication_approvals.json');
const declines = fs.existsSync(path.join(root, 'data/admin/publication_declines.json'))
  ? read('data/admin/publication_declines.json')
  : { declines: [] };

// Lift approvalFor/groupFor out of the browser bundle and run them here, so the
// page's own logic is what gets tested -- not a re-description of it.
const source = fs.readFileSync(path.join(root, 'assets/js/admin.js'), 'utf8');
const sandbox = { APPROVAL_RECORD: approvals, DECLINE_RECORD: declines, ADMIN_ITEMS: manifest };
for (const fn of ['approvalFor', 'declineFor', 'groupFor']) {
  const m = source.match(new RegExp(`\\nfunction ${fn}\\(([\\s\\S]*?)\\n}\\n`));
  if (!m) {
    console.log(`VALIDATION_FINDING check=admin-publisher-agreement`);
    console.error(`HARD FAIL  admin-publisher-agreement: cannot locate ${fn}() in assets/js/admin.js`);
    process.exit(1);
  }
  vm.runInNewContext(`function ${fn}(${m[1]}\n}`, sandbox);
}

const standing = loadStandingApprovals();
const errors = [];
let agreedCovered = 0;

let examined = 0;
for (const item of manifest) {
  // Only items the publisher would even consider: it never sweeps in revoked or
  // unvalidated content, so those are out of scope for the comparison.
  if (item.status !== 'approved' || item.validationPassed !== true) continue;
  examined += 1;
  const pageSaysCovered = Boolean(sandbox.approvalFor(item));
  const publisherSaysCovered = Boolean(standingApprovalFor(item, standing))
    || (approvals.approvals || []).some((e) => e && e.id === item.id && String(e.approvedBy || '').trim());
  if (pageSaysCovered !== publisherSaysCovered) {
    errors.push(`disagreement:${item.id} page=${pageSaysCovered} publisher=${publisherSaysCovered}`);
  } else if (pageSaysCovered) {
    agreedCovered += 1;
  }
}

// Rule 0: this validator must never pass by having examined nothing.
if (!examined) errors.push('examined-no-items -- manifest shape changed, this check is inert');
if (!standing.length && !(approvals.approvals || []).length) {
  errors.push('no-approvals-of-any-kind-to-compare');
}

if (errors.length) {
  console.log('VALIDATION_FINDING check=admin-publisher-agreement');
  console.error(`HARD FAIL  admin-publisher-agreement (${errors.length})`);
  for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`Admin page and publisher agree on every scheduled item (${agreedCovered} of ${examined} covered by an approval, ${standing.length} standing approval(s) in force).`);
