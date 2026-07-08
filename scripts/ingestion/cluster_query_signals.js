const fs = require('fs');
const path = require('path');
const root = process.cwd();
const outDir = path.join(root, 'data', 'intake');
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(path.join(root,file),'utf8')); } catch { return fallback; } }
const normalized = readJson('data/intake/normalized_query_signals.json', { signals: [] }).signals || [];
const clusterDefs = [
  { id:'black_women_healing', title:'Black women healing beyond survival', tags:['black_women'] },
  { id:'burnout_boundaries', title:'Burnout, boundaries, and over-functioning', tags:['burnout'] },
  { id:'ai_digital_wellness', title:'AI, social media, and digital emotional overload', tags:['ai_digital_wellness'] },
  { id:'genz_millennial_mental_health', title:'Gen Z and millennial mental health language', tags:['genz_millennial'] },
  { id:'workplace_emotional_intelligence', title:'Workplace emotional intelligence and mental health training', tags:['workplace_emotional_intelligence'] },
  { id:'faith_centered_support', title:'Faith-centered emotional support', tags:['faith_centered_support'] },
  { id:'general_emotional_wellness', title:'General emotional wellness and intentional living', tags:['general_emotional_wellness'] }
];
function clusterFor(signal){ return clusterDefs.find(c => (signal.tags||[]).some(t => c.tags.includes(t))) || clusterDefs[clusterDefs.length-1]; }
const byId = new Map(clusterDefs.map(c => [c.id, { ...c, signals: [], queryCount: 0, score: 0, targetPage: '/llm-atlas/clusters/' }]));
for(const signal of normalized){ const c = clusterFor(signal); byId.get(c.id).signals.push(signal); }
const clusters = [...byId.values()].map(c => ({ ...c, queryCount: c.signals.length, score: Math.min(100, c.signals.length * 20), status: c.signals.length ? 'active' : 'seed' }));
fs.writeFileSync(path.join(outDir,'query_clusters.json'), JSON.stringify({ generatedAt: new Date().toISOString(), clusters }, null, 2)+'\n');
fs.writeFileSync(path.join(outDir,'scored_query_clusters.json'), JSON.stringify({ generatedAt: new Date().toISOString(), clusters: clusters.map(({signals,...c}) => c) }, null, 2)+'\n');
console.log(`Query clusters built: ${clusters.length}`);
