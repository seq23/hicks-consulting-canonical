const fs = require('fs');
const path = require('path');

const root = process.cwd();
const outDir = path.join(root, 'data', 'intake');
fs.mkdirSync(outDir, { recursive: true });

const seedQueries = [
  'Black women burnout and boundaries',
  'AI anxiety and emotional wellness',
  'Gen Z therapy language and mental health',
  'millennial women burnout motherhood work',
  'Black community emotional wellness and healing',
  'faith centered therapy emotional healing',
  'workplace emotional intelligence mental health training'
];

const sources = [
  { id: 'reddit_rss_blackwomen', kind: 'rss', url: 'https://www.reddit.com/search.rss?q=Black%20women%20burnout%20therapy&sort=new' },
  { id: 'reddit_rss_ai_wellness', kind: 'rss', url: 'https://www.reddit.com/search.rss?q=AI%20anxiety%20mental%20health&sort=new' },
  { id: 'reddit_rss_genz_mental_health', kind: 'rss', url: 'https://www.reddit.com/search.rss?q=Gen%20Z%20mental%20health%20therapy&sort=new' }
];

function normalizeTitle(raw) {
  return String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitles(xml) {
  const matches = [...String(xml || '').matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)]
    .map(m => normalizeTitle(m[1]))
    .filter(Boolean)
    .filter(t => !/^reddit search/i.test(t));
  return [...new Set(matches)].slice(0, 25);
}

async function fetchSource(source) {
  const startedAt = new Date().toISOString();
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'HicksConsultingEditorialSignalBot/1.0 (+https://www.hicksconsulting.org)',
        'Accept': 'application/rss+xml, application/xml, text/xml, text/plain;q=0.8'
      }
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { ...source, status: 'degraded', httpStatus: res.status, startedAt, finishedAt: new Date().toISOString(), signals: [] };
    }
    return { ...source, status: 'ok', httpStatus: res.status, startedAt, finishedAt: new Date().toISOString(), signals: extractTitles(text) };
  } catch (error) {
    return { ...source, status: 'degraded', error: String(error.message || error), startedAt, finishedAt: new Date().toISOString(), signals: [] };
  }
}

function classifySignal(text) {
  const lower = text.toLowerCase();
  const tags = [];
  if (lower.includes('ai') || lower.includes('chatgpt') || lower.includes('algorithm')) tags.push('ai_digital_wellness');
  if (lower.includes('gen z') || lower.includes('millennial')) tags.push('genz_millennial');
  if (lower.includes('black women') || lower.includes('black woman')) tags.push('black_women');
  if (lower.includes('burnout') || lower.includes('tired') || lower.includes('overwhelmed')) tags.push('burnout');
  if (lower.includes('work') || lower.includes('job') || lower.includes('career')) tags.push('workplace_emotional_intelligence');
  return tags.length ? tags : ['general_emotional_wellness'];
}

(async () => {
  const runs = [];
  for (const source of sources) {
    // Sequential by design: fewer bursts, fewer 403-style failures, easier production logs.
    runs.push(await fetchSource(source));
  }
  const externalSignals = runs.flatMap(run => run.signals.map(title => ({ title, source: run.id, tags: classifySignal(title) })));
  const fallbackSignals = seedQueries.map(title => ({ title, source: 'seed_query_fallback', tags: classifySignal(title) }));
  const signals = externalSignals.length ? externalSignals : fallbackSignals;
  const payload = {
    generatedAt: new Date().toISOString(),
    productionRule: 'No-auth ingestion must degrade gracefully. HTTP 403 or source failure is logged as degraded and must not break production builds.',
    post2027Use: 'Signals should feed normalized query clusters, atlas expansion, fan-out surfaces, and scheduled content drafting after 2027-01-01.',
    sourceHealth: runs.map(({ id, url, status, httpStatus, error, startedAt, finishedAt }) => ({ id, url, status, httpStatus, error, startedAt, finishedAt })),
    signals
  };
  fs.writeFileSync(path.join(outDir, 'social_signals.json'), JSON.stringify(payload, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'query_signals_post_2027.json'), JSON.stringify({ generatedAt: payload.generatedAt, querySignals: signals }, null, 2) + '\n');
  console.log(`Social signal ingestion complete: ${signals.length} signals (${externalSignals.length ? 'external' : 'fallback'} mode).`);
})();
