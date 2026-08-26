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

function injectPersonSchema() {
  const schemaPath = path.join(root, 'data', 'entities', 'person_schema.json');
  const aboutPath = path.join(dist, 'about', 'index.html');
  if (!fs.existsSync(schemaPath) || !fs.existsSync(aboutPath)) return;
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  let html = fs.readFileSync(aboutPath, 'utf8');
  const marker = '<script id="monika-person-schema" type="application/ld+json">';
  if (html.includes(marker)) return;
  const payload = `${marker}${JSON.stringify(schema)}</script>`;
  html = html.replace('</head>', `${payload}</head>`);
  fs.writeFileSync(aboutPath, html);
}

function injectOrganizationSchema() {
  const schemaPath = path.join(root, 'data', 'entities', 'org_schema.json');
  const homePath = path.join(dist, 'index.html');
  if (!fs.existsSync(schemaPath) || !fs.existsSync(homePath)) return;
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  let html = fs.readFileSync(homePath, 'utf8');
  const payload = `<script id="hicks-organization-schema" type="application/ld+json">${JSON.stringify(schema)}</script>`;
  const legacyOrganization = /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"Organization"[\s\S]*?<\/script>/;
  if (html.includes('id="hicks-organization-schema"')) return;
  if (legacyOrganization.test(html)) {
    html = html.replace(legacyOrganization, payload);
  } else {
    html = html.replace('</head>', `${payload}</head>`);
  }
  fs.writeFileSync(homePath, html);
}

copyRecursive(pages, dist);
copyRecursive(path.join(root, 'assets'), path.join(dist, 'assets'));
copyRecursive(path.join(root, 'data'), path.join(dist, 'data'));
['robots.txt','_headers','_redirects','llms.txt','answers.json','coverage.json','indexnow.txt','0ccfc65ebb714f0a804be19ff50c9be4.txt'].forEach(file => {
  copyRecursive(path.join(root, file), path.join(dist, file));
});
injectPersonSchema();
injectOrganizationSchema();

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
  '/', '/therapy/', '/black-therapist-memphis/', '/anxiety-therapist-memphis/', '/coaching/', '/groups/', '/corporate-speaking/', '/about/', '/resources/', '/contact/', '/organizational-training-inquiry/',
  '/intake-quiz/', '/stress-management-worksheet/', '/resources/insights/', '/resources/articles/', '/resources/guides/', '/resources/white-papers/', '/resources/free-downloads/', '/resources/premium-downloads/', '/request-consult/', '/book-discovery-call/', '/faq/', '/privacy-policy/', '/cookie-policy/', '/disclaimer/',
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

const sitemapRoutes = [...staticPublicRoutes, ...llmOnlyRoutes, ...Array.from(publishedResourceSlugs)];

// <lastmod> is metadata about the sitemap entry, not page content: emitting it
// changes nothing on any published page. It was absent on all 95 URLs, which
// data/cadence/policy.json treats as a blocking no_freshness_signal and which
// leaves a crawler no way to tell what changed.
//
// The date is keyed on a hash of the rendered page rather than read from git at
// build time. `git log -1` would report the tip commit for every file in the
// depth-1 checkouts CI uses, stamping one uniform date across the whole
// library - the date-bump pattern scripts/cadence_gate.js exists to flag. The
// ledger only consults git to seed a URL it has never seen, and only when the
// clone actually has the history. See scripts/lib/lastmod_ledger.js.
const ledgerLib = require('./lib/lastmod_ledger');
const today = ledgerLib.buildDate();
const ledger = ledgerLib.load();
const ledgerPages = {};
for (const route of sitemapRoutes) {
  const url = `${canonicalDomain}${route}`;
  const clean = route.replace(/^\//, '').replace(/\/$/, '');
  const rendered = clean ? path.join(dist, clean, 'index.html') : path.join(dist, 'index.html');
  const source = path.posix.join('pages', clean, 'index.html');
  // Hash the rendered page so the date follows what a crawler actually sees.
  // A route with no rendered file is left out of the ledger rather than hashed
  // as empty, which would make every such URL share one bogus identity.
  if (!fs.existsSync(rendered)) continue;
  ledgerPages[url] = { hash: ledgerLib.contentHash(fs.readFileSync(rendered)), file: source };
}
const lastmods = ledgerLib.resolve(ledgerPages, ledger, today);
ledgerLib.save(ledgerLib.rebuilt(ledgerPages, ledger, today, { prune: true }));

const urls = sitemapRoutes.map(route => `${canonicalDomain}${route}`);
const sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls.map(url => {
  const lm = lastmods[url];
  // No date is invented for a URL the ledger could not resolve; it keeps the
  // shape it had before rather than being stamped with today.
  return lm ? `  <url><loc>${url}</loc><lastmod>${lm}</lastmod></url>` : `  <url><loc>${url}</loc></url>`;
}), '</urlset>'].join('\n');
fs.writeFileSync(path.join(root, 'sitemap.xml'), sitemap + '\n');
fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap + '\n');
const dated = urls.filter(u => lastmods[u]).length;
console.log(`sitemap: ${urls.length} url(s), ${dated} with lastmod (ledger: data/cadence/lastmod_ledger.json)`);

