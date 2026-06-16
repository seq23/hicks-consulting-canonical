const fs = require('fs');
const { warn: reportFindings } = require('../validation/protocol');
const warnings = [];
function finding(message) { warnings.push(`FANOUT CANDIDATE CONTRACT INFO: ${message}`); }
const file = 'data/intake/fanout_candidates.json';
let payload = null;
if (!fs.existsSync(file)) finding('fanout_candidates.json missing.');
else {
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { finding(`fanout_candidates.json is invalid JSON: ${error.message}`); }
}
const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
if (payload && !Array.isArray(payload.candidates)) finding('candidates must be array.');
for (const candidate of candidates) {
  if (!candidate.id || !candidate.clusterId || !candidate.candidateRoute || candidate.userNavExposure !== false || candidate.crawlerDiscoverable !== true) {
    finding(`Invalid fanout candidate: ${JSON.stringify(candidate)}`);
  }
}
if (warnings.length) reportFindings(warnings, `${warnings.length}-fanout-info-finding(s)`);
else console.log('Fanout candidates contract OK');
process.exit(0);
