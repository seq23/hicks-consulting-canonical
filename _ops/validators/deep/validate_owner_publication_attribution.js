#!/usr/bin/env node
/*
 * A page the site owner published is recorded as the site owner's act, never as
 * the client's.
 *
 * The release gate in scripts/publishing/process_manifest.js exists so that no
 * cron and no LLM can put a page on a client's live site. It does not, and must
 * not, stop the site owner from publishing something directly - on 2026-08-29
 * she did exactly that with five localized landing pages. What must never happen
 * is that release being written into the record as Monika's decision, because
 * data/admin/publication_approvals.json is the audit trail for decisions she
 * actually made, and one fabricated line in it makes the whole file worthless.
 *
 * Two rules, and every release since the gate was sealed is under one of them:
 *
 *   1. Released because a named human approved it - per-item, or inside a
 *      standing window that human agreed to.
 *   2. Released by the site owner directly - recorded in ownerPublication with
 *      the publisher named, a reason given, and the absence of client approval
 *      stated in as many words.
 *
 * Anything published on or after the seal date that is under neither rule is an
 * unattributed release, which is the state the gate was built to end.
 *
 * Items published before the seal date are out of scope by design: 59 pages were
 * already live when the gate landed, they are not retired and not retroactively
 * approved, and the file says so.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const { loadStandingApprovals, standingApprovalFor } = require(path.join(root, 'scripts/publishing/process_manifest.js'));

const manifestDoc = readJson('data/admin/content_manifest.json');
const manifest = Array.isArray(manifestDoc) ? manifestDoc : (manifestDoc.items || []);
const approvals = readJson('data/admin/publication_approvals.json');

const errors = [];

const sealedOn = String(approvals.pre_gate_baseline?.sealed_on || '').trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(sealedOn)) {
  errors.push('publication_approvals.json has no pre_gate_baseline.sealed_on, so post-gate releases cannot be separated from pre-gate ones');
}
const sealMs = Date.parse(`${sealedOn}T00:00:00.000Z`);

const perItem = new Map(
  (approvals.approvals || [])
    .filter((e) => e && typeof e.id === 'string' && String(e.approvedBy || '').trim())
    .map((e) => [e.id, e])
);
const standing = loadStandingApprovals();

// The client's name. It may appear as an approver in publication_approvals.json,
// which is the file she decides in. It may never appear as the publisher of an
// owner publication, which is by definition a release she was not asked about.
const CLIENT_NAMES = /monika/i;

const published = manifest.filter((item) => item.status === 'published');
let examined = 0;
let byClientApproval = 0;
let byOwner = 0;

for (const item of published) {
  const at = Date.parse(item.publishedAt || item.scheduledAt || '');
  if (!Number.isFinite(at) || !Number.isFinite(sealMs) || at < sealMs) continue;
  examined += 1;

  const owner = item.ownerPublication || null;
  const clientApproved = perItem.has(item.id) || Boolean(standingApprovalFor(item, standing));

  if (owner) {
    const who = String(owner.publishedBy || '').trim();
    if (!who) errors.push(`owner-publication-with-no-named-publisher:${item.id}`);
    if (CLIENT_NAMES.test(who)) errors.push(`owner-publication-attributed-to-the-client:${item.id}:"${who}"`);
    if (!String(owner.reason || '').trim()) errors.push(`owner-publication-with-no-reason:${item.id}`);
    const stated = String(owner.clientApproval || '');
    if (!/^none\b/i.test(stated)) errors.push(`owner-publication-does-not-state-that-no-client-approval-was-given:${item.id}`);
    // And the claim has to be true: an owner publication must not also be
    // carrying a per-item approval line in the client's name.
    const line = perItem.get(item.id);
    if (line && CLIENT_NAMES.test(String(line.approvedBy || ''))) {
      errors.push(`recorded-both-as-an-owner-publication-and-as-the-client's-approval:${item.id}`);
    }
    byOwner += 1;
    continue;
  }

  if (clientApproved) {
    byClientApproval += 1;
    continue;
  }

  errors.push(`published-after-the-gate-with-no-approval-and-no-owner-attribution:${item.id}`);
}

// Rule 0. Nothing published since the gate was sealed means this proves nothing
// about how releases are attributed, and silence would be the wrong answer.
if (!examined) {
  errors.push(`examined-no-items -- nothing in the manifest is published on or after ${sealedOn || '(no seal date)'}, so this check is inert`);
}

if (errors.length) {
  console.log('VALIDATION_FINDING check=owner-publication-attribution');
  console.error(`HARD FAIL  owner-publication-attribution (${errors.length})`);
  for (const e of errors.slice(0, 25)) console.error(`  ${e}`);
  process.exit(1);
}

console.log(
  `Every release since the gate was sealed on ${sealedOn} names who made it `
  + `(${examined} examined: ${byClientApproval} released on a named client approval, `
  + `${byOwner} published directly by the site owner, each carrying a reason and stating plainly that the client approved nothing; `
  + `no owner publication is written in the client's name).`
);
