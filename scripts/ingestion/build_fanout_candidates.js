const fs = require('fs');
const path = require('path');
const root = process.cwd();
const outDir = path.join(root, 'data', 'intake');
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(path.join(root,file),'utf8')); } catch { return fallback; } }
function slugify(text){ return String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'fanout'; }
const clusters = readJson('data/intake/query_clusters.json', { clusters: [] }).clusters || [];
const candidates = clusters.filter(c => c.queryCount > 0).map(c => ({
  id: `fanout-${c.id}`,
  clusterId: c.id,
  title: c.title,
  candidateRoute: `/llm-atlas/fanouts/${slugify(c.title)}/`,
  destinationType: 'llm_ingestion_only_candidate',
  publishMode: 'queued',
  queryCount: c.queryCount,
  score: c.score,
  userNavExposure: false,
  crawlerDiscoverable: true
}));
fs.writeFileSync(path.join(outDir,'fanout_candidates.json'), JSON.stringify({ generatedAt: new Date().toISOString(), candidates }, null, 2)+'\n');
fs.writeFileSync(path.join(outDir,'fanout_pages_manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), pages: candidates.map(c => ({ route: c.candidateRoute, clusterId: c.clusterId, status: 'candidate' })) }, null, 2)+'\n');
console.log(`Fanout candidates built: ${candidates.length}`);
