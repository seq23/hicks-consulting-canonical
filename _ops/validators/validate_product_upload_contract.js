const fs = require('fs');
const { fail } = require('../validation/protocol');

const adminPage = fs.readFileSync('pages/admin/digitalproducts/index.html', 'utf8');
for (const token of [
  'Digital Products',
  'Product type',
  'Price label',
  'Gumroad URL',
  'PDF file',
  'Optional cover / preview image',
  'Publish only when ready',
  'admin-digital-products.js'
]) if (!adminPage.includes(token)) fail(`Admin digital products page missing token: ${token}`);
const adminHome = fs.readFileSync('pages/admin/index.html', 'utf8');
if (!adminHome.includes('/admin/digitalproducts/')) fail('Admin home must link to digital products manager.');
const js = fs.readFileSync('assets/js/admin-digital-products.js', 'utf8');
for (const token of ['priceLabel', '$10', 'gumroadUrl', 'FormData', '/api/digital-products/update', '/api/digital-products/publish', '/api/digital-products/revoke', 'data-publish-product', 'data-revoke-product', 'Publish remains a separate intentional action']) {
  if (!js.includes(token)) fail(`Admin JS missing token: ${token}`);
}
const fn = fs.readFileSync('functions/api/digital-products/_shared.js', 'utf8');
for (const token of ['DIGITAL_PRODUCTS_KV', 'DIGITAL_PRODUCT_FILES', 'DIGITAL_PRODUCTS_ADMIN_TOKEN', 'priceLabel', 'gumroadUrl', 'placeholder']) {
  if (!fn.includes(token)) fail(`Digital products API shared contract missing token: ${token}`);
}
console.log('Digital product upload/admin contract OK');
