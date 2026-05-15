const fs = require('fs');
const warnings=[]; function fail(m){ warnings.push(`QUERY CLUSTER CONTRACT WARNING: ${m}`); }
const p='data/intake/query_clusters.json';
if(!fs.existsSync(p)) fail('query_clusters.json missing.');
const payload=JSON.parse(fs.readFileSync(p,'utf8'));
if(!Array.isArray(payload.clusters) || !payload.clusters.length) fail('clusters must be a non-empty array.');
for(const c of payload.clusters){ if(!c.id || !c.title || typeof c.queryCount !== 'number' || typeof c.score !== 'number') fail(`Invalid cluster: ${JSON.stringify(c)}`); }
if (warnings.length) {
  console.warn(warnings.join('\n'));
} else {
  console.log('Query cluster contract OK');
}
process.exit(0);
