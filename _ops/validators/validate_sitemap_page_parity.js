const { fs, path, read, fail } = require('./util');
const xml = read('sitemap.xml');
const manifest = JSON.parse(read('data/admin/content_manifest.json'));
const publishedContent = new Set(
  manifest.filter(item => item.validationPassed === true && item.status === 'published').map(item => item.slug)
);

function walk(dir, arr = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, arr);
    else if (entry === 'index.html') arr.push(full);
  }
  return arr;
}

for (let route of walk(path.join(process.cwd(), 'pages')).map(file => {
  let value = '/' + path.relative(path.join(process.cwd(), 'pages'), path.dirname(file)).replace(/\\/g, '/');
  if (value === '/' || value === '/.') return '/';
  return value + '/';
})) {
  if (route === '/admin/' || route === '/agency/') continue;
  if (route.startsWith('/resources/') && route !== '/resources/' && !publishedContent.has(route)) continue;
  const loc = `https://www.hicksconsulting.org${route}`;
  if (!xml.includes(loc)) fail(`Missing route in sitemap: ${loc}`);
}
console.log('Sitemap parity OK');
