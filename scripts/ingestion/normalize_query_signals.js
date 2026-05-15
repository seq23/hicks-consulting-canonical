const fs = require('fs');
const path = require('path');
const root = process.cwd();
const outDir = path.join(root, 'data', 'intake');
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(path.join(root,file),'utf8')); } catch { return fallback; } }
function slugify(text){ return String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'query'; }
function inferIntent(tags, query){ const q=String(query||'').toLowerCase(); if(q.includes(' vs ') || q.includes('compare')) return 'comparison'; if(q.includes('book') || q.includes('therapy') || q.includes('coach')) return 'commercial'; if(q.includes('how') || q.includes('why') || q.includes('what')) return 'informational'; return tags.includes('workplace_emotional_intelligence') ? 'commercial' : 'informational'; }
function inferAudience(tags){ if(tags.includes('black_women')) return 'Black women'; if(tags.includes('genz_millennial')) return 'Gen Z and millennial clients'; if(tags.includes('workplace_emotional_intelligence')) return 'Organizations and teams'; return 'Clients seeking emotional wellness support'; }
function inferContentType(intent){ if(intent === 'comparison') return 'comparison'; if(intent === 'commercial') return 'service'; return 'answer'; }
const payload = readJson('data/intake/query_signals_post_2027.json', { querySignals: [] });
const signals = payload.querySignals || [];
const normalized = signals.map((s, index) => {
  const query = s.query || s.title || String(s);
  const tags = s.tags || [];
  const intent = inferIntent(tags, query);
  return {
    id: s.id || `normalized-${index+1}-${slugify(query)}`,
    query,
    source: s.source || 'unknown',
    sourceType: s.sourceType || 'unknown',
    tags,
    intent,
    audience: inferAudience(tags),
    contentType: inferContentType(intent),
    status: 'candidate',
    generatedAt: payload.generatedAt || new Date().toISOString()
  };
});
fs.writeFileSync(path.join(outDir,'normalized_query_signals.json'), JSON.stringify({ generatedAt: new Date().toISOString(), signals: normalized }, null, 2)+'\n');
console.log(`Normalized query signals: ${normalized.length}`);
