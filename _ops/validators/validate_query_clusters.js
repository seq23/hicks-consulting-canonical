const fs = require('fs');
const { warn: reportFindings } = require('../validation/protocol');
const warnings = [];
function finding(message) { warnings.push(`QUERY CLUSTER CONTRACT INFO: ${message}`); }
const file = 'data/intake/query_clusters.json';
let payload = null;
if (!fs.existsSync(file)) finding('query_clusters.json missing.');
else {
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { finding(`query_clusters.json is invalid JSON: ${error.message}`); }
}
const clusters = Array.isArray(payload?.clusters) ? payload.clusters : [];
if (payload && (!Array.isArray(payload.clusters) || !payload.clusters.length)) finding('clusters must be a non-empty array.');
for (const cluster of clusters) {
  if (!cluster.id || !cluster.title || typeof cluster.queryCount !== 'number' || typeof cluster.score !== 'number') {
    finding(`Invalid cluster: ${JSON.stringify(cluster)}`);
  }
}
if (warnings.length) reportFindings(warnings, `${warnings.length}-query-cluster-info-finding(s)`);
else console.log('Query cluster contract OK');
process.exit(0);
