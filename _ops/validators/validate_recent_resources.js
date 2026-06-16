const fs = require('fs');
const path = require('path');
const { warn } = require('../validation/protocol');
const { selectRecentPublishedResources } = require('../../assets/js/resource-selection');

const root = process.cwd();
const warnings = [];
const manifestPath = path.join(root, 'data', 'admin', 'content_manifest.json');
const pagePath = path.join(root, 'pages', 'resources', 'index.html');
const siteJsPath = path.join(root, 'assets', 'js', 'site.js');

function add(message) {
  warnings.push(`RECENT RESOURCES STRONG WARNING: ${message}`);
}

function independentTime(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function independentReleaseTime(item) {
  return independentTime(item?.publishedAt || item?.scheduledAt);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const page = fs.readFileSync(pagePath, 'utf8');
const siteJs = fs.readFileSync(siteJsPath, 'utf8');

if (!page.includes('<h2>Recently published resources</h2>')) {
  add('The /resources page heading must be exactly “Recently published resources”.');
}
if (!page.includes('/assets/js/resource-selection.js')) {
  add('The /resources page must load /assets/js/resource-selection.js before site.js.');
}
if (!siteJs.includes('selectRecentPublishedResources(items, 4)')) {
  add('The public resources renderer must request exactly four recent published resources.');
}
const rendererStart = siteJs.indexOf('async function renderPublishedResources(containerId)');
const rendererEnd = rendererStart >= 0 ? siteJs.indexOf('async function wireFormLinks', rendererStart) : -1;
const rendererSource = rendererStart >= 0 && rendererEnd > rendererStart
  ? siteJs.slice(rendererStart, rendererEnd)
  : '';
if (!rendererSource.includes('container.innerHTML = recentItems.map')) {
  add('The /resources card renderer must render recentItems rather than the full published manifest.');
}
if (rendererSource.includes('container.innerHTML = items.map')) {
  add('The /resources card renderer still maps the full published manifest.');
}

const eligible = manifest
  .filter((item) => item?.validationPassed === true && item?.status === 'published' && String(item?.slug || '').startsWith('/resources/') && item.slug !== '/resources/')
  .slice()
  .sort((a, b) => {
    const publishedDifference = independentReleaseTime(b) - independentReleaseTime(a);
    if (publishedDifference !== 0) return publishedDifference;
    const scheduledDifference = independentTime(b?.scheduledAt) - independentTime(a?.scheduledAt);
    if (scheduledDifference !== 0) return scheduledDifference;
    return String(a.slug || a.id || '').localeCompare(String(b.slug || b.id || ''));
  });

const expected = eligible.slice(0, 4);
const actual = selectRecentPublishedResources(manifest, 4);
const expectedIds = expected.map((item) => item.id || item.slug);
const actualIds = actual.map((item) => item.id || item.slug);

if (actual.length !== Math.min(4, eligible.length)) {
  add(`Expected ${Math.min(4, eligible.length)} recent cards, selected ${actual.length}.`);
}
if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
  add(`Newest-four order mismatch. Expected ${expectedIds.join(', ') || '(none)'}; got ${actualIds.join(', ') || '(none)'}.`);
}

if (warnings.length) {
  warn(warnings, `${warnings.length}-recent-resource-finding(s)`);
} else {
  console.log(`Recent resources contract OK (${actual.length} newest published resource${actual.length === 1 ? '' : 's'} selected).`);
}
process.exit(0);
