const { fs, path, read } = require('./util');
const { warn: reportFindings } = require('../validation/protocol');
const manifest = JSON.parse(read('data/admin/content_manifest.json'));
const allowedTypes = new Set(['insights', 'articles', 'guides', 'white-papers']);
const oldCadence = /^\/resources\/(daily|weekly|monthly|quarterly)\//;
const warnings = [];
let checked = 0;
let previewChecked = 0;
let publishedChecked = 0;

function warn(message) {
  warnings.push(`ADMIN PREVIEW STRONG WARNING: ${message}`);
}

for (const item of manifest) {
  if (item.validationPassed !== true) continue;
  if (!item.slug || !item.publicPath || !item.contentType) warn(`Manifest item ${item.id} missing slug/publicPath/contentType`);
  if (!allowedTypes.has(item.contentType)) warn(`Manifest item ${item.id} has invalid contentType: ${item.contentType}`);
  for (const field of ['slug', 'publicPath', 'previewPath']) {
    if (item[field] && oldCadence.test(item[field])) warn(`Manifest item ${item.id} uses stale cadence route in ${field}: ${item[field]}`);
  }
  if (item.publicPath !== item.slug) warn(`Manifest item ${item.id} publicPath must match slug: ${item.publicPath} !== ${item.slug}`);
  if (item.publicPath) {
    const source = path.join(process.cwd(), 'pages', item.publicPath.replace(/^\//, ''), 'index.html');
    if (!fs.existsSync(source)) warn(`Manifest item ${item.id} public source page missing: ${item.publicPath}`);
  }
  if (item.status === 'published') {
    if (item.previewPath) warn(`Manifest item ${item.id} is published and should not require a previewPath`);
    publishedChecked += 1;
  } else {
    if (!item.previewPath) warn(`Manifest item ${item.id} missing previewPath for unpublished review item`);
    if (item.previewPath && item.publicPath && item.previewPath !== `/preview${item.publicPath}`) warn(`Manifest item ${item.id} previewPath must be /preview + publicPath`);
    previewChecked += 1;
  }
  checked += 1;
}

if (warnings.length) {
  reportFindings(warnings, `${warnings.length}-admin-preview-strong-warning(s)`);
} else {
  console.log(`Admin preview manifest OK (${checked} items checked, ${previewChecked} review previews, ${publishedChecked} live public items).`);
}

// Preview inconsistencies are operational cleanup items, not release blockers.
process.exit(0);
