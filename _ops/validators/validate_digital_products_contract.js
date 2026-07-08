const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`${file} is invalid JSON: ${error.message}`); }
}

const root = process.cwd();
const catalogPath = path.join(root, 'data/products/digital_products.json');
const schemaPath = path.join(root, 'data/products/digital_products.schema.json');
if (!fs.existsSync(catalogPath)) fail('Missing data/products/digital_products.json');
if (!fs.existsSync(schemaPath)) fail('Missing data/products/digital_products.schema.json');
const catalog = readJson(catalogPath);
const schema = readJson(schemaPath);
if (!Array.isArray(catalog.products)) fail('Digital products catalog must expose products array.');
const ids = new Set();
const featuredByType = new Map();
for (const item of catalog.products) {
  for (const field of schema.requiredProductFields) {
    if (!(field in item)) fail(`Product ${item.id || '(missing id)'} missing required field: ${field}`);
  }
  if (ids.has(item.id)) fail(`Duplicate digital product id: ${item.id}`);
  ids.add(item.id);
  if (!schema.allowedProductTypes.includes(item.productType)) fail(`Invalid product type for ${item.id}`);
  if (!schema.allowedStatuses.includes(item.status)) fail(`Invalid product status for ${item.id}`);
  if (!schema.allowedCheckoutStatuses.includes(item.checkoutStatus)) fail(`Invalid checkout status for ${item.id}`);
  if (item.productType === 'free' && item.status === 'published' && !item.downloadUrl) fail(`Published free download ${item.id} requires downloadUrl.`);
  if (item.productType === 'premium' && item.status === 'published') {
    if (!item.gumroadUrl) fail(`Published premium download ${item.id} requires gumroadUrl.`);
    if (item.gumroadUrl === 'https://www.gumroad.com') fail(`Published premium download ${item.id} may not use placeholder Gumroad URL.`);
    if (item.checkoutStatus !== 'live') fail(`Published premium download ${item.id} must use live checkout status.`);
    if (!item.priceLabel) fail(`Published premium download ${item.id} requires priceLabel.`);
    if (!String(item.buttonLabel || '').includes(item.priceLabel)) fail(`Premium CTA for ${item.id} must include price label.`);
  }
  if (item.featured === true) {
    const current = featuredByType.get(item.productType);
    if (current) fail(`Only one featured ${item.productType} product is allowed: ${current} and ${item.id}.`);
    featuredByType.set(item.productType, item.id);
  }
}
if (!ids.has('stress-management-made-simple')) fail('Seed free worksheet product is missing.');
if (!ids.has('high-performing-womans-guide')) fail('Seed premium workbook product is missing.');

const adminPage = fs.readFileSync(path.join(root, 'pages/admin/digitalproducts/index.html'), 'utf8');
for (const token of ['How to use this page', 'Step 1', 'Step 2', 'Step 3', 'Smart filters', 'Add or update a product']) {
  if (!adminPage.includes(token)) fail(`Admin digital products UX missing token: ${token}`);
}
if (adminPage.includes('Admin API token') || adminPage.includes('admin-api-token') || adminPage.includes('x-admin-token')) {
  fail('Admin digital products UX must not expose deprecated API token language.');
}
if (adminPage.indexOf('Smart filters') > adminPage.indexOf('Add or update a product')) {
  fail('Admin smart filters must appear before the add/update product box.');
}

console.log('Digital products catalog contract OK');
