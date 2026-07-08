const fs = require('fs');
const path = require('path');
const { sleep, withTimeout, retry } = require('./throttle');

const root = process.cwd();
const outDir = path.join(root, 'data', 'intake');
const socialDir = path.join(root, 'data', 'social');
const runsDir = path.join(socialDir, 'runs');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(socialDir, { recursive: true });
fs.mkdirSync(runsDir, { recursive: true });

const seedQueries = [
  'Black women burnout and boundaries',
  'AI anxiety and emotional wellness',
  'Gen Z therapy language and mental health',
  'millennial women burnout motherhood work',
  'Black community emotional wellness and healing',
  'faith centered therapy emotional healing',
  'workplace emotional intelligence mental health training'
];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch { return fallback; }
}

const sourceConfig = readJson('config/social_sources.json', { sources: [] });
const policy = readJson('config/social_ingestion_policy.json', { throttle: { delayMs: 750, maxRetries: 1, timeoutMs: 10000 }, max_items_per_source_per_run: 25 });
const sources = sourceConfig.sources || [];

function normalizeTitle(raw) {
  return String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitles(xml, limit) {
  const matches = [...String(xml || '').matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)]
    .map(m => normalizeTitle(m[1]))
    .filter(Boolean)
    .filter(t => !/^reddit search/i.test(t));
  return [...new Set(matches)].slice(0, limit || 25);
}

async function fetchSource(source) {
  const startedAt = new Date().toISOString();
  const maxItems = source.maxItemsPerRun || policy.max_items_per_source_per_run || 25;
  try {
    const res = await retry(() => withTimeout(fetch(source.url, {
      headers: {
        'User-Agent': 'HicksConsultingEditorialSignalBot/1.0 (+https://www.hicksconsulting.org)',
        'Accept': 'application/rss+xml, application/xml, text/xml, text/plain;q=0.8'
      }
    }), policy.throttle?.timeoutMs || 10000, source.id), {
      retries: policy.throttle?.maxRetries ?? 1,
      delayMs: policy.throttle?.delayMs || 750,
      label: source.id
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { ...source, status: 'degraded', httpStatus: res.status, startedAt, finishedAt: new Date().toISOString(), signals: [] };
    }
    return { ...source, status: 'ok', httpStatus: res.status, startedAt, finishedAt: new Date().toISOString(), signals: extractTitles(text, maxItems) };
  } catch (error) {
    return { ...source, status: 'degraded', error: String(error.message || error), startedAt, finishedAt: new Date().toISOString(), signals: [] };
  }
}

function classifySignal(text) {
  const lower = String(text || '').toLowerCase();
  const tags = [];
  if (lower.includes('ai') || lower.includes('chatgpt') || lower.includes('algorithm')) tags.push('ai_digital_wellness');
  if (lower.includes('gen z') || lower.includes('millennial')) tags.push('genz_millennial');
  if (lower.includes('black women') || lower.includes('black woman')) tags.push('black_women');
  if (lower.includes('burnout') || lower.includes('tired') || lower.includes('overwhelmed')) tags.push('burnout');
  if (lower.includes('work') || lower.includes('job') || lower.includes('career')) tags.push('workplace_emotional_intelligence');
  if (lower.includes('faith') || lower.includes('pray') || lower.includes('church')) tags.push('faith_centered_support');
  return tags.length ? [...new Set(tags)] : ['general_emotional_wellness'];
}

function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'signal';
}

(async () => {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runs = [];
  for (const source of sources) {
    runs.push(await fetchSource(source));
    await sleep(policy.throttle?.delayMs || 750);
  }
  const externalSignals = runs.flatMap(run => run.signals.map(title => ({ id: `${run.id}-${slugify(title)}`, title, query: title, source: run.id, sourceType: run.kind || 'rss', tags: classifySignal(title), collectedAt: run.finishedAt })));
  const fallbackSignals = seedQueries.map(title => ({ id: `seed-${slugify(title)}`, title, query: title, source: 'seed_query_fallback', sourceType: 'seed', tags: classifySignal(title), collectedAt: new Date().toISOString() }));
  const mode = externalSignals.length && externalSignals.length >= fallbackSignals.length ? 'external' : externalSignals.length ? 'mixed' : 'fallback';
  const signals = mode === 'fallback' ? fallbackSignals : [...externalSignals, ...fallbackSignals].slice(0, 75);
  const sourceHealth = {
    generatedAt: new Date().toISOString(),
    runId,
    mode,
    externalSignalCount: externalSignals.length,
    fallbackSignalCount: fallbackSignals.length,
    sources: runs.map(({ id, name, url, status, httpStatus, error, startedAt, finishedAt, signals }) => ({ id, name, url, status, httpStatus, error, startedAt, finishedAt, signalCount: signals.length }))
  };
  const payload = {
    generatedAt: sourceHealth.generatedAt,
    runId,
    mode,
    productionRule: 'No-auth ingestion must degrade gracefully. Source failure is logged as degraded and must not break local builds. Strict scheduled mode may fail on fallback-only output.',
    post2027Use: 'Signals feed normalized query clusters, atlas expansion, fan-out surfaces, and scheduled drafting after 2027-01-01.',
    sourceHealth: sourceHealth.sources,
    signals
  };
  fs.writeFileSync(path.join(outDir, 'source_health.json'), JSON.stringify(sourceHealth, null, 2) + '\n');
  fs.writeFileSync(path.join(socialDir, 'source_registry.json'), JSON.stringify(sourceConfig, null, 2) + '\n');
  const existingQueue = readJson('data/social/publish_queue.json', { publishMode: policy.publish_mode || 'queued', items: [] });
  const existingPublished = readJson('data/social/published_manifest.json', { published: [] });
  fs.writeFileSync(path.join(socialDir, 'publish_queue.json'), JSON.stringify({
    generatedAt: sourceHealth.generatedAt,
    publishMode: policy.publish_mode || existingQueue.publishMode || 'queued',
    items: Array.isArray(existingQueue.items) ? existingQueue.items : []
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(socialDir, 'published_manifest.json'), JSON.stringify({
    generatedAt: sourceHealth.generatedAt,
    published: Array.isArray(existingPublished.published) ? existingPublished.published : []
  }, null, 2) + '\n');
  for (const entry of fs.readdirSync(runsDir)) {
    if (entry.endsWith('.json') && entry !== 'latest.json') fs.unlinkSync(path.join(runsDir, entry));
  }
  fs.writeFileSync(path.join(runsDir, 'latest.json'), JSON.stringify(payload, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'social_signals.json'), JSON.stringify(payload, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'query_signals_post_2027.json'), JSON.stringify({ generatedAt: payload.generatedAt, querySignals: signals }, null, 2) + '\n');
  console.log(`Social signal ingestion complete: ${signals.length} signals (${mode} mode).`);
})();
