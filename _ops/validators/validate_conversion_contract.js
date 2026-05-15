const fs = require('fs');
const path = require('path');
function fail(m){ console.error(`CONVERSION CONTRACT FAIL: ${m}`); process.exit(1); }
const config=JSON.parse(fs.readFileSync('data/system/config.json','utf8'));
const forms=config.forms || {};
const allowed = new Set([forms.therapy, forms.coaching, forms.corporate, forms.groups, '/intake-quiz/', '/request-consult/', '/book-discovery-call/', '/organizational-training-inquiry/'].filter(Boolean));
const qmap=JSON.parse(fs.readFileSync('data/query_coverage_map.json','utf8'));
for(const item of qmap){
  if(!item.ctaTarget) fail(`Query missing ctaTarget: ${item.query}`);
  const target=item.ctaTarget;
  const internal=target.startsWith('/');
  if(!allowed.has(target) && !internal) fail(`Unapproved external ctaTarget: ${target}`);
  if(internal){
    const page=path.join('pages', target.replace(/^\//,'').replace(/\/$/,''), 'index.html');
    if(!fs.existsSync(page)) fail(`ctaTarget internal page missing: ${target}`);
  }
}
const moneyPages=['/therapy/','/coaching/','/groups/','/corporate-speaking/','/intake-quiz/','/request-consult/','/book-discovery-call/'];
for(const route of moneyPages){
  const page=path.join('pages', route.replace(/^\//,'').replace(/\/$/,''), 'index.html');
  if(!fs.existsSync(page)) continue;
  const html=fs.readFileSync(page,'utf8');
  const hasAllowed=[...allowed].some(url => url && html.includes(url));
  if(!hasAllowed) fail(`${route} missing approved conversion path.`);
}
console.log('Conversion contract OK');
