const fs = require('fs');
const path = require('path');

const ISO_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

const APPROVALS_PATH = path.join(process.cwd(), 'data', 'admin', 'publication_approvals.json');
const MANIFEST_PATH = path.join(process.cwd(), 'data', 'admin', 'content_manifest.json');

// The human release gate.
//
// status:'approved' does not mean a person approved anything. scripts/autonomy/
// run_cycle.mjs writes that status itself, on content it drafted, and the daily
// Content Publish cron then released it to a client's live site. 114 items carried
// it, 113 of them scheduled one per day into the future, with no human in the loop
// at any point.
//
// So publication now requires a second, separate fact: a named human approval in
// data/admin/publication_approvals.json. There are exactly two routes to one, and
// both name a person:
//   - `approvals`: this specific item, approved one id at a time. Only
//     scripts/admin/approve_publication.mjs writes there, and it is reachable only
//     through workflow_dispatch.
//   - `standing_approvals`: a bounded date range a person approved in advance,
//     edited by hand in a reviewed commit. It covers items scheduled on or before
//     its end date and nothing after.
// A cron cannot approve anything by either route, and no code path approves on a
// person's behalf.
//
// This is the same shape horse-legal-guide-velocity already uses, where approval
// lives outside the automated pipeline and the publish step is a gate rather than
// a scheduler.
function loadApprovalsDocument() {
  if (!fs.existsSync(APPROVALS_PATH)) return {};
  return JSON.parse(fs.readFileSync(APPROVALS_PATH, 'utf8'));
}

// The ids a person approved one at a time, in `approvals`.
function loadPerItemApprovedIds() {
  const doc = loadApprovalsDocument();
  return new Set(
    (doc.approvals || [])
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.approvedBy === 'string' && entry.approvedBy.trim())
      .map((entry) => entry.id)
  );
}

// Every id a human has approved for release, by either route.
//
// Callers ask one question - "may this item be released?" - and must get one
// answer. run_safe_publish.mjs uses this set to decide which due items to repair
// and which to report as awaiting a decision; if it saw only the per-item ids it
// would skip repairs on standing-approved content and then list, in the very
// receipt that published 111 items, all 111 as still awaiting a human. So the
// standing windows are expanded here into the concrete ids they cover.
//
// Only items that could actually publish are expanded: an item must already be
// `approved` and machine-validated. A revoked or draft item is never folded in by
// a standing window.
function loadApprovedIds(explicit, options = {}) {
  if (explicit) return explicit instanceof Set ? explicit : new Set(explicit);
  const ids = loadPerItemApprovedIds();
  const standing = loadStandingApprovals();
  if (!standing.length) return ids;
  for (const item of options.manifest || readManifestForApprovals()) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id)) continue;
    if (item.status !== 'approved' || item.validationPassed !== true) continue;
    if (standingApprovalFor(item, standing)) ids.add(item.id);
  }
  return ids;
}

function readManifestForApprovals() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// The second approval route: a standing approval.
//
// Monika approved the scheduled content calendar through 2026-12-31 in June 2026,
// in the client agreement, before this gate was built. That approval is real, but
// it lived in the agreement rather than in this file, and the gate only reads the
// file - so on 2026-08-27 the gate silently held content she had already agreed to
// and nobody noticed for three days.
//
// A standing approval records the decision she actually made: one person, one
// bounded date range, once. The alternative - writing 111 per-item lines - would
// manufacture 111 separate "decisions" out of one, and an audit trail that
// misrepresents what happened is worse than no audit trail.
//
// It is bounded by construction and cannot become an approve-all:
//   - `scheduledThrough` is required, and must be a plain YYYY-MM-DD date. An
//     entry without one covers nothing.
//   - Coverage is decided by the item's own scheduledAt. Content scheduled after
//     the end date is not covered, however it is validated or statused.
//   - `approvedBy` must name a person, tested against the same automation list
//     scripts/admin/approve_publication.mjs uses. A cron cannot stand in as the
//     approver here any more than it can there.
//   - No script writes this array. It is edited by a person in a reviewed commit.
//     A CLI that emits standing approvals would be the bulk approve-all this gate
//     exists to prevent.
const STANDING_THROUGH_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AUTOMATION_APPROVER = /^(ci|bot|automation|github-actions|system|auto)$/i;

function normalizeStandingApprovals(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.approvedBy !== 'string' || !entry.approvedBy.trim()) return false;
      if (AUTOMATION_APPROVER.test(entry.approvedBy.trim())) return false;
      return typeof entry.scheduledThrough === 'string' && STANDING_THROUGH_DATE.test(entry.scheduledThrough);
    })
    .map((entry) => ({
      ...entry,
      // Inclusive of the whole final day, in UTC, the same clock scheduledAt uses.
      throughMs: Date.parse(`${entry.scheduledThrough}T23:59:59.999Z`)
    }))
    .filter((entry) => Number.isFinite(entry.throughMs));
}

function loadStandingApprovals(explicit) {
  if (explicit) return normalizeStandingApprovals(explicit);
  return normalizeStandingApprovals(loadApprovalsDocument().standing_approvals);
}

