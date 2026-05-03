const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dist = path.join(root, 'dist');
const pages = path.join(root, 'pages');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'admin', 'content_manifest.json'), 'utf8'));
const siteConfig = JSON.parse(fs.readFileSync(path.join(root, 'data', 'system', 'config.json'), 'utf8'));
const canonicalDomain = (siteConfig.canonicalDomain || 'https://www.hicksconsulting.org').replace(/\/$/, '');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function removeRecursive(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function slugToDistPath(slug) {
  const clean = slug.replace(/^\//, '').replace(/\/$/, '');
  if (!clean) return dist;
  return path.join(dist, clean);
}

copyRecursive(pages, dist);
copyRecursive(path.join(root, 'assets'), path.join(dist, 'assets'));
copyRecursive(path.join(root, 'data'), path.join(dist, 'data'));
['robots.txt','_headers','_redirects','llms.txt','answers.json','coverage.json'].forEach(file => {
  copyRecursive(path.join(root, file), path.join(dist, file));
});

const publishedResourceSlugs = new Set(
  manifest
    .filter(item => item.validationPassed === true && item.status === 'published' && item.slug.startsWith('/resources/'))
    .map(item => item.slug.replace(/\/$/, '/'))
);

for (const item of manifest.filter(item => item.slug.startsWith('/resources/') && item.slug !== '/resources/')) {
  const normalized = item.slug.replace(/\/$/, '/');
  if (!publishedResourceSlugs.has(normalized)) {
    removeRecursive(slugToDistPath(normalized));
  }
}

const staticPublicRoutes = [
  '/', '/therapy/', '/coaching/', '/groups/', '/corporate-speaking/', '/about/', '/resources/', '/contact/',
  '/intake-quiz/', '/request-consult/', '/book-discovery-call/', '/faq/', '/privacy-policy/', '/cookie-policy/', '/disclaimer/',
  '/terms/', '/good-faith-estimate/', '/emergency-crisis-notice/'
];
const urls = [...staticPublicRoutes, ...Array.from(publishedResourceSlugs)].map(route => `${canonicalDomain}${route}`);
const sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls.map(url => `  <url><loc>${url}</loc></url>`), '</urlset>'].join('\n');
fs.writeFileSync(path.join(root, 'sitemap.xml'), sitemap + '\n');
fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap + '\n');

console.log('Build complete:', dist);
