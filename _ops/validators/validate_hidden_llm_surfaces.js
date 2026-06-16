const fs = require('fs');
const path = require('path');
const { warn: reportFindings } = require('../validation/protocol');

const root = process.cwd();
const buildScriptPath = path.join(root, 'scripts', 'site_build.js');
const pagesDir = path.join(root, 'pages');
const distDir = path.join(root, 'dist');
const expectedHiddenRoutes = [
  '/llm-atlas/',
  '/llm-atlas/fanouts/',
  '/llm-atlas/queries/',
  '/llm-atlas/pillars/',
  '/llm-atlas/clusters/',
  '/llm-atlas/social-signals/',
  '/llm-atlas/source-health/',
  '/llm-atlas/answer-surfaces/'
];
const hiddenRoutePatterns = expectedHiddenRoutes.map(route => new RegExp(`href=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i'));
const warnings = [];

function warn(message) { warnings.push(message); }
function read(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const buildScript = read(buildScriptPath);
if (!/const\s+llmOnlyRoutes\s*=\s*\[/.test(buildScript)) warn('scripts/site_build.js should define llmOnlyRoutes.');
const staticBlockMatch = buildScript.match(/const\s+staticPublicRoutes\s*=\s*\[([\s\S]*?)\];/);
const llmBlockMatch = buildScript.match(/const\s+llmOnlyRoutes\s*=\s*\[([\s\S]*?)\];/);

for (const route of expectedHiddenRoutes) {
  if (!llmBlockMatch || !llmBlockMatch[1].includes(`'${route}'`)) warn(`${route} should be classified inside llmOnlyRoutes.`);
  if (staticBlockMatch && staticBlockMatch[1].includes(`'${route}'`)) warn(`${route} should not be classified inside staticPublicRoutes.`);
  const pagePath = path.join(root, 'pages', route.replace(/^\//, '').replace(/\/$/, ''), 'index.html');
  if (!fs.existsSync(pagePath)) warn(`${route} should have a source page at ${path.relative(root, pagePath)}.`);
}

const publicHtmlFiles = [...walk(pagesDir), ...walk(distDir)]
  .filter(file => file.endsWith('.html'))
  .filter(file => !file.includes(`${path.sep}llm-atlas${path.sep}`));

for (const file of publicHtmlFiles) {
  const html = read(file);
  const navBlocks = [...html.matchAll(/<nav\b[^>]*class=["'][^"']*main-nav[^"']*["'][^>]*>[\s\S]*?<\/nav>/gi)].map(m => m[0]);
  for (const nav of navBlocks) {
    for (const pattern of hiddenRoutePatterns) {
      if (pattern.test(nav)) warn(`LLM-only route appears in main nav in ${path.relative(root, file)}.`);
    }
  }
  const userFacingBlocks = [
    ...html.matchAll(/<header\b[\s\S]*?<\/header>/gi),
    ...html.matchAll(/<footer\b[\s\S]*?<\/footer>/gi),
    ...html.matchAll(/<section\b[^>]*(?:class=["'][^"']*(?:resource|card|grid|home|hero)[^"']*["'])[^>]*>[\s\S]*?<\/section>/gi)
  ].map(m => m[0]);
  for (const block of userFacingBlocks) {
    for (const pattern of hiddenRoutePatterns) {
      if (pattern.test(block)) warn(`LLM-only route appears in a user-facing block in ${path.relative(root, file)}.`);
    }
  }
}

const sitemap = read(path.join(root, 'sitemap.xml'));
const llms = read(path.join(root, 'llms.txt'));
for (const route of expectedHiddenRoutes) {
  if (sitemap && !sitemap.includes(route)) warn(`${route} should remain crawler-discoverable in sitemap.xml after build.`);
  if (llms && !llms.includes(route)) warn(`${route} should remain visible in llms.txt after build.`);
}

if (warnings.length) {
  reportFindings(warnings.map((warning) => `- ${warning}`), `${warnings.length}-hidden-llm-warning(s)`);
} else {
  console.log('Hidden LLM surface advisory OK');
}
process.exit(0);