// Returns the standing approval covering this item, or null. Null is the answer
// for anything scheduled past every window's end date.
function standingApprovalFor(item, standingApprovals, scheduledAt) {
  const at = scheduledAt instanceof Date ? scheduledAt.valueOf() : Date.parse(item.scheduledAt);
  if (!Number.isFinite(at)) return null;
  return standingApprovals.find((entry) => at <= entry.throughMs) || null;
}

function parseScheduledAt(value, itemId) {
  if (typeof value !== 'string' || !ISO_WITH_TIMEZONE.test(value)) {
    throw new Error(`Approved manifest item ${itemId} has invalid scheduledAt: ${value}. Use an ISO timestamp with timezone.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Approved manifest item ${itemId} has invalid scheduledAt: ${value}`);
  }
  return date;
}

function processManifest(manifest, now = new Date(), options = {}) {
  if (!Array.isArray(manifest)) {
    throw new TypeError('Content manifest must be an array.');
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new TypeError('Publication clock must be a valid Date.');
  }

  const seenIds = new Set();
  for (const item of manifest) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('Every content manifest item must be an object.');
    }
    if (typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error('Every content manifest item must have a non-empty string id.');
    }
    if (seenIds.has(item.id)) {
      throw new Error(`Content manifest contains duplicate id: ${item.id}`);
    }
    seenIds.add(item.id);
  }

  // Deliberately the raw per-item ids, not the union loadApprovedIds() returns:
  // the two routes are kept apart here so a release can be recorded under the one
  // that actually authorised it. Folding them together would label every standing
  // release "per-item" and lose the audit trail.
  const approvedIds = options.approvedIds
    ? (options.approvedIds instanceof Set ? options.approvedIds : new Set(options.approvedIds))
    : loadPerItemApprovedIds();
  // When a caller passes approvedIds explicitly it is describing the whole
  // approval state it wants tested, so standing approvals default to none rather
  // than leaking in from the live file. Production passes neither and gets both.
  const standingApprovals = options.standingApprovals
    ? normalizeStandingApprovals(options.standingApprovals)
    : (options.approvedIds ? [] : loadStandingApprovals());
  let changed = false;
  let publishedCount = 0;
  let heldForApproval = 0;
  // Who approved what, and on what basis, for the run receipt.
  const releases = [];

  const updated = manifest.map((item) => {
    if (item.status !== 'approved' || item.validationPassed !== true) {
      return item;
    }

    if (!item.scheduledAt) {
      throw new Error(`Approved manifest item ${item.id} is missing scheduledAt.`);
    }

    const scheduledAt = parseScheduledAt(item.scheduledAt, item.id);
    if (scheduledAt > now) {
      return item;
    }

    // Two independent routes to a human decision: this item by id, or a standing
    // approval whose window covers this item's scheduled date.
    const perItem = approvedIds.has(item.id);
    const standing = perItem ? null : standingApprovalFor(item, standingApprovals, scheduledAt);

    // Due, validated, and still not releasable without a person. Held, not failed:
    // an unapproved queue is a normal state, not a broken one. This is also where
    // anything scheduled past every standing window lands.
    if (!perItem && !standing) {
      heldForApproval += 1;
      return item;
    }

    const { previewPath: _removedPreviewPath, ...publishedItem } = item;
    changed = true;
    publishedCount += 1;
    releases.push({
      id: item.id,
      basis: perItem ? 'per-item' : 'standing',
      approvalId: perItem ? item.id : standing.id,
      approvedBy: perItem ? null : standing.approvedBy,
      scheduledThrough: perItem ? null : standing.scheduledThrough
    });

    return {
      ...publishedItem,
      status: 'published',
      publishedAt: now.toISOString()
    };
  });

  return { manifest: updated, changed, publishedCount, heldForApproval, releases };
}

function writeJsonAtomically(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode : 0o644;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', { mode });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function publishManifestFile({
  manifestPath = path.join(process.cwd(), 'data', 'admin', 'content_manifest.json'),
  now = new Date(),
  approvedIds
} = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const result = processManifest(manifest, now, { approvedIds });

  if (result.changed) {
    writeJsonAtomically(manifestPath, result.manifest);
    console.log(`Manifest updated: ${result.publishedCount} human-approved item(s) published.`);
  } else {
    console.log('Manifest unchanged: nothing is both due and human-approved.');
  }
  if (result.heldForApproval) {
    console.log(`${result.heldForApproval} item(s) are due and validated but awaiting human approval in data/admin/publication_approvals.json.`);
    console.log('Approve with: node scripts/admin/approve_publication.mjs --id <id> --by "<person>"');
  }

  return result;
}

if (require.main === module) {
  try {
    publishManifestFile();
  } catch (error) {
    console.error(`CONTENT PUBLISH FAIL: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  APPROVALS_PATH,
  loadApprovedIds,
  loadPerItemApprovedIds,
  loadStandingApprovals,
  normalizeStandingApprovals,
  standingApprovalFor,
  ISO_WITH_TIMEZONE,
  parseScheduledAt,
  processManifest,
  publishManifestFile,
  writeJsonAtomically
};
