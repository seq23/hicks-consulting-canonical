#!/usr/bin/env node
/**
 * Close the discovery gap: put the queries people actually typed into the
 * governed target set, and score them by openness and lead intent.
 *
 * The gap
 * -------
 * `data/intake/normalized_query_signals.json` holds 151 candidate signals, and
 * `data/intake/scored_query_clusters.json` reduces them to 7 clusters. Meanwhile
 * `data/search/target_queries.json` - the file the live query observer actually
 * reads, and the only list anything in this repo measures - held 7 hand-written
 * queries.
 *
 * Search Console reports 46 distinct queries that put this practice in front of
 * someone, mapped across 10 pages. Thirty-nine of them were not in the target
 * set, so nothing in the repo had ever looked at them.
 *
 * What this adds
 * --------------
 *   The observed queries, joined to the page Search Console says they landed on,
 *   with their impressions and average position carried across under their own
 *   names.
 *
 *   LEAD INTENT. This is a lead-gen practice - the page earns nothing until
 *   someone books - so every target is tiered by how close the searcher is.
 *   "therapist near me" and "what is burnout" are not the same query.
 *
 *   OPENNESS, from this repo's own prober. `scripts/search/live_query_observer.mjs`
 *   reads back the hosts a live web search surfaced for the query. Which hosts
 *   occupy an answer is a measurement. A query answered out of directories and
 *   forums is winnable by a real page; one answered out of .gov or an
 *   established publisher is not.
 *
 * What it does not add
 * --------------------
 * No search volume. There is no live paid keyword source on this account. GSC
 * impressions are this practice's OWN demand over the snapshot window, not market
 * volume, and they are written to a field that names what they are.
 *
 * The 151 intake signals are not promoted. Most are RSS titles and subreddit
 * names ("/r/BlackWomens", "reddit.com: search results - ...") - they are topic
 * signals, not queries anyone searched, and the normalizer that produces them
 * says as much by tagging every one `status: "candidate"`.
 *
 * Usage
 * -----
 *   node scripts/queries/score_discovery_gap.mjs      # merge targets + score
 *   LIVE_QUERY_LIMIT=25 npm run search:observe        # observe the top 25
 *   node scripts/queries/score_discovery_gap.mjs      # attach the observations
 *
 * A target the observer has not reached is `UNMEASURED`, never a zero.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return fb; } };
const write = (p, v) => { fs.mkdirSync(path.join(ROOT, path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(ROOT, p), JSON.stringify(v, null, 2) + '\n'); };

const TARGETS = 'data/search/target_queries.json';
const GSC = 'data/agency/gsc_snapshot.json';
const OBSERVATIONS = 'data/search/query_observations.json';

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const canonicalPath = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '/') || '/'; } catch { return String(u || '/'); } };

// ---------------------------------------------------------------- lead intent
//
// Word boundaries throughout. `\bfee` alone matches "feel" - which matters a
// great deal in a therapy vertical, where "i feel" phrasing is everywhere -
// while `\bfees?\b` does not.
const T1_LOCAL_READY = [
  /\bnear me\b/,
  /\bopen now\b/,
  /\bin[- ]network\b/,
  /\btakes? (?:my )?insurance\b/,
  /\baccepting new (?:clients|patients)\b/,
  /\bin [a-z]+(?: [a-z]+)?,? (?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/,
];
const T2_COST_IN_MARKET = [
  /\bhow much\b/, /\bcosts?\b/, /\bprice(?:s|d|ing)?\b/, /\bfees?\b/,
  /\bdoes insurance cover\b/, /\bcovered by insurance\b/, /\bworth it\b/,
  /\bout of pocket\b/, /\bsliding scale\b/, /\bcheap(?:est|er)?\b/, /\baffordable\b/,
  /\brates?\b/,
];
const T3_SELECTION = [
  /\bhow to (?:choose|compare|find|pick|select)\b/, /\bred flags?\b/, /\bvs\.?\b/,
  /\bversus\b/, /\bwhich is better\b/, /\bwhat to ask\b/, /\bquestions to ask\b/,
  /\bcompare\b/, /\bcomparison\b/, /\bdifference between\b/, /\bbest\b/,
];
const LEAD_TIER_ORDER = ['T1_LOCAL_READY', 'T2_COST_IN_MARKET', 'T3_SELECTION', 'T4_INFORMATIONAL'];

function leadIntentTier(query) {
  const q = norm(query);
  if (T1_LOCAL_READY.some((re) => re.test(q))) return 'T1_LOCAL_READY';
  if (T2_COST_IN_MARKET.some((re) => re.test(q))) return 'T2_COST_IN_MARKET';
  if (T3_SELECTION.some((re) => re.test(q))) return 'T3_SELECTION';
  return 'T4_INFORMATIONAL';
}

// -------------------------------------------------------------------- openness
//
// Computed only from hosts a live web search actually surfaced. The two host
// lists are definitional, not estimates: membership is a property of the host,
// decided once and written down, so the same observation always scores the same.
// Therapist directories sit in the platform list on purpose - a query answered
// out of Psychology Today listings has no page that owns it.
const PLATFORM_HOSTS = new Set([
  'reddit.com', 'quora.com', 'youtube.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'pinterest.com', 'linkedin.com', 'medium.com', 'x.com',
  'twitter.com', 'yelp.com', 'wikihow.com', 'answers.com', 'nextdoor.com',
  'psychologytoday.com', 'zocdoc.com', 'goodtherapy.org', 'therapyden.com',
  'healthgrades.com', 'thumbtack.com', 'alma.com', 'headway.co', 'wellness.com',
]);
const isPlatform = (h) => PLATFORM_HOSTS.has(h) || [...PLATFORM_HOSTS].some((p) => h.endsWith(`.${p}`));
const isInstitutional = (h) => /\.(gov|edu|mil)$/.test(h) || h === 'wikipedia.org' || h.endsWith('.wikipedia.org');
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

const OPENNESS_METHOD = {
  input: 'citations from data/search/query_observations.json, produced by scripts/search/live_query_observer.mjs (OpenRouter web plugin, engine=parallel, mode=turbo)',
  formula: 'openness_score = clamp(0.5 + 0.5*platform_share - 0.5*institutional_share, 0, 1)',
  platform_share: 'share of distinct cited hosts that are directories, marketplaces or user-generated platforms',
  institutional_share: 'share of distinct cited hosts on .gov/.edu/.mil or wikipedia',
  verdicts: {
    HELD_BY_US: 'the search already surfaced this practice - not an opportunity, a position to defend',
    OPEN: 'openness_score >= 0.6 - the answer is assembled from directories and platforms and no page owns it',
    CONTESTED: '0.4 <= openness_score < 0.6',
    HELD: 'openness_score < 0.4 - institutions or established publishers occupy the answer',
    UNMEASURED: 'the observer has not answered for this query; NOT a zero and never to be read as one',
  },
  not_measured: 'search volume, keyword difficulty, organic rank. The observer says so itself: rankVerified is false on every observation.',
};

function occupancyFor(query, byQuery) {
  const obs = byQuery.get(norm(query));
  if (!obs) return { verdict: 'UNMEASURED', reason: 'NO_LIVE_OBSERVATION', openness_score: null, cited_hosts: [], observed_at: null, model: null };
  if (obs.status !== 'ok' || !obs.providerAnswered) {
    return { verdict: 'UNMEASURED', reason: 'PROVIDER_ERROR', openness_score: null, cited_hosts: [], observed_at: obs.observedAt || null, model: obs.model || null };
  }
  const hosts = [...new Set((obs.citations || []).map((c) => hostOf(c.url || c)).filter(Boolean))];
  if (!hosts.length) return { verdict: 'UNMEASURED', reason: 'PROVIDER_ANSWERED_WITHOUT_RETRIEVING', openness_score: null, cited_hosts: [], observed_at: obs.observedAt, model: obs.model };
  const ours = hosts.filter((h) => h === 'hicksconsulting.org' || h.endsWith('.hicksconsulting.org'));
  const platform = hosts.filter(isPlatform).length / hosts.length;
  const institutional = hosts.filter(isInstitutional).length / hosts.length;
  const score = Math.max(0, Math.min(1, 0.5 + 0.5 * platform - 0.5 * institutional));
  const verdict = (obs.siteSurfaced || ours.length) ? 'HELD_BY_US' : score >= 0.6 ? 'OPEN' : score >= 0.4 ? 'CONTESTED' : 'HELD';
  return {
    verdict, reason: 'LIVE_WEB_SURFACING_OBSERVATION',
    openness_score: Number(score.toFixed(3)),
    platform_share: Number(platform.toFixed(3)),
    institutional_share: Number(institutional.toFixed(3)),
    distinct_cited_hosts: hosts.length,
    cited_hosts: hosts, cited_ours: ours,
    observed_at: obs.observedAt, model: obs.model,
    rank_verified: false,
  };
}

// ------------------------------------------------------------------ the merge
const doc = read(TARGETS, null);
if (!doc) { console.error(`score_discovery_gap: missing ${TARGETS}`); process.exit(1); }
const byQuery = new Map((doc.queries || []).map((q) => [norm(q.query), q]));

const gsc = read(GSC, {});
if (gsc.status !== 'ok') {
  console.error(`score_discovery_gap: ${GSC} status is ${gsc.status || 'missing'}; refusing to merge targets from a snapshot that is not OK.`);
  process.exit(1);
}

// Aggregate the query -> page pairs. Search Console reports the same query
// against several pages; the page with the most impressions is the one it is
// actually landing on, and that is the page the observer should evaluate.
const agg = new Map();
for (const r of gsc.queryPage || []) {
  const q = String(r.keys?.[0] || '').trim();
  const page = String(r.keys?.[1] || '').trim();
  if (!q) continue;
  const key = norm(q);
  const cur = agg.get(key) || { query: q, impressions: 0, clicks: 0, positions: [], pages: new Map() };
  cur.impressions += Number(r.impressions || 0);
  cur.clicks += Number(r.clicks || 0);
  if (r.position) cur.positions.push(Number(r.position));
  if (page) cur.pages.set(canonicalPath(page), (cur.pages.get(canonicalPath(page)) || 0) + Number(r.impressions || 0));
  agg.set(key, cur);
}
// A query with no page pairing still counts as observed demand; it just has no
// landing page yet, which is itself the finding.
for (const r of gsc.topQueries || []) {
  const q = String(r.keys?.[0] || '').trim();
  if (!q || agg.has(norm(q))) continue;
  agg.set(norm(q), { query: q, impressions: Number(r.impressions || 0), clicks: Number(r.clicks || 0), positions: r.position ? [Number(r.position)] : [], pages: new Map() });
}

const range = gsc.dateRange || {};
let added = 0;
for (const [key, row] of agg) {
  const bestPage = [...row.pages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const existing = byQuery.get(key);
  const measured = {
    impressions: row.impressions,
    clicks: row.clicks,
    average_position: row.positions.length ? Number((row.positions.reduce((a, b) => a + b, 0) / row.positions.length).toFixed(2)) : null,
    // Named for what it is. These are this practice's own impressions over the
    // snapshot window, not monthly search volume, and the two must never share
    // a field.
    window_start: range.startDate || range.start_date || null,
    window_end: range.endDate || range.end_date || null,
    source: 'google_search_console',
  };
  if (existing) {
    existing.gsc_measured = measured;
    continue;
  }
  if (!bestPage) {
    // No landing page for the observer to evaluate. Recorded on the file rather
    // than turned into a target the observer would fail on.
    continue;
  }
  byQuery.set(key, {
    query: row.query,
    intent: 'observed',
    primaryPage: bestPage,
    status: 'discovered_from_gsc',
    provenance: 'google_search_console query/page pair, joined by scripts/queries/score_discovery_gap.mjs',
    gsc_measured: measured,
  });
  added++;
}

const unlandable = [...agg.values()].filter((r) => !r.pages.size).map((r) => r.query);

// ----------------------------------------------------------------- the scoring
const observations = read(OBSERVATIONS, { observations: [] });
const obsByQuery = new Map();
for (const o of observations.observations || []) obsByQuery.set(norm(o.query), o);

let scored = 0;
for (const t of byQuery.values()) {
  t.lead_intent_tier = leadIntentTier(t.query);
  t.lead_intent_method = 'regex_classifier_on_query_string, scripts/queries/score_discovery_gap.mjs';
  t.occupancy = occupancyFor(t.query, obsByQuery);
  if (t.occupancy.openness_score !== null) scored++;
}

// Lead-intent tier first, then this practice's own impressions. The observer
// caps itself at 25 queries, so the order here decides what actually gets
// measured - it should be the queries a client arrives through.
doc.queries = [...byQuery.values()].sort((a, b) => (
  LEAD_TIER_ORDER.indexOf(a.lead_intent_tier) - LEAD_TIER_ORDER.indexOf(b.lead_intent_tier)
  || (b.gsc_measured?.impressions || 0) - (a.gsc_measured?.impressions || 0)
  || a.query.localeCompare(b.query)
));

const tiers = {}; const verdicts = {};
for (const t of doc.queries) {
  tiers[t.lead_intent_tier] = (tiers[t.lead_intent_tier] || 0) + 1;
  verdicts[t.occupancy.verdict] = (verdicts[t.occupancy.verdict] || 0) + 1;
}

doc.discovery_gap_pass = {
  at: new Date().toISOString(),
  by: 'scripts/queries/score_discovery_gap.mjs',
  why: 'The observer read a 7-query hand-written list while Search Console reported 46 queries that actually put this practice in front of someone. The measured list is now the target list, ordered so the observer spends its 25-query budget on the queries a client arrives through.',
  expansion_sources: [`${GSC} (live Search Console snapshot, ${range.startDate || '?'}..${range.endDate || '?'}) - query/page pairs`],
  refused_sources: [
    'data/intake/normalized_query_signals.json - 151 RSS titles and subreddit names ("/r/BlackWomens", "reddit.com: search results - ..."). Topic signals, not queries anyone searched. The normalizer tags every one status "candidate" for exactly this reason.',
    'any modelled or estimated search volume - no live paid keyword source exists on this account.',
  ],
  observed_queries_with_no_landing_page: unlandable,
  lead_intent_classifier: {
    T1_LOCAL_READY: 'near me / open now / in <City ST> / in-network / takes insurance / accepting new clients',
    T2_COST_IN_MARKET: 'how much / cost / price / fee / sliding scale / does insurance cover / out of pocket',
    T3_SELECTION: 'how to choose|compare|find / red flags / vs / comparison / which is better / what to ask / best',
    T4_INFORMATIONAL: 'everything else - definitions, lists, process explanations',
    note: 'Word-boundary anchored. `\\bfees?\\b` deliberately does not match "feel", which matters here: "i feel" phrasing is everywhere in this vertical.',
  },
  openness_method: OPENNESS_METHOD,
  counts: { total_targets: doc.queries.length, added_this_pass: added, with_openness_reading: scored, lead_intent: tiers, occupancy: verdicts },
};

write(TARGETS, doc);

console.log(`[discovery-gap] ${doc.queries.length} governed targets (+${added} this pass), ${scored} with an openness reading.`);
console.log(`  lead intent: ${LEAD_TIER_ORDER.filter((t) => tiers[t]).map((t) => `${t}=${tiers[t]}`).join(' ')}`);
console.log(`  occupancy:   ${Object.entries(verdicts).sort().map(([k, v]) => `${k}=${v}`).join(' ')}`);
if (unlandable.length) console.log(`  ${unlandable.length} observed quer(y|ies) have impressions but no landing page: ${unlandable.slice(0, 5).join(', ')}`);
