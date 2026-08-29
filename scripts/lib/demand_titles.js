'use strict';
/**
 * Demand-grounded titles.
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * Titles used to be COMPOSED: a parent title plus an interchangeable editorial
 * suffix (": A Gentler Truth To Consider", ": What This Looks Like In Real Life",
 * ": Next-Step Reflection", ": Why Women Minimize It"). Three derivative pieces
 * off one parent were one title wearing three hats. On 2026-08-08 that cost this
 * site 54 pages: every mapping in reports/BING_INDEXATION_CONSOLIDATION_REPORT.json
 * carries duplicateHtmlTitle: true.
 *
 * Two other generators did the same thing with different suffixes:
 *   scripts/ingestion/build_content_brief_candidates.js  ": what people are asking and what to do next"
 *   scripts/continuity/replenish_editorial_candidates.mjs ": a practical guide to what matters most" etc.
 *
 * THE REPLACEMENT
 * ---------------
 * Titles are DRAWN, not composed. config/demand_phrasings.json holds a bank of
 * complete, standalone, human-phrased questions and complaints, each tied to a
 * live research family (a cluster in data/intake/query_clusters.json, or a
 * lead-intent tier in data/search/target_queries.json). There is no suffix,
 * because there is no composition step. A piece gets ONE phrasing; the phrasing
 * is then consumed and can never be issued again.
 *
 * Derivative volume is preserved. N derivative pieces off one parent still get
 * generated - they just draw N DIFFERENT phrasings, so a stranger reading the
 * list cannot tell they share a source article.
 *
 * UNIQUENESS IS STRUCTURAL
 * ------------------------
 * TitleRegistry is seeded with every title the repo already owns (manifest,
 * brief candidates, publish queue). claim() refuses a title that duplicates a
 * taken title OR that is a taken title plus a suffix (in either direction),
 * normalised so punctuation and casing cannot smuggle a duplicate through.
 * A collision is impossible rather than unlikely: the only way to get a title
 * is to claim it, and claim() is the thing that rejects.
 *
 * WHEN THE BANK RUNS OUT
 * ----------------------
 * nextTitle() returns null and the caller must stop with the named reason
 * DEMAND_POOL_EXHAUSTED. It never falls back to a template. Rule 0: a named
 * legitimate stop, not silent nothing.
 */

const fs = require('fs');
const path = require('path');

const PHRASEBOOK_PATH = 'config/demand_phrasings.json';
const CLUSTERS_PATH = 'data/intake/query_clusters.json';
const TARGETS_PATH = 'data/search/target_queries.json';
const MANIFEST_PATH = 'data/admin/content_manifest.json';
const BRIEFS_PATH = 'data/intake/content_brief_candidates.json';
const QUEUE_PATH = 'data/social/publish_queue.json';
const AUTONOMY_QUEUE_PATH = 'data/autonomy/queue.json';

/** Editorial suffixes that must never reappear. Asserted, not merely documented. */
const BANNED_SUFFIX_PATTERNS = [
  /:\s*a gentler truth to consider$/i,
  /:\s*what this looks like in real life$/i,
  /:\s*next-?step reflection$/i,
  /:\s*why women minimize it$/i,
  /:\s*how it shows up in work and (relationships|life)$/i,
  /:\s*what people are asking and what to do next$/i,
  /:\s*a practical guide to what matters most$/i,
  /:\s*a deeper guide for reflection and next steps$/i,
  /:\s*a practical quarterly reference$/i,
  /:\s*what to understand and what to do next$/i,
];

function readJson(root, rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return fallback; }
}

/**
 * Comparison key. Lowercase, strip punctuation, collapse whitespace. Two titles
 * that differ only in punctuation or case are the SAME title for uniqueness
 * purposes - that is how ": A Gentler Truth To Consider" variants used to slip
 * past a naive Set of raw strings.
 */
function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Is one of these two titles the other one plus a suffix?
 * Word-boundary anchored: "how burnout shows up" is a stem of
 * "how burnout shows up before you call it burnout", but "boundary" is NOT a
 * stem of "boundaries".
 * Returns null, or { stem, extended }.
 */
function stemSuffixRelation(a, b) {
  const ka = normalizeTitleKey(a);
  const kb = normalizeTitleKey(b);
  if (!ka || !kb || ka === kb) return null;
  if (kb.startsWith(`${ka} `)) return { stem: a, extended: b };
  if (ka.startsWith(`${kb} `)) return { stem: b, extended: a };
  return null;
}

function bannedSuffix(title) {
  return BANNED_SUFFIX_PATTERNS.find((re) => re.test(String(title || ''))) || null;
}

class TitleRegistry {
  /**
   * @param {string[]} existingTitles every title the repo already owns.
   * @param {object}  [options]
   * @param {Set<string>} [options.grandfathered] normalized keys of legacy titles
   *        that may participate in a stem/suffix pair with each other. New titles
   *        are never exempt.
   */
  constructor(existingTitles = [], options = {}) {
    this.grandfathered = options.grandfathered || new Set();
    this.keys = new Set();
    this.titles = [];
    for (const title of existingTitles) this.#absorb(title);
  }

