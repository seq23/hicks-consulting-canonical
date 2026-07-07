const fs = require('fs');
const { fail } = require('../validation/protocol');

const publicJs = fs.readFileSync('assets/js/digital-products.js', 'utf8');
for (const token of ['coverImageUrl', 'pdf_first_page', 'digital-product-pdf-cover', 'branded_placeholder']) {
  if (!publicJs.includes(token)) fail(`Public digital products JS missing cover fallback token: ${token}`);
}
const adminJs = fs.readFileSync('assets/js/admin-digital-products.js', 'utf8');
if (!adminJs.includes('Optional cover / preview image') && !fs.readFileSync('pages/admin/digitalproducts/index.html', 'utf8').includes('Optional cover / preview image')) fail('Admin flow must expose optional cover upload.');
const api = fs.readFileSync('functions/api/digital-products/_shared.js', 'utf8');
for (const token of ['coverSource', 'custom_image', 'pdf_first_page', 'branded_placeholder']) {
  if (!api.includes(token)) fail(`API cover contract missing token: ${token}`);
}
console.log('Digital product cover contract OK');
