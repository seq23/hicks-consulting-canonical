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
import { createRequire } from 'node:module';

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

// ------------------------------------------------- geographic resolvability
//
// "Not cited" and "open ground" are not the same fact, and conflating them
// produced a false opportunity list.
//
// A query like "therapist near me" carries no place. An engine asked it with no
// location context cannot answer it, so it string-matches instead: the observed
// citations for the eight "near me" targets on this account were
// lifestance.com/provider/therapist/ga/hicks, Healthgrades listings for Hickory
// PA and Hickory NC, mentalhealth.com/local/hicksville-ny, and - for the Olive
// Branch query - physical therapists. Those hosts are mostly directories, so
// platform_share came out high, so openness_score came out >= 0.6, so the query
// was labelled OPEN: "no page owns it".
//
// No page owns it because the question has no answer, not because the ground is
// free. A Memphis practice cannot win "therapist near me" as a global string,
// and reading that absence as an opportunity sends work at a target that does
// not exist.
//
// So a location-implying query with no location in it is scored
// UNRESOLVABLE_WITHOUT_LOCATION and carries no openness_score at all. The
// localized form - "therapist near me memphis" - is a separate governed target
// and is scored normally, because it is a question that can actually be asked.
const IMPLIES_LOCATION = [/\bnear me\b/, /\bnearby\b/, /\bopen now\b/, /\baround here\b/, /\bclose to me\b/];
const CARRIES_LOCATION = [
  /\bmemphis\b/, /\btennessee\b/, /\btn\b/, /\bolive branch\b/, /\bsouthaven\b/, /\bdesoto\b/,
  /\bmississippi\b/, /\bms\b/, /\barkansas\b/, /\bar\b/, /\bgermantown\b/, /\bcollierville\b/,
  /\bbartlett\b/, /\bcordova\b/, /\bnashville\b/, /\bmid[- ]south\b/,
  // generic "in <city> <ST>" - the same shape the T1 lead-intent classifier uses
  /\bin [a-z]+(?: [a-z]+)?,? (?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/,
];
const impliesLocation = (q) => IMPLIES_LOCATION.some((re) => re.test(q));
const carriesLocation = (q) => CARRIES_LOCATION.some((re) => re.test(q));
const geoResolvable = (query) => {
  const q = norm(query);
  if (carriesLocation(q)) return true;
  return !impliesLocation(q);
};

const OPENNESS_METHOD = {
  input: 'citations from data/search/query_observations.json, produced by scripts/search/live_query_observer.mjs (OpenRouter web plugin, engine=parallel, mode=turbo)',
  formula: 'openness_score = clamp(0.5 + 0.5*platform_share - 0.5*institutional_share, 0, 1)',
  platform_share: 'share of distinct cited hosts that are directories, marketplaces or user-generated platforms',
  institutional_share: 'share of distinct cited hosts on .gov/.edu/.mil or wikipedia',
  geo_precondition: 'A query that implies a location ("near me", "nearby", "open now") but names none is not answerable, so its citations are geographic noise and its openness reading is meaningless. Those are scored UNRESOLVABLE_WITHOUT_LOCATION and carry no openness_score. Measure the localized variant instead.',
  verdicts: {
    HELD_BY_US: 'the search already surfaced this practice - not an opportunity, a position to defend',
    OPEN: 'openness_score >= 0.6 - the answer is assembled from directories and platforms and no page owns it',
    CONTESTED: '0.4 <= openness_score < 0.6',
    HELD: 'openness_score < 0.4 - institutions or established publishers occupy the answer',
    UNMEASURED: 'the observer has not answered for this query; NOT a zero and never to be read as one',
    UNRESOLVABLE_WITHOUT_LOCATION: 'the query implies a place and names none, so no incumbent can hold it and "not cited" is an artifact of the question, NOT open ground',
  },
  not_measured: 'search volume, keyword difficulty, organic rank. The observer says so itself: rankVerified is false on every observation.',
};

function occupancyFor(query, byQuery, prior) {
  // Before anything else, including the carry-forward below. A stale OPEN on a
  // query that implies a place and names none is exactly the false opportunity
  // this verdict exists to stop, so it must not survive by being carried.
  if (!geoResolvable(query)) {
    return {
      verdict: 'UNRESOLVABLE_WITHOUT_LOCATION',
      reason: 'QUERY_IMPLIES_A_PLACE_AND_NAMES_NONE',
      openness_score: null,
      geo_resolvable: false,
      cited_hosts: [],
      observed_at: null,
      model: null,
      note: 'Citations returned for this string are geographic noise, so an openness reading would be meaningless and "not cited" here is not open ground. The localized variant of this query is the governed, measurable target.',
    };
  }
  const obs = byQuery.get(norm(query));
  if (!obs) {
    // data/search/query_observations.json is a ROLLING file - the observer caps
    // itself at 25 queries per run, so a target measured last week is simply not
    // in this week's file. Overwriting a real measurement with UNMEASURED because
    // the window rolled past it destroys the only openness reading this repo has;
    // one run of this script silently wiped the readings on all 54 targets.
    // A measurement that has aged is carried forward and marked stale, never
    // downgraded to "we never looked".
    if (prior && prior.reason === 'LIVE_WEB_SURFACING_OBSERVATION') {
      return { ...prior, stale: true, stale_reason: 'CARRIED_FORWARD_NO_OBSERVATION_IN_CURRENT_WINDOW' };
    }
    return { verdict: 'UNMEASURED', reason: 'NO_LIVE_OBSERVATION', openness_score: null, cited_hosts: [], observed_at: null, model: null };
  }
  // Same rule as a missing observation: a FAILED observation is not evidence that
  // the earlier successful one was wrong. Keep the reading, mark it stale.
  const carry = (reason) => (prior && prior.reason === 'LIVE_WEB_SURFACING_OBSERVATION')
    ? { ...prior, stale: true, stale_reason: reason }
    : { verdict: 'UNMEASURED', reason, openness_score: null, cited_hosts: [], observed_at: obs.observedAt || null, model: obs.model || null };
  if (obs.status !== 'ok' || !obs.providerAnswered) return carry('PROVIDER_ERROR');
  const hosts = [...new Set((obs.citations || []).map((c) => hostOf(c.url || c)).filter(Boolean))];
  if (!hosts.length) return carry('PROVIDER_ANSWERED_WITHOUT_RETRIEVING');
  const ours = hosts.filter((h) => h === 'hicksconsulting.org' || h.endsWith('.hicksconsulting.org'));
  const platform = hosts.filter(isPlatform).length / hosts.length;
  const institutional = hosts.filter(isInstitutional).length / hosts.length;
  const score = Math.max(0, Math.min(1, 0.5 + 0.5 * platform - 0.5 * institutional));
  const verdict = (obs.siteSurfaced || ours.length) ? 'HELD_BY_US' : score >= 0.6 ? 'OPEN' : score >= 0.4 ? 'CONTESTED' : 'HELD';
  return {
    verdict, reason: 'LIVE_WEB_SURFACING_OBSERVATION',
    geo_resolvable: true,
    openness_score: Number(score.toFixed(3)),
    platform_share: Number(platform.toFixed(3)),
    institutional_share: Number(institutional.toFixed(3)),
    distinct_cited_hosts: hosts.length,
    cited_hosts: hosts, cited_ours: ours,
    observed_at: obs.observedAt, model: obs.model,
    rank_verified: false,
  };
}

// -------------------------------------------------------- blue-ocean gate
//
// Shared with content generation so the two cannot drift: scripts/lib/demand_titles.js
// is the single definition of which observed queries describe real competitive
// ground for this practice.
const require_ = createRequire(import.meta.url);
const { blueOceanEligibility } = require_('../lib/demand_titles.js');

// ------------------------------------------------------------------ the merge
const before = JSON.stringify(read(TARGETS, null));
const doc = read(TARGETS, null);
if (!doc) { console.error(`score_discovery_gap: missing ${TARGETS}`); process.exit(1); }
const byQuery = new Map((doc.queries || []).map((q) => [norm(q.query), q]));

const gsc = read(GSC, {});
if (gsc.status !== 'ok') {
  // Two callers, two correct behaviours. Run by hand, a bad snapshot is an error
  // worth stopping on. Run inside `npm run ingest:all`, where Search Console
  // credentials may legitimately be absent, a hard exit would take the whole
  // ingestion lane down - so the flag turns it into a NAMED stop instead. It is
  // still a stop: no targets are merged and the caller is told why.
  const allowMissing = process.argv.includes('--allow-missing-snapshot');
  console.log(`score_discovery_gap: ${GSC} status is ${gsc.status || 'missing'}; refusing to merge targets from a snapshot that is not OK. NAMED STOP: GSC_SNAPSHOT_NOT_OK (targets left exactly as they were).`);
  process.exit(allowMissing ? 0 : 1);
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
  t.occupancy = occupancyFor(t.query, obsByQuery, t.occupancy);
  // ADDITIVE. `occupancy.verdict` still says exactly what it always said - it is
  // a measurement of who the observer's citation set contained. What it does NOT
  // say is whether that citation set was ABOUT this query.
  //
  // The observer string-matches "Hicks" and returns lifestance.com/provider/
  // therapist/ga/hicks, Healthgrades listings for Hickory PA and NC,
  // mentalhealth.com/local/hicksville-ny, and physical therapists in the Olive
  // Branch results. Those queries carry no service term and no location, so
  // retrieval has nothing to anchor to. Scoring that noise 0.6+ and reading it as
  // OPEN turns "not cited" into "open ground", and they are not the same thing.
  //
  // Content generation reads THIS field, not the verdict. Nothing downstream of
  // this file changes shape, and no existing verdict is rewritten.
  t.blue_ocean_eligible = blueOceanEligibility(t);
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
  blue_ocean_gate: {
    by: 'scripts/lib/demand_titles.js#blueOceanEligibility, written to target_queries[].blue_ocean_eligible',
    why: 'An OPEN occupancy verdict is a statement about WHO the observer cited, not about whether the citations were about this query. Surname-matched queries ("hicks", "carol hicks", "kerry hicks") and queries with no service or location anchor return Hickory PA/NC, Hicksville NY and unrelated practitioners; treating those as open ground is a false blue-ocean signal. Content generation reads blue_ocean_eligible; occupancy.verdict is left untouched.',
    ineligible_reasons: ['BRAND_OR_PERSON_NAME_NAVIGATIONAL', 'NO_SERVICE_OR_LOCATION_ANCHOR', 'ALREADY_HELD_BY_US', 'EMPTY_QUERY'],
  },
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

// Build determinism: this runs inside `ingest:all` on a schedule, and
// data/search is now in that job's commit set. The pass timestamp is the only
// field that moves on a no-op run, so bumping it every time would commit a
// daily diff that says nothing changed. Keep the previous timestamp when
// nothing else moved.
const priorAt = (() => { try { return JSON.parse(before)?.discovery_gap_pass?.at || null; } catch { return null; } })();
if (priorAt) {
  const a = JSON.parse(before); const b = JSON.parse(JSON.stringify(doc));
  if (a.discovery_gap_pass) a.discovery_gap_pass.at = null;
  if (b.discovery_gap_pass) b.discovery_gap_pass.at = null;
  if (JSON.stringify(a) === JSON.stringify(b)) doc.discovery_gap_pass.at = priorAt;
}
write(TARGETS, doc);

console.log(`[discovery-gap] ${doc.queries.length} governed targets (+${added} this pass), ${scored} with an openness reading.`);
console.log(`  lead intent: ${LEAD_TIER_ORDER.filter((t) => tiers[t]).map((t) => `${t}=${tiers[t]}`).join(' ')}`);
console.log(`  occupancy:   ${Object.entries(verdicts).sort().map(([k, v]) => `${k}=${v}`).join(' ')}`);
const unresolvable = doc.queries.filter((t) => t.occupancy.verdict === 'UNRESOLVABLE_WITHOUT_LOCATION');
if (unresolvable.length) {
  console.log(`  ${unresolvable.length} target(s) imply a place and name none. These are NOT open ground - the question has no answer, so nobody holds it. Measure the localized variant instead:`);
  for (const t of unresolvable.slice(0, 10)) {
    const variants = doc.queries.filter((q) => norm(q.localizes || '') === norm(t.query)).map((q) => q.query);
    console.log(`    - ${t.query}${variants.length ? ` -> ${variants.join(', ')}` : ' -> NO LOCALIZED VARIANT GOVERNED YET'}`);
  }
}
if (unlandable.length) console.log(`  ${unlandable.length} observed quer(y|ies) have impressions but no landing page: ${unlandable.slice(0, 5).join(', ')}`);