  #absorb(title) {
    const key = normalizeTitleKey(title);
    if (!key) return;
    this.keys.add(key);
    this.titles.push(title);
  }

  /** Every reason `title` cannot be issued. Empty array means it can. */
  rejections(title) {
    const reasons = [];
    const key = normalizeTitleKey(title);
    if (!key) { reasons.push({ code: 'EMPTY_TITLE' }); return reasons; }
    if (this.keys.has(key)) reasons.push({ code: 'DUPLICATE_TITLE', key });
    const banned = bannedSuffix(title);
    if (banned) reasons.push({ code: 'BANNED_EDITORIAL_SUFFIX', pattern: String(banned) });
    for (const taken of this.titles) {
      const relation = stemSuffixRelation(title, taken);
      if (!relation) continue;
      // A legacy pair may stay a legacy pair; a NEW title may never join one.
      if (this.grandfathered.has(normalizeTitleKey(taken)) && this.grandfathered.has(key)) continue;
      reasons.push({ code: 'STEM_PLUS_SUFFIX', stem: relation.stem, extended: relation.extended });
      break;
    }
    return reasons;
  }

  /** Take the title if it is issuable. Returns the title, or null. */
  claim(title) {
    if (this.rejections(title).length) return null;
    this.#absorb(title);
    return title;
  }
}

// --------------------------------------------------------------- research gate
//
// "Not cited" is NOT the same as "open ground". data/search/query_observations.json
// string-matches the word "Hicks" and returns Healthgrades listings for Hickory
// PA/NC, mentalhealth.com/local/hicksville-ny and unrelated physical therapists.
// Those queries carry no location and no service term, so the observer has
// nothing to anchor to and the citation set is noise. Scoring that noise as
// openness_score >= 0.6 and calling the query OPEN is a false blue-ocean signal.
//
// This gate refuses to ground a title in such a query. It is additive: it does
// not change any verdict already written to target_queries.json, it decides what
// CONTENT GENERATION is allowed to believe.
const SERVICE_TERMS = /\b(therap(?:y|ist|ists)|counsel(?:ing|or|ors)|psycholog(?:y|ist|ists)|mental health|burnout|anxiety|trauma|grief|coaching|consult(?:ing|ant)|training|depression|wellness)\b/;
const LOCATION_TERMS = /\b(near me|memphis|tennessee|tn|olive branch|ms|germantown|online|virtual|local)\b/;
const BRAND_TOKEN = /\bhicks\b/;

function blueOceanEligibility(target) {
  const q = String(target && target.query || '').toLowerCase();
  if (!q) return { eligible: false, reason: 'EMPTY_QUERY' };
  if (BRAND_TOKEN.test(q)) {
    return { eligible: false, reason: 'BRAND_OR_PERSON_NAME_NAVIGATIONAL', note: 'Surname-matched query. The live observer returns Hickory/Hicksville and unrelated Hicks practitioners for these; an OPEN verdict on them is noise, not open ground.' };
  }
  if (!SERVICE_TERMS.test(q) && !LOCATION_TERMS.test(q)) {
    return { eligible: false, reason: 'NO_SERVICE_OR_LOCATION_ANCHOR', note: 'The observer has nothing to anchor retrieval to, so its citation set does not describe this practice\'s competitive ground.' };
  }
  const verdict = target && target.occupancy && target.occupancy.verdict;
  if (verdict === 'HELD_BY_US') return { eligible: false, reason: 'ALREADY_HELD_BY_US' };
  return { eligible: true, reason: verdict === 'OPEN' ? 'OPEN_WITH_ANCHORED_OBSERVATION' : (verdict || 'UNMEASURED') };
}

// ------------------------------------------------------------------ the pool

/**
 * Titles the repo already owns, from every list that can hold one. Two components
 * each keeping their own list with no link is how the duplicates got in; this is
 * the link.
 */
function takenTitles(root, options = {}) {
  // `manifestOnly` is for the drafting cycle. There, the CANDIDATES are the
  // things being titled, so seeding the registry with the candidate queues would
  // make every candidate collide with itself. What is already owned there is what
  // holds a route: the manifest.
  const out = [];
  const manifest = readJson(root, MANIFEST_PATH, []);
  for (const item of Array.isArray(manifest) ? manifest : []) if (item && item.title) out.push(item.title);
  if (options.manifestOnly) return out;
  for (const rel of [BRIEFS_PATH, QUEUE_PATH, AUTONOMY_QUEUE_PATH]) {
    const doc = readJson(root, rel, {});
    for (const item of doc.candidates || doc.items || []) if (item && item.title) out.push(item.title);
  }
  return out;
}

/**
 * Rank each phrasebook family by the research that justifies it, then round-robin
 * across families so consecutive slots do not all land on one topic.
 *
 * Throws if a family names research that does not exist - a phrasebook that has
 * drifted away from the pipeline is a guard that cannot reach what it governs.
 */
