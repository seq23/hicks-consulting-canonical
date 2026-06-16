const fs = require('fs');
const { warn: reportFindings } = require('../validation/protocol');
const warnings = [];
function finding(message) { warnings.push(`QUERY SIGNAL SCHEMA WARNING: ${message}`); }
const file = 'data/intake/normalized_query_signals.json';
let payload = null;
if (!fs.existsSync(file)) finding('normalized_query_signals.json missing.');
else {
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { finding(`normalized_query_signals.json is invalid JSON: ${error.message}`); }
}
const signals = Array.isArray(payload?.signals) ? payload.signals : [];
if (payload && !Array.isArray(payload.signals)) finding('signals must be an array.');
for (const signal of signals) {
  for (const key of ['id', 'query', 'source', 'intent', 'audience', 'contentType', 'status', 'generatedAt']) {
    if (!signal[key]) finding(`Signal missing ${key}: ${JSON.stringify(signal)}`);
  }
  if (!Array.isArray(signal.tags)) finding(`Signal tags must be array: ${signal.id}`);
}
if (warnings.length) reportFindings(warnings, `${warnings.length}-query-signal-warning(s)`);
else console.log('Query signal schema OK');
process.exit(0);
