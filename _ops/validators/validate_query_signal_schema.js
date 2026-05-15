const fs = require('fs');
const warnings=[]; function fail(m){ warnings.push(`QUERY SIGNAL SCHEMA WARNING: ${m}`); }
const p='data/intake/normalized_query_signals.json';
if(!fs.existsSync(p)) fail('normalized_query_signals.json missing.');
const payload=JSON.parse(fs.readFileSync(p,'utf8'));
if(!Array.isArray(payload.signals)) fail('signals must be an array.');
for(const s of payload.signals){
  for(const key of ['id','query','source','intent','audience','contentType','status','generatedAt']) if(!s[key]) fail(`Signal missing ${key}: ${JSON.stringify(s)}`);
  if(!Array.isArray(s.tags)) fail(`Signal tags must be array: ${s.id}`);
}
if (warnings.length) {
  console.warn(warnings.join('\n'));
} else {
  console.log('Query signal schema OK');
}
process.exit(0);
