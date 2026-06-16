const fs = require('fs');
const path = require('path');
const { fail, warn: reportFindings } = require('../validation/protocol');

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'admin', 'content_manifest.json'), 'utf8'));
const targets = { daily: 700, weekly: 1000, monthly: 1400, quarterly: 2400 };
function strip(html) { return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' '); }
function wordCount(text) { return (text.trim().match(/[A-Za-z0-9’'-]+/g) || []).length; }
let warnings = [];
let checked = 0;
for (const item of manifest.filter(i => i.slug && i.slug.startsWith('/resources/') && i.validationPassed === true)) {
  const file = path.join(root, 'pages', item.slug.replace(/^\//,'').replace(/\/$/,''), 'index.html');
  if (!fs.existsSync(file)) {
    fail(`WORD COUNT FAIL: missing source page for ${item.id}: ${file}`);
  }
  const count = wordCount(strip(fs.readFileSync(file, 'utf8')));
  const target = Number(item.contentWordTarget || targets[item.type] || 700);
  const floor = Math.floor(target * 0.75);
  checked++;
  if (count < floor) warnings.push(`${item.id} ${item.type} ${count}/${target} words (warn under ${floor})`);
}
if (warnings.length) {
  const displayed = warnings.slice(0, 25).map((item) => `- ${item}`);
  if (warnings.length > 25) displayed.push(`- ... ${warnings.length - 25} more`);
  reportFindings(displayed, `${warnings.length}-word-count-warning(s)`);
} else {
  console.log(`Resource word count warnings clean (${checked} pages checked, 25% margin).`);
}
