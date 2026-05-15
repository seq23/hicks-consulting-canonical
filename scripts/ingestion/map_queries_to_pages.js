const fs = require('fs');
const path = require('path');
const root = process.cwd();
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(path.join(root,file),'utf8')); } catch { return fallback; } }
const existing = readJson('data/query_coverage_map.json', []);
const normalized = readJson('data/intake/normalized_query_signals.json', { signals: [] }).signals || [];
const mapped = normalized.map(s => ({ query: s.query, intent: s.intent, page: '/llm-atlas/queries/', entityTarget: s.audience, ctaTarget: '/intake-quiz/', sourceSignal: s.id, contentType: s.contentType, status: 'candidate' }));
fs.writeFileSync(path.join(root,'data/intake/query_to_page_candidates.json'), JSON.stringify({ generatedAt: new Date().toISOString(), existingCount: existing.length, candidates: mapped }, null, 2)+'\n');
console.log(`Query to page candidates mapped: ${mapped.length}`);
