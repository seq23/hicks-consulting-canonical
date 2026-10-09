const { read, fail } = require('./util');
const manifest = JSON.parse(read('data/admin/content_manifest.json'));
const { MANIFEST_STATUSES } = require('../../scripts/publishing/manifest_statuses.js');
const allowed = new Set(MANIFEST_STATUSES);
if (!manifest.length) fail('Publish state examined 0 manifest items.');
for (const item of manifest) {
  if (!item.id || !item.slug || !item.type) fail(`Manifest item missing core fields: ${JSON.stringify(item)}`);
  if (!allowed.has(item.status)) fail(`Invalid status ${item.status}`);
  if (item.status !== 'draft' && item.validationPassed !== true) fail(`Non-draft item must be validation-passed: ${item.id}`);
  if (item.status === 'published' && !item.requiresFooter) fail(`Published item missing footer flag ${item.id}`);
}
console.log(`Publish state OK (${manifest.length} manifest items, statuses from scripts/publishing/manifest_statuses.js).`);
