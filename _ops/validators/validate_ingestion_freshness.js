const fs = require('fs');
const { warn: reportFindings } = require('../validation/protocol');
const warnings = [];
function finding(message) { warnings.push(`INGESTION FRESHNESS CONTRACT INFO: ${message}`); }
function readJson(file) {
  if (!fs.existsSync(file)) {
    finding(`${file} missing.`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    finding(`${file} is invalid JSON: ${error.message}`);
    return null;
  }
}

for (const file of ['data/intake/social_signals.json', 'data/intake/query_signals_post_2027.json', 'data/intake/source_health.json']) {
  const data = readJson(file);
  if (!data) continue;
  if (!data.generatedAt || Number.isNaN(Date.parse(data.generatedAt))) finding(`${file} has invalid generatedAt.`);
}
const health = readJson('data/intake/source_health.json');
if (health && process.env.STRICT_INGESTION === '1' && health.mode === 'fallback') finding('Strict ingestion forbids fallback-only mode.');

if (warnings.length) reportFindings(warnings, `${warnings.length}-ingestion-freshness-info-finding(s)`);
else console.log('Ingestion freshness contract OK');
process.exit(0);
