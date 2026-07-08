const fs = require('fs');
const { fail } = require('../validation/protocol');

const adminPage = fs.readFileSync('pages/admin/digitalproducts/index.html', 'utf8');
for (const token of [
  'Digital Products',
  'Admin sign in',
  'How to use this page',
  'Step 1',
  'Step 2',
  'Step 3',
  'Smart filters',
  'Add or update a product',
  'Product type',
  'Price label',
  'Gumroad URL',
  'PDF file',
  'Optional cover / preview image',
  'Publish only when ready',
  'admin-digital-products.js'
]) if (!adminPage.includes(token)) fail(`Admin digital products page missing token: ${token}`);

for (const forbidden of ['Admin API token', 'admin-api-token', 'x-admin-token']) {
  if (adminPage.includes(forbidden)) fail(`Admin digital products page must not expose deprecated token UX: ${forbidden}`);
}

if (adminPage.indexOf('Smart filters') > adminPage.indexOf('Add or update a product')) {
  fail('Smart filters must appear above the add/update product form.');
}

const adminHome = fs.readFileSync('pages/admin/index.html', 'utf8');
if (!adminHome.includes('/admin/digitalproducts/')) fail('Admin home must link to digital products manager.');

const js = fs.readFileSync('assets/js/admin-digital-products.js', 'utf8');
for (const token of ['ADMIN_AUTH_HASH_KEY', 'x-admin-password-hash', 'adminAuthHeaders', 'clearAdminAuthHash', 'priceLabel', '$10', 'gumroadUrl', 'FormData', '/api/digital-products/update', '/api/digital-products/publish', '/api/digital-products/revoke', 'data-publish-product', 'data-revoke-product', 'Publish remains a separate intentional action']) {
  if (!js.includes(token)) fail(`Admin JS missing token: ${token}`);
}
if (js.includes('admin-api-token') || js.includes('x-admin-token')) fail('Admin JS must not depend on deprecated visible API token auth.');

const fn = fs.readFileSync('functions/api/digital-products/_shared.js', 'utf8');
for (const token of ['DIGITAL_PRODUCTS_KV', 'DIGITAL_PRODUCT_FILES', 'DIGITAL_PRODUCTS_ADMIN_HASH', 'x-admin-password-hash', 'priceLabel', 'gumroadUrl', 'placeholder']) {
  if (!fn.includes(token)) fail(`Digital products API shared contract missing token: ${token}`);
}
if (fn.includes('DIGITAL_PRODUCTS_ADMIN_TOKEN') || fn.includes('x-admin-token')) fail('Digital products shared API must not require deprecated token auth.');

const worker = fs.readFileSync('worker/_worker.js', 'utf8');
for (const token of ['DIGITAL_PRODUCTS_ADMIN_HASH', 'x-admin-password-hash', 'Admin password did not match.']) {
  if (!worker.includes(token)) fail(`Worker digital products auth missing token: ${token}`);
}
if (worker.includes('DIGITAL_PRODUCTS_ADMIN_TOKEN') || worker.includes('x-admin-token')) fail('Worker must not require deprecated digital products token auth.');

console.log('Digital product upload/admin contract OK');
