const fs = require('fs');
const { warn: reportFindings } = require('../validation/protocol');
const warnings = [];
function finding(message) { warnings.push(`SOURCE HEALTH CONTRACT WARNING: ${message}`); }
const file = 'data/intake/source_health.json';
let health = null;
if (!fs.existsSync(file)) finding('data/intake/source_health.json missing. Run npm run ingest:social.');
else {
  try { health = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { finding(`source_health.json is invalid JSON: ${error.message}`); }
}
if (health) {
  if (!health.generatedAt || !health.mode || !Array.isArray(health.sources)) finding('source_health.json missing generatedAt, mode, or sources.');
  if (!['external', 'mixed', 'fallback'].includes(health.mode)) finding(`Invalid ingestion mode: ${health.mode}`);
  for (const source of Array.isArray(health.sources) ? health.sources : []) {
    if (!source.id || !source.status || typeof source.signalCount !== 'number') finding(`Invalid source health entry: ${JSON.stringify(source)}`);
  }
}
if (warnings.length) reportFindings(warnings, `${warnings.length}-source-health-warning(s)`);
else console.log('Source health contract OK');
process.exit(0);
