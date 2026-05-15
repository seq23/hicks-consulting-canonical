const fs = require('fs');
const warnings=[]; function fail(m){ warnings.push(`FANOUT CANDIDATE CONTRACT WARNING: ${m}`); }
const p='data/intake/fanout_candidates.json';
if(!fs.existsSync(p)) fail('fanout_candidates.json missing.');
const payload=JSON.parse(fs.readFileSync(p,'utf8'));
if(!Array.isArray(payload.candidates)) fail('candidates must be array.');
for(const c of payload.candidates){ if(!c.id || !c.clusterId || !c.candidateRoute || c.userNavExposure !== false || c.crawlerDiscoverable !== true) fail(`Invalid fanout candidate: ${JSON.stringify(c)}`); }
if (warnings.length) {
  console.warn(warnings.join('\n'));
} else {
  console.log('Fanout candidates contract OK');
}
process.exit(0);
