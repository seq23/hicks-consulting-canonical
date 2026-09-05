#!/usr/bin/env node
/**
 * Guard the three discovery-gap defects so none of them can return silently.
 *
 * (1) ORPHANED / DISCARDED. scripts/queries/score_discovery_gap.mjs once had no
 *     npm script and no workflow invoking it. It is now inside `ingest:all`,
 *     which two workflows run - but it writes data/search/target_queries.json,
 *     and neither of those workflows' commit sets included data/search, so the
 *     score it produced was thrown away at the end of every job. A generator
 *     that runs and has its output discarded is the same defect as one that
 *     never runs: the file ages while looking live. This asserts both that a
 *     caller exists AND that the caller keeps what it wrote.
 *
 * (2) DESTRUCTIVE RE-RUN. data/search/query_observations.json is a ROLLING file
 *     - the observer caps at 25 queries per run. The scorer used to overwrite
 *     every target whose observation had rolled out of that window with
 *     UNMEASURED; one run wiped the openness readings on all 54 targets. This
 *     asserts the carry-forward is still in the code and still reachable.
 *
 * (3) BLUE-OCEAN CONFLATION. "Not cited" is NOT "open ground". Openness was
 *     scored from whatever hosts the search returned, so surname matches on
 *     "Hicks" (Healthgrades Hickory PA/NC, Hicksville NY) and queries with no
 *     service or location anchor scored as winnable. This asserts the additive
 *     blue_ocean_eligible gate is present on every target and is still refusing
 *     the navigational and unanchored ones.
 *
 * Hard-fails if it examines zero targets. A validator that passes on an empty
 * loop is the same "exists but proves nothing" defect it is here to prevent.
 */
const fs = require('fs');
const { emitFinding } = require('../validation/protocol');

const problems = [];
const stops = [];
const fail = (m) => problems.push(m);
const readText = (p) => { if (!fs.existsSync(p)) { fail(`missing ${p}`); return ''; } return fs.readFileSync(p, 'utf8'); };
const readJson = (p) => { try { return JSON.parse(readText(p)); } catch (e) { fail(`unreadable JSON: ${p} (${e.message})`); return null; } };

const SCRIPT = 'scripts/queries/score_discovery_gap.mjs';
const GATE = 'scripts/lib/demand_titles.js';
const TARGETS = 'data/search/target_queries.json';

const src = readText(SCRIPT);
const gateSrc = readText(GATE);
const pkg = readJson('package.json') || { scripts: {} };
const scripts = pkg.scripts || {};

// --------------------------------------- (1) a caller exists, and it keeps the output
const directEntry = Object.entries(scripts).find(([, v]) => String(v).includes('score_discovery_gap.mjs'));
if (!directEntry) fail(`${SCRIPT} has no npm script invoking it - orphaned generator, its output ages into fiction while looking live.`);

// Which npm scripts reach the scorer, directly or one level of composition away.
const reaching = new Set(Object.entries(scripts).filter(([, v]) => String(v).includes('score_discovery_gap.mjs')).map(([k]) => k));
for (const [name, body] of Object.entries(scripts)) {
  for (const r of [...reaching]) {
    if (new RegExp(`npm run ${r}\\b`).test(String(body))) reaching.add(name);
  }
}

const WF_DIR = '.github/workflows';
const workflows = fs.existsSync(WF_DIR) ? fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)) : [];
if (!workflows.length) fail(`${WF_DIR} holds no workflows - refusing to conclude anything about invocation from an empty directory.`);

const invoking = [];
for (const f of workflows) {
  const text = fs.readFileSync(`${WF_DIR}/${f}`, 'utf8');
  const hit = text.includes('score_discovery_gap.mjs')
    || [...reaching].some((r) => new RegExp(`npm run ${r}\\b`).test(text));
  if (hit) invoking.push({ file: f, text });
}
if (!invoking.length) {
  fail(`no workflow invokes the discovery-gap scorer, directly or through ${[...reaching].join('/')}. A generator only a human ever runs is an orphan.`);
}

// The point of the guard: a workflow that runs it must also commit what it wrote.
const writes = (src.match(/^const\s+TARGETS\s*=\s*'([^']+)'/m) || [])[1] || TARGETS;
const writesDir = writes.split('/').slice(0, 2).join('/');
for (const { file, text } of invoking) {
  const addLines = text.split('\n').filter((l) => l.includes('git add'));
  if (!addLines.length) continue; // a workflow that commits nothing at all discards nothing new
  if (!addLines.some((l) => l.includes(writesDir))) {
    fail(`${WF_DIR}/${file} runs the discovery-gap scorer but its commit set does not include ${writesDir}, so the score it writes to ${writes} is discarded at the end of every job.`);
  }
}

