const fs = require('fs');
const warnings=[]; function fail(m){ warnings.push(`SOURCE HEALTH CONTRACT WARNING: ${m}`); }
const p='data/intake/source_health.json';
if(!fs.existsSync(p)) fail('data/intake/source_health.json missing. Run npm run ingest:social.');
const health=JSON.parse(fs.readFileSync(p,'utf8'));
if(!health.generatedAt || !health.mode || !Array.isArray(health.sources)) fail('source_health.json missing generatedAt, mode, or sources.');
if(!['external','mixed','fallback'].includes(health.mode)) fail(`Invalid ingestion mode: ${health.mode}`);
for(const s of health.sources){ if(!s.id || !s.status || typeof s.signalCount !== 'number') fail(`Invalid source health entry: ${JSON.stringify(s)}`); }
if (warnings.length) {
  console.warn(warnings.join('\n'));
} else {
  console.log('Source health contract OK');
}
process.exit(0);
