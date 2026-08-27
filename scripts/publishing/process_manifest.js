const fs = require('fs');
const path = require('path');

const ISO_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

const APPROVALS_PATH = path.join(process.cwd(), 'data', 'admin', 'publication_approvals.json');

// The human release gate.
//
// status:'approved' does not mean a person approved anything. scripts/autonomy/
// run_cycle.mjs writes that status itself, on content it drafted, and the daily
// Content Publish cron then released it to a client's live site. 114 items carried
// it, 113 of them scheduled one per day into the future, with no human in the loop
// at any point.
//
// So publication now requires a second, separate fact: an entry in
// data/admin/publication_approvals.json naming who approved this specific item.
// Only scripts/admin/approve_publication.mjs writes there, and it is reachable only
// through workflow_dispatch. A cron cannot approve anything, and no code path
// approves on a person's behalf.
//
// This is the same shape horse-legal-guide-velocity already uses, where approval
// lives outside the automated pipeline and the publish step is a gate rather than
// a scheduler.
function loadApprovedIds(explicit) {
  if (explicit) return explicit instanceof Set ? explicit : new Set(explicit);
  if (!fs.existsSync(APPROVALS_PATH)) return new Set();
  const doc = JSON.parse(fs.readFileSync(APPROVALS_PATH, 'utf8'));
  return new Set(
    (doc.approvals || [])
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.approvedBy === 'string' && entry.approvedBy.trim())
      .map((entry) => entry.id)
  );
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

  const approvedIds = loadApprovedIds(options.approvedIds);
  let changed = false;
  let publishedCount = 0;
  let heldForApproval = 0;

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

    // Due, validated, and still not releasable without a person. Held, not failed:
    // an unapproved queue is a normal state, not a broken one.
    if (!approvedIds.has(item.id)) {
      heldForApproval += 1;
      return item;
    }

    const { previewPath: _removedPreviewPath, ...publishedItem } = item;
    changed = true;
    publishedCount += 1;

    return {
      ...publishedItem,
      status: 'published',
      publishedAt: now.toISOString()
    };
  });

  return { manifest: updated, changed, publishedCount, heldForApproval };
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
  ISO_WITH_TIMEZONE,
  parseScheduledAt,
  processManifest,
  publishManifestFile,
  writeJsonAtomically
};
