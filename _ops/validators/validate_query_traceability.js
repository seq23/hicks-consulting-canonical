const { read, fail } = require('./util');
const map = JSON.parse(read('data/query_coverage_map.json'));
const seen = new Set();
for(const item of map){ if(!item.query || !item.page) fail('Query map entry missing query or page'); if(seen.has(item.page)) fail(`Duplicate high-intent page mapping: ${item.page}`); seen.add(item.page); }
console.log('Query traceability OK');
