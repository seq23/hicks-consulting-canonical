const { fs, path, read, fail } = require('./util');
const manifest = JSON.parse(read('data/admin/content_manifest.json'));
const allowedTypes = new Set(['insights', 'articles', 'guides', 'white-papers']);
const oldCadence = /^\/resources\/(daily|weekly|monthly|quarterly)\//;
let checked = 0;
let previewChecked = 0;
let publishedChecked = 0;
for (const item of manifest) {
  if (item.validationPassed !== true) continue;
  if (!item.slug || !item.publicPath || !item.contentType) fail(`Manifest item ${item.id} missing slug/publicPath/contentType`);
  if (!allowedTypes.has(item.contentType)) fail(`Manifest item ${item.id} has invalid contentType: ${item.contentType}`);
  for (const field of ['slug', 'publicPath', 'previewPath']) {
    if (item[field] && oldCadence.test(item[field])) fail(`Manifest item ${item.id} uses stale cadence route in ${field}: ${item[field]}`);
  }
  if (item.publicPath !== item.slug) fail(`Manifest item ${item.id} publicPath must match slug: ${item.publicPath} !== ${item.slug}`);
  const source = path.join(process.cwd(), 'pages', item.publicPath.replace(/^\//, ''), 'index.html');
  if (!fs.existsSync(source)) fail(`Manifest item ${item.id} public source page missing: ${item.publicPath}`);
  if (item.status === 'published') {
    if (item.previewPath) fail(`Manifest item ${item.id} is published and should not require a previewPath`);
    publishedChecked += 1;
  } else {
    if (!item.previewPath) fail(`Manifest item ${item.id} missing previewPath for unpublished review item`);
    if (item.previewPath !== `/preview${item.publicPath}`) fail(`Manifest item ${item.id} previewPath must be /preview + publicPath`);
    previewChecked += 1;
  }
  checked += 1;
}
console.log(`Admin preview manifest OK (${checked} items checked, ${previewChecked} review previews, ${publishedChecked} live public items).`);
