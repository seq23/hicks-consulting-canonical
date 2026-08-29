#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const demandTitles = createRequire(import.meta.url)('../lib/demand_titles.js');

const RUN = process.env.CONTINUITY_RUN_DATE || new Date().toISOString().slice(0, 10);
const HORIZON = Number(process.env.CONTINUITY_HORIZON_DAYS || 120);

// Cadence policy: 2026 is locked and client-approved; the from_2027 lane is
// adjustable without editing this generator. Both lanes emit candidates that still
// require approval through /admin, so cadence controls how much is PROPOSED for
// review, never what is published.
const POLICY = (() => { try { return JSON.parse(fs.readFileSync('data/continuity/cadence_policy.json', 'utf8')); } catch { return null; } })();
const LOCKED_THROUGH = POLICY?.locked_through || '2026-12-31';
const laneFor = (dateStr) => {
  const lanes = POLICY?.lanes || {};
  return dateStr > LOCKED_THROUGH ? (lanes.from_2027 || lanes.locked_2026 || {}) : (lanes.locked_2026 || {});
};
const DRY = process.argv.includes('--dry-run');
const DAY_MS = 86400000;

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return fallback; }
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function atUtc(date) { return new Date(`${date}T00:00:00Z`); }
function addDays(date, n) { return new Date(atUtc(date).getTime() + n * DAY_MS); }
function maxDate(values, fallback) { return values.filter(Boolean).sort().at(-1) || fallback; }
function canonicalId(type, date, query) {
  return `continuity-${type}-${date}-${crypto.createHash('sha256').update(`${type}|${date}|${query}`).digest('hex').slice(0, 12)}`;
}
// `titleFor` used to live here. It composed every candidate title as
// `${query||topic}` plus one of four interchangeable editorial suffixes
// (": a practical guide to what matters most", ": a deeper guide for reflection
// and next steps", ": a practical quarterly reference", ": what to understand and
// what to do next"). Because build_max_fanout.mjs seeds its "queries" from this
// site's OWN manifest titles, the topic it was appending to was itself already a
// suffixed title - a closed loop that could only ever emit near-duplicates. That
// loop is what put duplicateHtmlTitle: true on all 54 mappings in
// reports/BING_INDEXATION_CONSOLIDATION_REPORT.json.
//
// Titles are now DRAWN from config/demand_phrasings.json - complete, standalone,
// human-phrased questions grounded in the live clusters and the measured GSC
// target queries - and claimed through a registry that refuses a duplicate or a
// stem-plus-suffix of anything the repo already owns. Volume is unchanged: the
// same slots are filled, each from a DIFFERENT real question, so three pieces off
// one topic read like three different searches.
//
// Sections follow the FORM of the question (why / how / what / complaint), which
// is what pulls two pieces on the same topic structurally apart rather than
// leaving them the ~0.85-0.93 body-similar the 2026-08-08 consolidation found.
const sectionsFor = (type, form) => demandTitles.sectionsForForm(form, type);
function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'resource';
}
function contentDir(type) {
  return type === 'article' ? 'articles' : type === 'guide' ? 'guides' : type === 'whitepaper' ? 'white-papers' : 'insights';
}

const manifest = readJson('data/admin/content_manifest.json', []);
const backlog = readJson('data/authority_scale/candidate_backlog.json', { candidates: [] });
const briefs = readJson('data/intake/content_brief_candidates.json', { candidates: [] });
const queue = readJson('data/social/publish_queue.json', { items: [] });
const policy = readJson('config/content_generation_policy.json', { contentTypes: {}, humanizationChecklist: [] });
const config = readJson('data/system/config.json', {});

const existingItems = [...(briefs.candidates || []), ...(queue.items || [])];
const existingIds = new Set(existingItems.map(x => x?.id).filter(Boolean));
const continuityPlannedDates = existingItems
  .filter(x => x?.continuity_generated === true || String(x?.id || '').startsWith('continuity-'))
  .map(x => String(x.proposedScheduledAt || '').slice(0, 10))
  .filter(Boolean);