// Its own guard must be registered, or this file is itself an orphan.
if (!Object.values(scripts).some((v) => String(v).includes('validate_discovery_gap.js'))) {
  fail('validate_discovery_gap.js has no npm script - an unregistered validator is the same defect it is hunting.');
}
const registry = readJson('_repo_validation_registry.json');
const matrix = readJson('_repo_validation_matrix.json');
const entry = ((registry && registry.checks) || []).find((c) => c.entrypoint === '_ops/validators/validate_discovery_gap.js');
if (!entry) fail('validate_discovery_gap.js is not in _repo_validation_registry.json, so the matrix will never run it.');
else {
  for (const profile of ['all', 'ingestion', 'deep-autonomy']) {
    const p = matrix && matrix.profiles && matrix.profiles[profile];
    if (!p) { fail(`validation matrix has no "${profile}" profile to register the discovery-gap check into.`); continue; }
    if (!p.checks.includes(entry.id)) fail(`check "${entry.id}" is missing from the "${profile}" validation profile.`);
  }
}

// -------------------------------------- (2) the rolling window cannot destroy
if (!/stale_reason/.test(src) || !/stale:\s*true/.test(src)) {
  fail(`${SCRIPT} no longer carries an aged reading forward as stale. A target whose observation rolled out of the 25-query window would be overwritten with UNMEASURED, destroying the only openness reading this repo has.`);
}
if (!/function occupancyFor\(query,\s*byQuery,\s*prior\)/.test(src)
    || !/=\s*occupancyFor\([^)]+,[^)]+,\s*[\w.$]+\.occupancy\s*\)/.test(src)) {
  fail(`${SCRIPT} no longer passes a prior occupancy into occupancyFor, so there is nothing to carry forward and the destructive overwrite is back.`);
}

// ------------------------------------------------------ (3) the blue-ocean gate
if (!/blueOceanEligibility/.test(gateSrc) || !/BRAND_OR_PERSON_NAME_NAVIGATIONAL/.test(gateSrc) || !/NO_SERVICE_OR_LOCATION_ANCHOR/.test(gateSrc)) {
  fail(`${GATE} has lost the blue-ocean gate. Openness would again be read as open ground with no check that the citations describe this practice's competitive ground.`);
}
if (!/blue_ocean_eligible/.test(src)) {
  fail(`${SCRIPT} no longer writes blue_ocean_eligible, so nothing distinguishes open ground from an unanchored citation set.`);
}

// -------------------------------------------------------- the data, not the code
const doc = readJson(TARGETS);
const rows = doc && Array.isArray(doc.queries) ? doc.queries : (Array.isArray(doc) ? doc : []);
if (!rows.length) fail(`${TARGETS} holds zero targets - this validator examined nothing and must not pass on an empty loop.`);

let examined = 0;
let gated = 0;
let refused = 0;
let carried = 0;
for (const row of rows) {
  const q = row && row.query;
  if (!q) { fail('target with no query string'); continue; }
  if (!row.occupancy) { fail(`target has no occupancy reading: ${q}`); continue; }
  examined++;
  const score = row.occupancy.openness_score;
  const hasScore = score !== null && score !== undefined;
  // An UNMEASURED verdict carrying a score would read as a zero - the exact
  // misreading the UNMEASURED verdict exists to prevent.
  if (row.occupancy.verdict === 'UNMEASURED' && hasScore) {
    fail(`UNMEASURED target carries an openness_score, which reads as a zero: ${q}`);
  }
  if (row.occupancy.stale === true) {
    carried++;
    if (!row.occupancy.stale_reason) fail(`target is marked stale with no stale_reason: ${q}`);
    if (!hasScore) fail(`target is marked stale but carries no reading, so nothing was actually carried forward: ${q}`);
  }
  const gate = row.blue_ocean_eligible;
  if (!gate || typeof gate.eligible !== 'boolean') {
    fail(`target carries an occupancy verdict with no blue_ocean_eligible gate, so "not cited" can be read as "open ground": ${q}`);
    continue;
  }
  gated++;
  if (!gate.reason) fail(`blue_ocean_eligible with no reason: ${q}`);
  if (!gate.eligible) refused++;
  // The specific false signal that started this: a surname-matched navigational
  // query must never be eligible, whatever the observer cited for it.
  if (/\bhicks\b/.test(String(q).toLowerCase()) && gate.eligible) {
    fail(`surname-matched navigational query passed the blue-ocean gate: "${q}". The observer returns Hickory/Hicksville and unrelated Hicks practitioners for these; an OPEN verdict on them is noise, not open ground.`);
  }
}

