const fs = require('fs');
const { warn: reportFindings } = require('../validation/protocol');
const warnings = [];
function finding(message) { warnings.push(`THROTTLE CONTRACT WARNING: ${message}`); }
if (!fs.existsSync('scripts/ingestion/throttle.js')) finding('scripts/ingestion/throttle.js missing.');
let policy = null;
try { policy = JSON.parse(fs.readFileSync('config/social_ingestion_policy.json', 'utf8')); }
catch (error) { finding(`config/social_ingestion_policy.json is missing or invalid: ${error.message}`); }
const throttle = policy?.throttle || {};
if (policy) {
  if (typeof throttle.delayMs !== 'number' || throttle.delayMs < 500) finding('throttle.delayMs must be >= 500.');
  if (typeof throttle.maxRetries !== 'number' || throttle.maxRetries > 3) finding('throttle.maxRetries must be <= 3.');
  if (typeof throttle.timeoutMs !== 'number' || throttle.timeoutMs > 30000) finding('throttle.timeoutMs must be <= 30000.');
}
if (warnings.length) reportFindings(warnings, `${warnings.length}-throttle-warning(s)`);
else console.log('Throttle contract OK');
process.exit(0);