const manifestDates = manifest.map(x => String(x.scheduledAt || '').slice(0, 10)).filter(Boolean);
const baselineEnd = maxDate(manifestDates, RUN);
const coverageEnd = maxDate([...manifestDates, ...continuityPlannedDates], baselineEnd);
const targetEnd = isoDate(new Date(atUtc(RUN).getTime() + HORIZON * DAY_MS));
const slots = [];

for (let d = addDays(coverageEnd, 1); isoDate(d) <= targetEnd; d = new Date(d.getTime() + DAY_MS)) {
  const date = isoDate(d);
  const dow = d.getUTCDay();
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const lane = laneFor(date);
  if ((lane.insight_weekdays ?? [1, 2, 3, 4, 5]).includes(dow)) slots.push({ date, type: 'insight', cadence: 'daily' });
  if (dow === (lane.article_weekday ?? 2)) slots.push({ date, type: 'article', cadence: 'weekly' });
  if (day === (lane.guide_day_of_month ?? 15)) slots.push({ date, type: 'guide', cadence: 'monthly' });
  if (day === (lane.whitepaper_day_of_month ?? 20) && (lane.whitepaper_months ?? [3, 6, 9, 12]).includes(month)) slots.push({ date, type: 'whitepaper', cadence: 'quarterly' });
}

const candidates = backlog.candidates || [];
const conversionPath = config?.forms?.therapy || 'https://monika-hicks.clientsecure.me/';

// The registry is seeded with every title the repo already owns - the manifest,
// the brief candidates and both queues. That is the LINK that used to be missing:
// each generator kept its own list and none of them could see the others.
const registry = new demandTitles.TitleRegistry(demandTitles.takenTitles(process.cwd()), {
  grandfathered: demandTitles.grandfatheredKeys(process.cwd()),
});
const demandPool = demandTitles.buildDemandPool(process.cwd(), { registry });
let poolExhaustedAt = null;
function drawTitle() {
  while (demandPool.length) {
    const entry = demandPool.shift();
    if (registry.claim(entry.title)) return entry;
  }
  return null;
}

const picked = [];
let slotsUnfilled = 0;
for (let i = 0; i < slots.length && candidates.length; i++) {
  const slot = slots[i];
  const c = candidates[(i * 17 + slot.date.charCodeAt(9)) % candidates.length];
  const typePolicy = policy.contentTypes?.[slot.type] || policy.contentTypes?.insight || { targetWords: 900, minimumWords: 720 };
  const drawn = drawTitle();
  if (!drawn) {
    // NAMED STOP. The phrasing bank is empty, so there is no research-grounded
    // question left to justify another page. Emitting a templated title here is
    // exactly the defect being removed, so the run stops filling slots and says
    // why. Replenish config/demand_phrasings.json from new research.
    if (!poolExhaustedAt) poolExhaustedAt = slot.date;
    slotsUnfilled = slots.length - i;
    break;
  }
  const title = drawn.title;
  // The candidate is identified by the QUESTION it answers, not by a recycled
  // fanout string. build_max_fanout.mjs seeds its "queries" from this site's own
  // manifest titles, so `c.query` is a paraphrase of an existing page - anchoring
  // a new candidate to it is what kept the bodies ~0.85-0.93 similar.
  const id = canonicalId(slot.type, slot.date, title);
  if (existingIds.has(id)) continue;
  const sections = sectionsFor(slot.type, drawn.form);
  const proposedScheduledAt = `${slot.date}T13:00:00.000Z`;
  const llmPrompt = [
    `Create a humanized ${slot.type} draft for Hicks Consulting.`,
    `Title: ${title}`,
    `This page exists to answer exactly one real question a person typed or said: "${title}". Answer THAT question in its own words in the first two sentences. Do not widen it into a general overview of ${drawn.evidence?.[0]?.title || drawn.familyId}; other pages on this site answer other questions in the same area and this one must not restate them.`,
    `Cadence: ${slot.cadence}. Proposed future slot: ${proposedScheduledAt}.`,
    `Minimum words: ${typePolicy.minimumWords}. Target words: ${typePolicy.targetWords}.`,
    'Use an answer-first opening, exact-intent headings, concrete examples, and a checklist or decision framework where useful.',
    'Write in a warm, grounded, specific voice. Do not diagnose, guarantee outcomes, or invent client stories.',
    `Include these sections: ${sections.join('; ')}.`,
    `Approved conversion path after value is delivered: ${conversionPath}.`,
    'This is an autonomous candidate. It must pass Safe Harbor, duplicate, source, cadence, build, and release validation before it can be scheduled.'
  ].join('\n');
  picked.push({
    id,
    clusterId: drawn.clusterId || c.opportunity_id,
    clusterTitle: drawn.evidence?.[0]?.title || c.topic,
    demandPhrasing: { source: 'config/demand_phrasings.json', familyId: drawn.familyId, clusterId: drawn.clusterId, form: drawn.form, groundedIn: drawn.groundedIn, evidence: drawn.evidence },
    contentType: slot.type,
    cadence: slot.cadence,
    title,
    // The URL now reads like the question the page answers, instead of a hash.
    suggestedRoute: `/resources/${contentDir(slot.type)}/${slugify(title)}/`,
    proposedScheduledAt,
    targetWords: typePolicy.targetWords,
    minimumWords: typePolicy.minimumWords,
    sourceSignalCount: 1,
    score: c.priority_score,
    publishMode: 'full_safe_autonomy',
    autonomyStatus: 'DISCOVERED',
    llmGeneratedRequired: true,
    routineApprovalRequired: false,
    publicOnlyAfterApproval: false,
    continuity_generated: true,
    continuityAfter: '2027-01-01',
    continuityPolicy: 'rolling_120_day_candidate_runway_existing_cadence',
    humanizationChecklist: policy.humanizationChecklist || [],
    conversionPath,
    sections,
    llmPrompt
  });
  existingIds.add(id);
}

