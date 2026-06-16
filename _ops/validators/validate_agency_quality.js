const fs = require('fs');
const path = require('path');
const { warn } = require('../validation/protocol');

const root = process.cwd();
const findings = [];

function readJson(relative) {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
  catch (error) { findings.push(`${relative} could not be read: ${error.message}`); return null; }
}
function decode(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function articleSchema(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const value = JSON.parse(match[1]);
      if (value && typeof value === 'object' && ['Article', 'BlogPosting', 'NewsArticle'].includes(value['@type'])) return value;
    } catch (_) {}
  }
  return null;
}

const manifest = readJson('data/admin/content_manifest.json') || [];
const dashboard = readJson('data/agency/dashboard.json');
const approved = manifest.filter((item) => item.status === 'approved');
const published = manifest.filter((item) => item.status === 'published');
const serviceLinks = ['/therapy/', '/coaching/', '/groups/', '/corporate-speaking/', '/organizational-training-inquiry/'];

for (const item of approved) {
  const relative = path.join('pages', String(item.slug || '').replace(/^\//, '').replace(/\/$/, ''), 'index.html');
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) { findings.push(`${item.id}: source page missing at ${relative}`); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  const expectedDate = String(item.scheduledAt || '').slice(0, 10);
  if (h1 !== item.title) findings.push(`${item.id}: H1 no longer matches the preserved manifest title.`);
  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{40,}["']/i.test(html) &&
      !/<meta[^>]+content=["'][^"']{40,}["'][^>]+name=["']description["']/i.test(html)) findings.push(`${item.id}: meta description is missing or too short.`);
  if (!html.includes('/about/')) findings.push(`${item.id}: linked author biography is missing.`);
  if (!new RegExp(`<time[^>]+datetime=["']${expectedDate}["']`, 'i').test(html)) findings.push(`${item.id}: visible machine-readable scheduled date is missing.`);
  if (!serviceLinks.some((href) => html.includes(`href="${href}`) || html.includes(`href='${href}`))) findings.push(`${item.id}: topic-appropriate service connection is missing.`);
  if (!html.includes('href="/resources/"') && !html.includes("href='/resources/'")) findings.push(`${item.id}: resource-library link is missing.`);
  if (!/resource-author-box/i.test(html)) findings.push(`${item.id}: author box is missing.`);
  const schema = articleSchema(html);
  if (!schema) { findings.push(`${item.id}: Article schema is missing or invalid.`); continue; }
  for (const field of ['author', 'datePublished', 'dateModified', 'publisher', 'mainEntityOfPage']) {
    if (!schema[field]) findings.push(`${item.id}: Article schema is missing ${field}.`);
  }
  if (schema.datePublished !== expectedDate) findings.push(`${item.id}: Article datePublished does not match scheduledAt.`);
  const authorUrl = typeof schema.author === 'object' ? schema.author.url : '';
  if (!String(authorUrl || '').endsWith('/about/')) findings.push(`${item.id}: Article author URL must resolve to /about/.`);
}

if (dashboard) {
  if (dashboard.inventory?.totalManifest !== manifest.length) findings.push('Dashboard inventory total does not match the manifest.');
  if (dashboard.inventory?.published !== published.length) findings.push('Dashboard published count does not match the manifest.');
  if (dashboard.inventory?.approved !== approved.length) findings.push('Dashboard approved count does not match the manifest.');
  const expectedScores = ['technical', 'onpage', 'liveContent', 'forwardContent', 'aeo', 'geo', 'measurement', 'monitoring'];
  for (const key of expectedScores) {
    const score = (dashboard.scores || []).find((entry) => entry.key === key);
    if (!score) findings.push(`Dashboard score category missing: ${key}`);
    else if (score.score < 87) findings.push(`${score.label || key} is below the B+ target: ${score.score}.`);
  }
  if ((dashboard.duplicatePairs?.forward || []).length > 0) findings.push(`Forward publishing inventory has ${dashboard.duplicatePairs.forward.length} high-similarity pair(s).`);
  if (dashboard.policy?.blocking !== false) findings.push('Agency SEO/AEO/GEO findings are not configured as warning-only.');
}

if (findings.length) {
  warn(findings, `${findings.length} agency quality finding(s)`);
  process.exit(0);
}
console.log(`Agency quality advisory OK (${approved.length} approved source pages, ${published.length} published records, eight score categories, zero forward high-similarity pairs).`);
