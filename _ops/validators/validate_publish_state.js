const { read, fail } = require('./util');
const manifest = JSON.parse(read('data/admin/content_manifest.json'));
const allowed = new Set(['draft','ready_for_approval','approved','published','revoked']);
for (const item of manifest) {
  if (!item.id || !item.slug || !item.type) fail(`Manifest item missing core fields: ${JSON.stringify(item)}`);
  if (!allowed.has(item.status)) fail(`Invalid status ${item.status}`);
  if (item.status !== 'draft' && item.validationPassed !== true) fail(`Non-draft item must be validation-passed: ${item.id}`);
  if (item.status === 'published' && !item.requiresFooter) fail(`Published item missing footer flag ${item.id}`);
}
console.log('Publish state OK');
