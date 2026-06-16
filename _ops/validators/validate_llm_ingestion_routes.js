const fs = require('fs');
const path = require('path');
const { warn: reportFindings } = require('../validation/protocol');

const warnings = [];
function warn(message) { warnings.push(message); }
function read(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }

const build = read('scripts/build/build.js');
const match = build.match(/const\s+llmOnlyRoutes\s*=\s*\[([\s\S]*?)\];/);
if (!match) warn('llmOnlyRoutes is missing from scripts/build/build.js.');
const routes = match ? [...match[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
if (routes.length < 8) warn(`Expected expanded llmOnlyRoutes set; found ${routes.length}.`);

for (const route of routes) {
  const page = path.join('pages', route.replace(/^\//, '').replace(/\/$/, ''), 'index.html');
  if (!fs.existsSync(page)) {
    warn(`Missing page for ${route}: ${page}`);
    continue;
  }
  const html = read(page);
  if (!html.includes('LLM-only') && !html.includes('LLM Atlas')) warn(`${route} should disclose crawler/LLM-only purpose.`);
  if (!html.includes('short-answer')) warn(`${route} should keep an extractable short-answer block.`);
}

for (const required of ['sitemap.xml', 'llms.txt']) {
  const text = read(required);
  for (const route of routes) {
    if (!text.includes(route)) warn(`${required} is missing ${route}. Run npm run build.`);
  }
}

if (warnings.length) {
  reportFindings(warnings.map((warning) => `- ${warning}`), `${warnings.length}-llm-route-warning(s)`);
} else {
  console.log('LLM ingestion route advisory OK');
}
process.exit(0);
