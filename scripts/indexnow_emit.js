#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const reportsDir = path.join(root, 'reports');
const siteConfigPath = path.join(root, 'data', 'system', 'config.json');
const siteConfig = fs.existsSync(siteConfigPath) ? JSON.parse(fs.readFileSync(siteConfigPath, 'utf8')) : {};
const canonicalDomain = String(process.env.SITE_URL || siteConfig.canonicalDomain || 'https://www.hicksconsulting.org').replace(/\/$/, '');
const sitemapPath = fs.existsSync(path.join(root, 'dist', 'sitemap.xml')) ? path.join(root, 'dist', 'sitemap.xml') : path.join(root, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
  console.error(`IndexNow emit failed: sitemap not found at ${sitemapPath}`);
  process.exit(1);
}
const xml = fs.readFileSync(sitemapPath, 'utf8');
const urls = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1].trim()).filter(Boolean);
const bad = urls.filter(url => !url.startsWith(`${canonicalDomain}/`) && url !== `${canonicalDomain}`);
if (bad.length) {
  console.error('IndexNow emit failed: sitemap contains URLs outside canonical domain:');
  for (const url of bad.slice(0, 20)) console.error(`- ${url}`);
  if (bad.length > 20) console.error(`...and ${bad.length - 20} more`);
  process.exit(1);
}
const priorityPathHints = [
  '/',
  '/therapy/',
  '/coaching/',
  '/corporate-speaking/',
  '/organizational-training-inquiry/',
  '/contact/',
  '/resources/'
];
const priority = [];
for (const hint of priorityPathHints) {
  const full = `${canonicalDomain}${hint}`;
  if (urls.includes(full)) priority.push(full);
}
const resourceUrls = urls.filter(url => /\/resources\//.test(url) && !/\/resources\/$/.test(url));
for (const url of resourceUrls.slice(-10)) {
  if (!priority.includes(url)) priority.push(url);
}
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, 'indexnow-priority.txt'), priority.join('\n') + (priority.length ? '\n' : ''));
fs.writeFileSync(path.join(reportsDir, 'indexnow-batch.txt'), urls.join('\n') + (urls.length ? '\n' : ''));
const manifest = {
  repo: 'hicks-consulting-canonical',
  host: new URL(canonicalDomain).host,
  canonicalDomain,
  generatedAt: new Date().toISOString(),
  sitemapSource: path.relative(root, sitemapPath),
  priorityCount: priority.length,
  batchCount: urls.length,
  priorityFile: 'reports/indexnow-priority.txt',
  batchFile: 'reports/indexnow-batch.txt'
};
fs.writeFileSync(path.join(reportsDir, 'indexnow-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`IndexNow emit complete: priority=${priority.length}, batch=${urls.length}`);