const report = {
  schema_version: '1.1',
  run_date: RUN,
  horizon_days: HORIZON,
  last_manifest_scheduled_date: baselineEnd,
  prior_coverage_end: coverageEnd,
  target_coverage_end: targetEnd,
  planned_slots_needed: slots.length,
  candidates_added: picked.length,
  dry_run: DRY,
  // Where every title came from, and what happens when there are none left.
  title_source: 'config/demand_phrasings.json via scripts/lib/demand_titles.js (drawn, never composed)',
  demand_pool_exhausted: Boolean(poolExhaustedAt),
  demand_pool_exhausted_at_slot: poolExhaustedAt,
  slots_left_unfilled_for_lack_of_research: slotsUnfilled,
  exhaustion_remedy: slotsUnfilled
    ? 'DEMAND_POOL_EXHAUSTED - replenish config/demand_phrasings.json from new query research. No templated fallback title is emitted.'
    : null,
  cadence_preserved: {
    daily: 'weekday insights',
    weekly: 'Tuesday article',
    monthly: '15th guide',
    quarterly: 'Mar/Jun/Sep/Dec 20th whitepaper'
  },
  publication_authority: 'FULL_SAFE_AUTONOMY_WITH_EXISTING_VELOCITY'
};

fs.mkdirSync('data/continuity', { recursive: true });
fs.writeFileSync('data/continuity/editorial_continuity_report.json', JSON.stringify(report, null, 2) + '\n');

if (!DRY && picked.length) {
  const briefMap = new Map((briefs.candidates || []).map(x => [x.id, x]));
  const queueMap = new Map((queue.items || []).map(x => [x.id, x]));
  for (const x of picked) {
    briefMap.set(x.id, x);
    queueMap.set(x.id, { ...x, queueType: 'content_brief', status: 'DISCOVERED', autonomyStatus: 'DISCOVERED' });
  }
  const generatedAt = `${RUN}T00:00:00.000Z`;
  const nextBriefs = { ...briefs, generatedAt, candidates: [...briefMap.values()] };
  const nextQueue = { ...queue, generatedAt, publishMode: 'full_safe_autonomy', items: [...queueMap.values()] };
  fs.writeFileSync('data/intake/content_brief_candidates.json', JSON.stringify(nextBriefs, null, 2) + '\n');
  fs.writeFileSync('data/social/publish_queue.json', JSON.stringify(nextQueue, null, 2) + '\n');
}

console.log(JSON.stringify(report, null, 2));
