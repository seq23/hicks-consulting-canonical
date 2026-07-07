const fs = require('fs');
const { fail } = require('../validation/protocol');

const requiredFiles = [
  'pages/resources/index.html',
  'pages/resources/free-downloads/index.html',
  'pages/resources/premium-downloads/index.html',
  'assets/js/digital-products.js',
  'data/products/digital_products.json'
];
for (const file of requiredFiles) if (!fs.existsSync(file)) fail(`Missing required product route file: ${file}`);
const resources = fs.readFileSync('pages/resources/index.html', 'utf8');
for (const token of [
  'FEATURED PREMIUM DOWNLOAD',
  'FEATURED FREE DOWNLOAD',
  '/resources/free-downloads/',
  '/resources/premium-downloads/',
  'expanded-resource-taxonomy',
  'FREE DOWNLOADS',
  'PREMIUM DOWNLOADS'
]) if (!resources.includes(token)) fail(`Resources page missing token: ${token}`);
const css = fs.readFileSync('assets/css/styles.css', 'utf8');
for (const token of ['.expanded-resource-taxonomy', 'repeat(3, minmax(0, 1fr))', '.featured-download-grid', '.digital-download-grid']) {
  if (!css.includes(token)) fail(`CSS missing digital route token: ${token}`);
}
const build = fs.readFileSync('scripts/site_build.js', 'utf8');
for (const route of ['/resources/free-downloads/', '/resources/premium-downloads/']) {
  if (!build.includes(route)) fail(`Build script must include public route: ${route}`);
}
console.log('Digital product route contract OK');
