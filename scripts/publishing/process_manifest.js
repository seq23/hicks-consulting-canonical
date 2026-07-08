const fs = require('fs');
const path = require('path');

const ISO_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

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

function processManifest(manifest, now = new Date()) {
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

  let changed = false;
  let publishedCount = 0;

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

    const { previewPath: _removedPreviewPath, ...publishedItem } = item;
    changed = true;
    publishedCount += 1;

    return {
      ...publishedItem,
      status: 'published',
      publishedAt: now.toISOString()
    };
  });

  return { manifest: updated, changed, publishedCount };
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
  now = new Date()
} = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const result = processManifest(manifest, now);

  if (result.changed) {
    writeJsonAtomically(manifestPath, result.manifest);
    console.log(`Manifest updated: ${result.publishedCount} scheduled item(s) published.`);
  } else {
    console.log('Manifest unchanged: no approved items are due.');
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
  ISO_WITH_TIMEZONE,
  parseScheduledAt,
  processManifest,
  publishManifestFile,
  writeJsonAtomically
};