const llms = [
  '# Hicks Consulting',
  '',
  'Hicks Consulting helps clients heal beyond survival through virtual therapy, coaching, support groups, consulting, and organizational training.',
  '',
  'Primary public routes:',
  ...staticPublicRoutes.map(route => `- ${route}`),
  '',
  'LLM-only crawler-discoverable routes, included in sitemap but intentionally excluded from user navigation:',
  ...llmOnlyRoutes.map(route => `- ${route}`),
  '',
  'Machine-readable files:',
  '- /answers.json',
  '- /coverage.json',
  '- /data/query_coverage_map.json',
  '- /data/query_metadata.json',
  '- /data/internal_authority_graph.json',
  '- /data/entities/entity_registry.json',
  '- /data/entities/person_schema.json',
  '- /data/entities/org_schema.json',
  '',
  'Conversion paths:',
  `- Therapy and coaching consults: ${siteConfig.forms?.therapy || 'https://monika-hicks.clientsecure.me/'}`,
  `- Organizational training: ${siteConfig.forms?.corporate || '/organizational-training-inquiry/'}`,
  `- Groups: ${siteConfig.forms?.groups || '/groups/#group-inquiry-form'}`,
  `- Free stress management worksheet: ${siteConfig.leadMagnets?.stressManagementWorksheet?.slug || '/stress-management-worksheet/'}`,
  '- Free downloads library: /resources/free-downloads/',
  '- Premium downloads library: /resources/premium-downloads/'
].join('\n');
fs.writeFileSync(path.join(root, 'llms.txt'), llms + '\n');
fs.writeFileSync(path.join(dist, 'llms.txt'), llms + '\n');

const workerSource = path.join(root, 'worker', '_worker.js');
if (fs.existsSync(workerSource)) {
  fs.copyFileSync(workerSource, path.join(dist, '_worker.js'));
  copyRecursive(path.join(root, 'worker', 'admin_runtime.mjs'), path.join(dist, 'admin_runtime.mjs'));
}

// Cloudflare Pages answers HTTP 200 with index.html for any unmatched path when
// the output has no 404.html, so every nonexistent URL was serving a duplicate
// of the homepage under a 200 - indexable synthetic URLs at scale. The worker
// falls through to env.ASSETS, which serves this with a real 404 status.
// Emitted here rather than as a separate npm step because validate_agency_
// infrastructure pins package.json "build" to exactly this script.
(() => {
  const indexPath = path.join(dist, 'index.html');
  if (!fs.existsSync(indexPath)) return;
  const index = fs.readFileSync(indexPath, 'utf8');
  const styles = [
    ...(index.match(/<style[\s\S]*?<\/style>/gi) || []),
    ...(index.match(/<link[^>]+rel=["'](?:stylesheet|preconnect)["'][^>]*>/gi) || []),
  ].join('\n');
  const footer = (index.match(/<footer[\s\S]*?<\/footer>/i) || [''])[0];
  const canonicalRaw = (index.match(/<link[^>]*rel=["']canonical["'][^>]*>/i)
    || index.match(/<link[^>]*href=[^>]*rel=["']canonical["'][^>]*>/i) || [''])[0];
  const href = (canonicalRaw.match(/href=["']([^"']+)["']/i) || [])[1];
  let origin = '';
  try { origin = href ? new URL(href).origin : ''; } catch { origin = ''; }
  const titleRaw = (index.match(/<title>([^<]*)<\/title>/i) || [, 'This site'])[1];
  const siteName = titleRaw.split(/\s+[|\u2014-]\s+/)[0].trim();
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ld = { '@context': 'https://schema.org', '@type': 'WebPage', name: `Page not found \u00b7 ${siteName}` };
  if (origin) {
    ld['@id'] = `${origin}/404.html`;
    ld.url = `${origin}/404.html`;
    ld.isPartOf = { '@type': 'WebSite', name: siteName, url: `${origin}/` };
  }
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page not found &middot; ${esc(siteName)}</title>
  <meta name="robots" content="noindex, follow">
  <meta name="description" content="That page could not be found on ${esc(siteName)}. The address may be mistyped, or the page may have been moved or retired.">${origin ? `\n  <link rel="canonical" href="${origin}/404.html">` : ''}
${styles}
  <style>
    .nf-wrap { max-width: 40rem; margin: 0 auto; padding: 4rem 1.25rem; }
    .nf-code { font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; opacity: .7; margin: 0 0 .75rem; }
    .nf-wrap h1 { margin: 0 0 .75rem; text-wrap: balance; }
    .nf-wrap p { margin: 0 0 1.5rem; max-width: 34rem; }
  </style>
</head>
<body>
  <main class="nf-wrap">
    <p class="nf-code">Error 404</p>
    <h1>We couldn&rsquo;t find that page</h1>
    <p>The address may be mistyped, or the page may have been moved or retired since it was linked.</p>
    <p><a href="/">Return to ${esc(siteName)}</a></p>
  </main>
${footer}
  <script type="application/ld+json">${JSON.stringify(ld, null, 2)}</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(dist, '404.html'), html);
})();

// Microsoft Clarity. The project (y7l3sgr1el) already existed but no tag was ever
// installed, so it recorded nothing. Emitted here rather than as a separate npm
// step because validate_agency_infrastructure pins package.json "build" to
// exactly this script.
try { require('./install_clarity_inline')(dist); } catch (error) { console.error('clarity:', error.message); }

require('./agency/generate_agency_report').generate();

console.log('Build complete:', dist);
