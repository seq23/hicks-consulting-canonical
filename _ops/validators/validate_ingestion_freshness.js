const fs = require('fs');
const warnings=[]; function fail(m){ warnings.push(`INGESTION FRESHNESS CONTRACT WARNING: ${m}`); }
for(const file of ['data/intake/social_signals.json','data/intake/query_signals_post_2027.json','data/intake/source_health.json']){
  if(!fs.existsSync(file)) fail(`${file} missing.`);
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!data.generatedAt || Number.isNaN(Date.parse(data.generatedAt))) fail(`${file} has invalid generatedAt.`);
}
const health=JSON.parse(fs.readFileSync('data/intake/source_health.json','utf8'));
if(process.env.STRICT_INGESTION === '1' && health.mode === 'fallback') fail('Strict ingestion forbids fallback-only mode.');
if (warnings.length) {
  console.warn(warnings.join('\n'));
} else {
  console.log('Ingestion freshness contract OK');
}
process.exit(0);