if (examined === 0) fail('examined zero targets - refusing to pass on an empty loop.');
if (gated !== examined) fail(`${examined - gated} of ${examined} targets are not gated.`);
// The gate must be doing work. A corpus that demonstrably contains surname
// queries but produces zero refusals means the gate was widened into a no-op.
const surname = rows.filter((r) => /\bhicks\b/.test(String(r.query || '').toLowerCase()));
if (surname.length && refused === 0) {
  fail(`${surname.length} surname-matched queries present (e.g. "${surname[0].query}") yet the blue-ocean gate refused none - the gate has been widened into a no-op.`);
}

// ------------------------------------- (4) no "near me" query is left ungoverned
//
// A query that implies a place and names none cannot be answered as typed, so
// each one needs a recorded decision: either a localized variant that a Memphis
// searcher and a location-aware answer engine actually resolve to, or an
// explicit decision that no page will ever target it.
//
// Ten were measured. Eight got localized variants; "trauma center near me" and
// "mental health diagnosis near me" got neither and sat in the file for weeks
// with primaryPage "/" - present, counted, and decided about by nobody. An
// undecided row is indistinguishable from a forgotten one, which is how a page
// gets written later for a service this practice does not provide.
//
// So: every bare "near me" target is under one of the two rules, and a decision
// not to target must actually bind. blueOceanEligibility is what content
// generation reads, so the refusal is asserted through that function rather than
// trusted to a note.
// Same set as IMPLIES_LOCATION in scripts/queries/score_discovery_gap.mjs. The
// two lists must not drift: a phrase the scorer quarantines but this validator
// does not look at is a governed row nothing checks, and a phrase this validator
// demands governance for but the scorer never quarantines blocks main with no
// automated way to reach a green state.
const IMPLIES_A_PLACE = /\b(near me|nearby|near by|open now|around here|close to me)\b/i;
const localizedFor = new Set(rows.filter((r) => r && r.intent === 'localized_variant' && r.localizes).map((r) => String(r.localizes).toLowerCase()));
const bare = rows.filter((r) => r && r.query && IMPLIES_A_PLACE.test(r.query) && r.intent !== 'localized_variant');

const TODAY = new Date().toISOString().slice(0, 10);
let governed = 0;
let notTargeted = 0;
let awaiting = 0;
for (const row of bare) {
  const q = String(row.query);
  const targeting = row.targeting || null;
  if (targeting && targeting.targeted === false) {
    if (!String(targeting.why || '').trim()) fail(`"${q}" is marked as never to be targeted with no reason recorded.`);
    if (!String(targeting.so_what_happens_instead || targeting.decision || '').trim()) fail(`"${q}" refuses a page without saying what happens to that searcher instead.`);
    if (row.blue_ocean_eligible && row.blue_ocean_eligible.eligible !== false) {
      fail(`"${q}" is marked as never to be targeted but is still blue-ocean eligible, so the drafting cycle will propose a page for it every run.`);
    }
    notTargeted++;
    governed++;
    continue;
  }
  if (localizedFor.has(q.toLowerCase())) { governed++; continue; }
  if (targeting && targeting.targeted === true && String(targeting.how || '').trim()) { governed++; continue; }

  // QUARANTINED, awaiting a decision. This is a LEGITIMATE STOP, not a failure,
  // and it is why this lane no longer pages anyone at 02:00 over a query the
  // pipeline invented for itself.
  //
  // data/agency/gsc_snapshot.json is refreshed with no human in the loop, and
  // score_discovery_gap.mjs merges every query in it into the target set. A
  // brand-new location-implying query therefore appears ungoverned through
  // nobody's fault. Failing on it is wrong - nothing is broken, a decision is
  // simply outstanding. Passing silently is also wrong - that is the "undecided
  // is indistinguishable from forgotten" defect this section exists to prevent.
  //
  // So: green, named on the console, drafting blocked, and a deadline. Past
  // decide_by it becomes a hard finding, because by then it HAS been forgotten.
  if (targeting && targeting.targeted === null && targeting.decision === 'AWAITING_TARGETING_DECISION') {
    const by = String(targeting.decide_by || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(by)) {
      fail(`"${q}" is quarantined awaiting a targeting decision with no usable decide_by date, so the quarantine has no deadline and would sit there for ever.`);
      continue;
    }
    if (!String(targeting.why || '').trim() || !String(targeting.how_to_decide || '').trim()) {
      fail(`"${q}" is quarantined awaiting a targeting decision without saying why it is held or how to decide it.`);
      continue;
    }
    if (!row.blue_ocean_eligible || row.blue_ocean_eligible.eligible !== false) {
      fail(`"${q}" is quarantined awaiting a targeting decision but is still blue-ocean eligible, so the drafting cycle can write a page for a query nobody has approved.`);
      continue;
    }
    if (by < TODAY) {
      fail(`"${q}" has been quarantined awaiting a targeting decision since ${targeting.first_seen || 'an unrecorded date'} and its decide_by date of ${by} has passed. Either add a localized_variant row that resolves it, or record targeting.targeted=false with a reason.`);
      continue;
    }
    stops.push(`"${q}" - measured, quarantined, not drafted against; decide by ${by}.`);
    awaiting++;
    governed++;
    continue;
  }

  fail(`"${q}" implies a location, names none, and carries neither a localized variant nor a recorded decision not to target it. Ungoverned: nobody can tell this apart from an oversight.`);
}
if (!bare.length) {
  fail('no bare "near me" targets found - this section examined nothing and must not pass on an empty loop.');
}

