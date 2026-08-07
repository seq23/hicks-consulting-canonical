#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const SIMILARITY_THRESHOLD = 0.85;
const MARKER_START = '# BEGIN BING DUPLICATE CONSOLIDATION';
const MARKER_END = '# END BING DUPLICATE CONSOLIDATION';

const manifestPath = path.join(ROOT, 'data/admin/content_manifest.json');
const redirectsPath = path.join(ROOT, '_redirects');
const buildPath = path.join(ROOT, 'scripts/site_build.js');
const hiddenValidatorPath = path.join(ROOT, '_ops/validators/validate_hidden_llm_surfaces.js');
const llmValidatorPath = path.join(ROOT, '_ops/validators/validate_llm_ingestion_routes.js');
const reportPath = path.join(ROOT, 'reports/BING_INDEXATION_CONSOLIDATION_REPORT.json');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function requireReplacement(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Expected ${label} pattern was not found.`);
  }
  return source.replace(before, after);
}

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function visibleText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|header|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  );
}

function tokens(value) {
  return String(value).match(/[a-z0-9']+/g) || [];
}

function frequencies(words) {
  const result = new Map();
  for (const word of words) {
    result.set(word, (result.get(word) || 0) + 1);
  }
  return result;
}

function cosineSimilarity(leftWords, rightWords) {
  const left = frequencies(leftWords);
  const right = frequencies(rightWords);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;

  for (const [word, value] of left.entries()) {
    dot += value * (right.get(word) || 0);
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function routeFile(route) {
  return path.join(ROOT, 'pages', route.replace(/^\/|\/$/g, ''), 'index.html');
}

function htmlTitle(html) {
  return decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const manifest = JSON.parse(read(manifestPath));

const publishedArticles = manifest.filter((item) =>
  item.validationPassed === true &&
  item.status === 'published' &&
  item.contentType === 'articles' &&
  String(item.slug || '').startsWith('/resources/articles/')
);

const publishedInsights = manifest.filter((item) =>
  item.validationPassed === true &&
  item.status === 'published' &&
  item.contentType === 'insights' &&
  String(item.slug || '').startsWith('/resources/insights/')
);

const mappings = [];

for (const insight of publishedInsights) {
  const parent = publishedArticles
    .filter((article) => String(insight.title || '').startsWith(`${article.title}:`))
    .sort((a, b) => String(b.title).length - String(a.title).length)[0];

  if (!parent) continue;

  const insightFile = routeFile(insight.slug);
  const parentFile = routeFile(parent.slug);

  if (!fs.existsSync(insightFile) || !fs.existsSync(parentFile)) continue;

  const insightHtml = read(insightFile);
  const parentHtml = read(parentFile);
  const similarity = cosineSimilarity(
    tokens(visibleText(insightHtml)),
    tokens(visibleText(parentHtml))
  );

  if (similarity < SIMILARITY_THRESHOLD) continue;

  mappings.push({
    insightId: insight.id,
    source: insight.slug,
    target: parent.slug,
    similarity: Number(similarity.toFixed(3)),
    duplicateHtmlTitle: htmlTitle(insightHtml) === htmlTitle(parentHtml)
  });
}

mappings.sort((a, b) => a.source.localeCompare(b.source));

console.log(JSON.stringify({
  mode: APPLY ? 'APPLY' : 'DRY_RUN',
  threshold: SIMILARITY_THRESHOLD,
  publishedArticles: publishedArticles.length,
  publishedInsights: publishedInsights.length,
  consolidationCount: mappings.length,
  duplicateHtmlTitleCount: mappings.filter((item) => item.duplicateHtmlTitle).length,
  mappings
}, null, 2));

if (!APPLY) {
  console.log('\nDRY RUN ONLY — no files changed.');
  process.exit(0);
}

if (!mappings.length) {
  throw new Error('No qualifying duplicate insight mappings were found.');
}

const revokedAt = new Date().toISOString();
const mappingById = new Map(mappings.map((item) => [item.insightId, item]));

for (const item of manifest) {
  if (!mappingById.has(item.id)) continue;
  item.status = 'revoked';
  item.revokedAt = item.revokedAt || revokedAt;
}

write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

let redirects = read(redirectsPath);
const existingBlock = new RegExp(
  `\\n?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`,
  'g'
);
redirects = redirects.replace(existingBlock, '\n').trimEnd();

const redirectBlock = [
  MARKER_START,
  ...mappings.map((item) => `${item.source} ${item.target} 301`),
  MARKER_END
].join('\n');

write(redirectsPath, `${redirects}\n\n${redirectBlock}\n`);

let buildScript = read(buildPath);
buildScript = requireReplacement(
  buildScript,
  'const urls = [...staticPublicRoutes, ...llmOnlyRoutes, ...Array.from(publishedResourceSlugs)].map(route => `${canonicalDomain}${route}`);',
  'const urls = [...staticPublicRoutes, ...Array.from(publishedResourceSlugs)].map(route => `${canonicalDomain}${route}`);',
  'site-build sitemap route composition'
);
write(buildPath, buildScript);

let hiddenValidator = read(hiddenValidatorPath);
hiddenValidator = requireReplacement(
  hiddenValidator,
  'if (sitemap && !sitemap.includes(route)) warn(`${route} should remain crawler-discoverable in sitemap.xml after build.`);',
  'if (sitemap && sitemap.includes(route)) warn(`${route} should remain excluded from the public search sitemap.`);',
  'hidden-LLM sitemap expectation'
);
write(hiddenValidatorPath, hiddenValidator);

let llmValidator = read(llmValidatorPath);
llmValidator = requireReplacement(
  llmValidator,
  `for (const required of ['sitemap.xml', 'llms.txt']) {
  const text = read(required);
  for (const route of routes) {
    if (!text.includes(route)) warn(\`\${required} is missing \${route}. Run npm run build.\`);
  }
}`,
  `const sitemap = read('sitemap.xml');
const llms = read('llms.txt');
for (const route of routes) {
  if (sitemap.includes(route)) warn(\`sitemap.xml should exclude LLM-only route \${route}.\`);
  if (!llms.includes(route)) warn(\`llms.txt is missing \${route}. Run npm run build.\`);
}`,
  'LLM-ingestion sitemap expectation'
);
write(llmValidatorPath, llmValidator);

write(reportPath, `${JSON.stringify({
  schemaVersion: '1.0.0',
  generatedAt: revokedAt,
  purpose: 'Consolidate high-similarity orphaned insight derivatives into their parent articles for Bing index-quality remediation.',
  similarityThreshold: SIMILARITY_THRESHOLD,
  consolidationCount: mappings.length,
  sitemapChange: 'LLM-only routes remain in llms.txt but are excluded from the public search sitemap.',
  publishingCadenceChanged: false,
  editorialContentRewritten: false,
  mappings
}, null, 2)}\n`);

console.log(`\nAPPLIED ${mappings.length} consolidations.`);
console.log('Run npm run build next.');
