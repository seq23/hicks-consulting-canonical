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

function sourcePathForRoute(route) {
  const clean = route.replace(/^\//, '').replace(/\/$/, '');
  return path.join(pages, clean, 'index.html');
}

function previewDistPathForRoute(route) {
  const clean = route.replace(/^\//, '').replace(/\/$/, '');
  return path.join(dist, 'preview', clean, 'index.html');
}

function preparePreviewHtml(html, item) {
  let out = html;
  if (!/name=["']robots["']/i.test(out)) {
    out = out.replace('<head>', '<head><meta name="robots" content="noindex,nofollow"/>');
  }
  out = out.replace(/<link href="https:\/\/www\.hicksconsulting\.org[^"]*" rel="canonical"\/>/, `<link href="${canonicalDomain}${item.publicPath || item.slug}" rel="canonical"/>`);
  const banner = `<div class="notice preview-notice"><strong>Preview mode.</strong> This content is loaded for admin review and may not be publicly listed yet. Status: ${item.status}.</div>`;
  out = out.replace('<main', `${banner}<main`);
  return out;
}

function copyPreviewForItem(item) {
  const route = item.publicPath || item.slug;
  if (!route || !route.startsWith('/resources/')) return;
  const src = sourcePathForRoute(route);
  if (!fs.existsSync(src)) return;
  const dest = previewDistPathForRoute(route);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const html = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(dest, preparePreviewHtml(html, item));
}

copyRecursive(pages, dist);
copyRecursive(path.join(root, 'assets'), path.join(dist, 'assets'));
copyRecursive(path.join(root, 'data'), path.join(dist, 'data'));
['robots.txt','_headers','_redirects','llms.txt','answers.json','coverage.json','indexnow.txt','0ccfc65ebb714f0a804be19ff50c9be4.txt'].forEach(file => {
  copyRecursive(path.join(root, file), path.join(dist, file));
});

for (const item of manifest.filter(item => item.validationPassed === true && item.status !== 'published' && item.slug.startsWith('/resources/'))) {
  copyPreviewForItem(item);
}

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
  '/', '/therapy/', '/coaching/', '/groups/', '/corporate-speaking/', '/about/', '/resources/', '/contact/', '/organizational-training-inquiry/',
  '/intake-quiz/', '/stress-management-worksheet/', '/resources/insights/', '/resources/articles/', '/resources/guides/', '/resources/white-papers/', '/request-consult/', '/book-discovery-call/', '/faq/', '/privacy-policy/', '/cookie-policy/', '/disclaimer/',
  '/terms/', '/good-faith-estimate/', '/emergency-crisis-notice/'
];

const llmOnlyRoutes = [
  '/llm-atlas/',
  '/llm-atlas/fanouts/',
  '/llm-atlas/queries/',
  '/llm-atlas/pillars/',
  '/llm-atlas/clusters/',
  '/llm-atlas/social-signals/',
  '/llm-atlas/source-health/',
  '/llm-atlas/answer-surfaces/'
];

const urls = [...staticPublicRoutes, ...llmOnlyRoutes, ...Array.from(publishedResourceSlugs)].map(route => `${canonicalDomain}${route}`);
const sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls.map(url => `  <url><loc>${url}</loc></url>`), '</urlset>'].join('\n');
fs.writeFileSync(path.join(root, 'sitemap.xml'), sitemap + '\n');
fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap + '\n');

const llms = [
  '# Hicks Consulting',
  '',
  'Hicks Consulting helps clients heal beyond survival through virtual therapy, coaching, support groups, consulting, and organizational training.',
  '',
  'Primary public routes:',
  ...staticPublicRoutes.map(route => `- ${route}`),
  '',
  'LLM-only crawler-discoverable routes, intentionally excluded from user navigation:',
  ...llmOnlyRoutes.map(route => `- ${route}`),
  '',
  'Machine-readable files:',
  '- /answers.json',
  '- /coverage.json',
  '- /data/query_coverage_map.json',
  '- /data/query_metadata.json',
  '- /data/internal_authority_graph.json',
  '- /data/entities/entity_registry.json',
  '',
  'Conversion paths:',
  `- Therapy and coaching consults: ${siteConfig.forms?.therapy || 'https://monika-hicks.clientsecure.me/'}`,
  `- Organizational training: ${siteConfig.forms?.corporate || '/organizational-training-inquiry/'}`,
  `- Groups: ${siteConfig.forms?.groups || '/groups/#group-inquiry-form'}`,
  `- Free stress management worksheet: ${siteConfig.leadMagnets?.stressManagementWorksheet?.slug || '/stress-management-worksheet/'}`
].join('\n');
fs.writeFileSync(path.join(root, 'llms.txt'), llms + '\n');
fs.writeFileSync(path.join(dist, 'llms.txt'), llms + '\n');


const workerSource = path.join(root, 'worker', '_worker.js');
if (fs.existsSync(workerSource)) {
  fs.copyFileSync(workerSource, path.join(dist, '_worker.js'));
}

console.log('Build complete:', dist);