// The refusal has to bind in code, not only in data.
try {
  const { blueOceanEligibility } = require('../../scripts/lib/demand_titles.js');
  const probe = blueOceanEligibility({ query: 'trauma center near me', targeting: { targeted: false, why: 'fixture' }, occupancy: { verdict: 'OPEN' } });
  if (!probe || probe.eligible !== false) {
    fail('scripts/lib/demand_titles.js#blueOceanEligibility ignores targeting.targeted:false, so a recorded decision not to target a query does not actually stop content being drafted for it.');
  }
  const held = blueOceanEligibility({ query: 'therapist near me', targeting: { targeted: null, decision: 'AWAITING_TARGETING_DECISION', why: 'fixture' }, occupancy: { verdict: 'OPEN' } });
  if (!held || held.eligible !== false || held.reason !== 'AWAITING_TARGETING_DECISION') {
    fail('scripts/lib/demand_titles.js#blueOceanEligibility ignores targeting.targeted:null, so a query quarantined pending a targeting decision can still be drafted against - the quarantine would be a comment, not a control.');
  }
  const control = blueOceanEligibility({ query: 'therapist near me memphis', occupancy: { verdict: 'OPEN' } });
  if (!control || control.eligible !== true) {
    fail('blueOceanEligibility now refuses an ordinary anchored target - the non-target gate has been widened into a blanket refusal.');
  }
} catch (e) {
  fail(`could not exercise blueOceanEligibility: ${e.message}`);
}

// ---------------------------------------------------------------------- verdict
// The orchestrator distinguishes a validator that FOUND something from one that
// CRASHED, and it does that by looking for the finding marker. Reporting through
// console.error alone made a real, actionable finding here report as
// "Validator exited 1 without the registered finding protocol" - an execution
// hard fail - which reads as a broken validator and sends whoever is paged
// hunting for a missing dependency instead of at the four ungoverned queries the
// validator had correctly identified. The registry declares
// findingProtocol: VALIDATION_FINDING for this check; this is that declaration
// being true.
if (problems.length) {
  emitFinding(
    ['Discovery-gap contract FAILED:', ...problems.map((p) => `  - ${p}`)],
    { summary: `discovery-gap-defect(s)=${problems.length}` }
  );
  process.exit(1);
}

// Rule 0: a stop is only legitimate if it is named and someone can see it.
if (stops.length) {
  console.log(`NAMED STOP: ${stops.length} location-implying quer(y|ies) are quarantined awaiting a targeting decision. They are measured, they cannot be drafted against, and each carries a deadline:`);
  for (const stop of stops) console.log(`  - ${stop}`);
}
console.log(`Discovery-gap contract OK: ${examined} targets examined, all gated; ${refused} refused as navigational, unanchored or not-a-service-we-provide; ${carried} readings carried forward as stale rather than destroyed; ${governed}/${bare.length} location-implying "near me" targets governed (${notTargeted} recorded as never to be targeted, ${awaiting} quarantined awaiting a dated decision and provably undraftable, and the refusal proved binding through blueOceanEligibility); scorer invoked by ${invoking.map((i) => i.file).join(', ')} and its output committed.`);
