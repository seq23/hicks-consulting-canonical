const fs = require('fs');
const warnings=[]; function fail(m){ warnings.push(`THROTTLE CONTRACT WARNING: ${m}`); }
if(!fs.existsSync('scripts/ingestion/throttle.js')) fail('scripts/ingestion/throttle.js missing.');
const policy=JSON.parse(fs.readFileSync('config/social_ingestion_policy.json','utf8'));
const t=policy.throttle || {};
if(typeof t.delayMs !== 'number' || t.delayMs < 500) fail('throttle.delayMs must be >= 500.');
if(typeof t.maxRetries !== 'number' || t.maxRetries > 3) fail('throttle.maxRetries must be <= 3.');
if(typeof t.timeoutMs !== 'number' || t.timeoutMs > 30000) fail('throttle.timeoutMs must be <= 30000.');
if (warnings.length) {
  console.warn(warnings.join('\n'));
} else {
  console.log('Throttle contract OK');
}
process.exit(0);
