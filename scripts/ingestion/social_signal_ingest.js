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
// Three consecutive scheduled runs is roughly ten days on the twice-weekly cron.
// Read by validate_social_ingestion_stops.js, which is the thing that escalates.
const FALLBACK_STREAK_LIMIT = Number(policy.fallback_streak_limit || 3);


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

// A source carrying `enabled: false` and a written `reasonDisabled` is a decision,
// not an outage. Before this, every such lane was handed to fetchSource() anyway -
// and because the three research lanes hold no `url` at all, each one came back
// `status: "degraded", error: "Failed to parse URL from undefined"` on every
// scheduled run. Three permanent fake failures sat in source_health.json next to
// the real ones, so nothing downstream and nobody reading the file could tell a
// platform this repo has no credential for from a feed that had actually gone
// down. They are now STOPPED, by name, carrying the reason verbatim, and never
// fetched. A named stop is green; it is not a failure.
function stoppedRun(source) {
  const at = new Date().toISOString();
  return {
    ...source,
    status: 'stopped',
    namedStop: 'SOURCE_DISABLED_BY_CONFIGURATION',
    stopReason: source.reasonDisabled || 'Marked enabled:false in config/social_sources.json with no reason recorded.',
    startedAt: at,
    finishedAt: at,
    signals: []
  };
}

(async () => {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runs = [];
  for (const source of sources) {
    if (source.enabled === false) { runs.push(stoppedRun(source)); continue; }
    runs.push(await fetchSource(source));
    await sleep(policy.throttle?.delayMs || 750);
  }
  const externalSignals = runs.flatMap(run => run.signals.map(title => ({ id: `${run.id}-${slugify(title)}`, title, query: title, source: run.id, sourceType: run.kind || 'rss', tags: classifySignal(title), collectedAt: run.finishedAt })));
  const fallbackSignals = seedQueries.map(title => ({ id: `seed-${slugify(title)}`, title, query: title, source: 'seed_query_fallback', sourceType: 'seed', tags: classifySignal(title), collectedAt: new Date().toISOString() }));
  const mode = externalSignals.length && externalSignals.length >= fallbackSignals.length ? 'external' : externalSignals.length ? 'mixed' : 'fallback';
  const signals = mode === 'fallback' ? fallbackSignals : [...externalSignals, ...fallbackSignals].slice(0, 75);
  // Zero external signal is a real event and it must be SAID. Before this the run
  // printed "Social signal ingestion complete: 7 signals (fallback mode)" and
  // exited 0 - "complete", with a count made entirely of the seven hard-coded
  // seedQueries above, and no line anywhere naming the outage. The scheduled lane
  // stayed green while the clustering, scoring and drafting downstream of it ran
  // on seven constant strings.
  //
  // The lane still must not exit 1: one transient fetch failure across a set of
  // no-auth public feeds is normal and paging on it would be noise. So a
  // fallback-only run is a NAMED STOP - green, loud, and COUNTED. The streak is
  // what turns "the feeds were flaky on Tuesday" into "this ingestion has been
  // dead for ten days"; validate_social_ingestion_stops.js hard-fails once it
  // reaches SOCIAL_FALLBACK_STREAK_LIMIT, so the named stop cannot become a
  // parking space.
  const priorHealth = readJson('data/intake/source_health.json', {});
  const enabledRuns = runs.filter((run) => run.status !== 'stopped');
  const namedStops = [];
  const fallbackStreak = mode === 'fallback' ? Number(priorHealth.fallbackStreak || 0) + 1 : 0;
  if (!enabledRuns.length) {
    namedStops.push({
      stop: 'SOCIAL_SOURCES_NONE_ENABLED',
      detail: `config/social_sources.json lists ${sources.length} source(s) and every one is enabled:false, so nothing was fetched. Downstream clustering runs on the ${fallbackSignals.length} seed queries only.`
    });
  } else if (mode === 'fallback') {
    namedStops.push({
      stop: 'SOCIAL_SOURCES_ALL_DEGRADED',
      detail: `${enabledRuns.length} of ${enabledRuns.length} enabled source(s) returned no usable signal, so no external demand was ingested. Downstream clustering runs on the ${fallbackSignals.length} seed queries only. Consecutive fallback-only runs: ${fallbackStreak}.`
    });
  }
  const sourceHealth = {
    generatedAt: new Date().toISOString(),
    runId,
    mode,
    externalSignalCount: externalSignals.length,
    fallbackSignalCount: fallbackSignals.length,
    enabledSourceCount: enabledRuns.length,
    stoppedSourceCount: runs.length - enabledRuns.length,
    degradedSourceCount: enabledRuns.filter((run) => run.status === 'degraded').length,
    fallbackStreak,
    fallbackStreakLimit: FALLBACK_STREAK_LIMIT,
    namedStops,
    sources: runs.map(({ id, name, url, status, httpStatus, error, namedStop, stopReason, startedAt, finishedAt, signals }) => ({ id, name, url, status, httpStatus, error, namedStop, stopReason, startedAt, finishedAt, signalCount: signals.length }))
  };
  const payload = {
    generatedAt: sourceHealth.generatedAt,
    runId,
    mode,
    productionRule: `No-auth ingestion must degrade gracefully: a source failure is logged as degraded, a source disabled by configuration is logged as a named stop, and neither exits non-zero. A fallback-only run is a named stop, not a success - it is counted, and validate_social_ingestion_stops.js hard-fails once ${FALLBACK_STREAK_LIMIT} consecutive fallback-only runs are recorded.`,
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
  // Measured Search Console rows are merged into this same file by
  // scripts/queries/ingest_gsc_evidence.mjs. This writer rebuilds the file from
  // scraped sources, so preserve those measured rows explicitly - otherwise every
  // social ingest would silently erase the only real demand evidence the pipeline
  // has, which is exactly the failure mode this ingestion was meant to fix.
  const scrapedQueries = new Set(signals.map((s) => String(s?.query || '').trim().toLowerCase()).filter(Boolean));
  const priorSignals = readJson('data/intake/query_signals_post_2027.json', { querySignals: [] }).querySignals || [];
  const measuredSignals = priorSignals.filter((s) => (s?.sourceType === 'gsc_search_analytics' || s?.evidence_tier === 'T1')
    && !scrapedQueries.has(String(s?.query || '').trim().toLowerCase()));
  fs.writeFileSync(path.join(outDir, 'query_signals_post_2027.json'), JSON.stringify({ generatedAt: payload.generatedAt, querySignals: [...signals, ...measuredSignals] }, null, 2) + '\n');
  for (const stop of namedStops) console.log(`NAMED STOP: ${stop.stop} - ${stop.detail}`);
  for (const run of runs.filter((r) => r.status === 'stopped')) console.log(`NAMED STOP: ${run.namedStop} - ${run.id}: ${run.stopReason}`);
  console.log(`Social signal ingestion: ${externalSignals.length} external signal(s) from ${enabledRuns.filter((r) => r.status === 'ok').length}/${enabledRuns.length} enabled source(s), ${sourceHealth.stoppedSourceCount} stopped by configuration; ${signals.length} signal(s) written in ${mode} mode.`);
})();
