const fs = require('fs');
const path = require('path');
const { read, fail } = require('./util');
const map = JSON.parse(read('data/query_coverage_map.json'));
const seenQuery = new Set();
const pageSet = new Set();
for(const item of map){
  if(!item.query || !item.page || !item.intent || !item.entityTarget || !item.ctaTarget) fail('Query map entry missing query, page, intent, entityTarget, or ctaTarget.');
  const q = item.query.toLowerCase().trim();
  if(seenQuery.has(q)) fail(`Duplicate query: ${item.query}`);
  seenQuery.add(q);
  pageSet.add(item.page.replace(/\/$/,'/'));
  if(item.page.startsWith('/')){
    const pagePath = path.join(process.cwd(), 'pages', item.page.replace(/^\//,'').replace(/\/$/,''), 'index.html');
    const isResource = item.page.startsWith('/resources/');
    if(!isResource && !fs.existsSync(pagePath)) fail(`Mapped page missing: ${item.page}`);
  }
}
if(!pageSet.size) fail('Query coverage map is empty.');
console.log('Query traceability OK');