function buildDemandPool(root, options = {}) {
  const book = readJson(root, PHRASEBOOK_PATH, null);
  if (!book || !book.families) throw new Error(`demand_titles: missing or unreadable ${PHRASEBOOK_PATH}`);
  const clusters = readJson(root, CLUSTERS_PATH, { clusters: [] }).clusters || [];
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  const targets = readJson(root, TARGETS_PATH, { queries: [] }).queries || [];

  const families = [];
  for (const [familyId, family] of Object.entries(book.families)) {
    let rank = 0;
    const evidence = [];
    if (family.clusterId) {
      const cluster = clusterById.get(family.clusterId);
      if (!cluster) throw new Error(`demand_titles: family "${familyId}" names cluster "${family.clusterId}" which is not in ${CLUSTERS_PATH}`);
      rank = Number(cluster.score || 0);
      evidence.push({ kind: 'cluster', id: cluster.id, title: cluster.title, score: cluster.score, queryCount: cluster.queryCount });
    }
    if (Array.isArray(family.leadIntentTiers) && family.leadIntentTiers.length) {
      const matched = targets.filter((t) => family.leadIntentTiers.includes(t.lead_intent_tier) && blueOceanEligibility(t).eligible);
      if (!matched.length) throw new Error(`demand_titles: family "${familyId}" names lead-intent tiers ${family.leadIntentTiers.join('/')} but no eligible target query in ${TARGETS_PATH} carries one`);
      const impressions = matched.reduce((sum, t) => sum + Number((t.gsc_measured || {}).impressions || 0), 0);
      // Measured demand is the strongest evidence in the repo, so it outranks
      // cluster score, which is derived from RSS topic signals.
      rank = Math.max(rank, 100 + impressions);
      evidence.push({ kind: 'measured_queries', count: matched.length, impressions, examples: matched.slice(0, 5).map((t) => t.query) });
    }
    if (!evidence.length) throw new Error(`demand_titles: family "${familyId}" is grounded in nothing`);
    families.push({ familyId, rank, evidence, phrasings: family.phrasings || [], groundedIn: family.groundedIn || [] });
  }
  families.sort((a, b) => b.rank - a.rank || a.familyId.localeCompare(b.familyId));

  const pool = [];
  const cursors = families.map(() => 0);
  let remaining = families.reduce((n, f) => n + f.phrasings.length, 0);
  while (remaining > 0) {
    for (let i = 0; i < families.length; i++) {
      const family = families[i];
      if (cursors[i] >= family.phrasings.length) continue;
      const phrasing = family.phrasings[cursors[i]++];
      remaining--;
      pool.push({
        title: phrasing.title,
        form: phrasing.form || 'question',
        familyId: family.familyId,
        clusterId: family.clusterId || null,
        familyRank: family.rank,
        groundedIn: family.groundedIn,
        evidence: family.evidence,
      });
    }
  }
  if (options.registry) return pool.filter((entry) => !options.registry.rejections(entry.title).length);
  return pool;
}

/**
 * Section plan derived from the FORM of the question, not from the content type.
 * "Why does X happen" and "How do I do X" want structurally different articles;
 * this is what pulls two derivative bodies apart rather than leaving them ~90%
 * similar the way the 2026-08-08 consolidation found them.
 */
function sectionsForForm(form, contentType) {
  if (contentType === 'whitepaper') {
    return ['Executive summary', 'The question people are actually asking', 'What the evidence shows', 'Audience analysis', 'Framework', 'Implementation guidance', 'Risks and limitations', 'Recommended next steps'];
  }
  switch (form) {
    case 'why':
      return ['Short answer', 'What is actually happening', 'Why it shows up this way', 'What it is not', 'What usually makes it worse', 'What helps', 'When to get support'];
    case 'how':
      return ['Short answer', 'Before you start', 'Step by step', 'What to say', 'What gets in the way', 'How to tell it is working', 'Next step'];
    case 'complaint':
      return ['You are not imagining it', 'What this usually means', 'The pattern underneath', 'What to try this week', 'What not to do', 'When it is time to talk to someone'];
    case 'what':
    default:
      return ['Short answer', 'Who this is for', 'What it looks like', 'How to tell the difference', 'Common mistakes', 'What to do next', 'When to seek support'];
  }
}

/** Grandfathered legacy keys, loaded from the frozen ledger. */
function grandfatheredKeys(root) {
  const ledger = readJson(root, 'data/admin/legacy_title_grandfather.json', null);
  if (!ledger) return new Set();
  return new Set((ledger.titles || []).map(normalizeTitleKey));
}

module.exports = {
  PHRASEBOOK_PATH,
  BANNED_SUFFIX_PATTERNS,
  normalizeTitleKey,
  stemSuffixRelation,
  bannedSuffix,
  TitleRegistry,
  blueOceanEligibility,
  takenTitles,
  buildDemandPool,
  sectionsForForm,
  grandfatheredKeys,
  readJson,
};
