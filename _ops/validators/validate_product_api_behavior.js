const fs = require('fs');
const { fail } = require('../validation/protocol');

const shared = fs.readFileSync('functions/api/digital-products/_shared.js', 'utf8');
const publish = fs.readFileSync('functions/api/digital-products/publish.js', 'utf8');
const update = fs.readFileSync('functions/api/digital-products/update.js', 'utf8');

const requiredShared = [
  'export function mergeProduct',
  'if (!incoming.downloadUrl && existing && existing.downloadUrl) merged.downloadUrl = existing.downloadUrl;',
  'if (!incoming.coverImageUrl && existing && existing.coverImageUrl) merged.coverImageUrl = existing.coverImageUrl;',
  "merged.checkoutStatus = 'live';",
  "Published premium downloads require live checkout status.",
  "status === 'published' ? 'live' : 'ready'"
];
for (const token of requiredShared) {
  if (!shared.includes(token)) fail(`Digital products shared API missing behavior guard: ${token}`);
}
if (!publish.includes("checkoutStatus: item.productType === 'premium' ? 'live' : item.checkoutStatus")) {
  fail('Publish endpoint must promote premium checkoutStatus to live only during publish action.');
}
if (!update.includes('validateProductForPublication(product)')) fail('Update endpoint must validate publish attempts before writing.');
if (!update.includes('upsertProduct(catalog, product)')) fail('Update endpoint must merge product records instead of replacing blindly.');
console.log('Digital product API behavior contract OK');
