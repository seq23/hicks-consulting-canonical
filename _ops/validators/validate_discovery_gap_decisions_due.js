#!/usr/bin/env node
/**
 * STRONG_WARNING, never blocks a release: reports every location-implying
 * "near me" query whose targeting decision is past its decide_by date.
 *
 * The quarantine itself is enforced by validate_discovery_gap.js (hard fail) and
 * by blueOceanEligibility, so an overdue row is still undraftable. What is late
 * is a decision, and a late SEO decision must stay visible without stopping the
 * Content Publish lane from releasing approved work. See
 * _ops/validation/discovery_gap_governance.js for the 2026-09-23 red that moved
 * lateness here.
 *
 * Resolve a finding by adding a localized_variant row in
 * data/search/target_queries.json whose "localizes" is the query and whose
 * primaryPage genuinely answers it, or by recording targeting.targeted=false with
 * "why" and "so_what_happens_instead" (blue_ocean_eligible follows on the next
 * `npm run queries:discovery-gap`).
 */
const fs = require('fs');
const { emitFinding, warn } = require('../validation/protocol');
const { localizedSet, bareTargets, classifyBareTarget } = require('../validation/discovery_gap_governance');

const TARGETS = 'data/search/target_queries.json';
let doc;
try {
  doc = JSON.parse(fs.readFileSync(TARGETS, 'utf8'));
} catch (e) {
  emitFinding(`unreadable ${TARGETS}: ${e.message}`, { summary: 'targets-unreadable' });
  process.exit(1);
}
const rows = Array.isArray(doc.queries) ? doc.queries : [];
const bare = bareTargets(rows);
if (!rows.length || !bare.length) {
  // Rule 0: examining nothing is not a pass.
  emitFinding(`${TARGETS} holds ${rows.length} target(s) and ${bare.length} bare location-implying one(s) - this check examined nothing.`, { summary: 'empty-surface' });
  process.exit(1);
}

const today = process.env.DISCOVERY_GAP_TODAY || new Date().toISOString().slice(0, 10);
const localizedFor = localizedSet(rows);
const due = [];
let awaiting = 0;
for (const row of bare) {
  const c = classifyBareTarget(row, localizedFor, today);
  if (c.state !== 'AWAITING') continue;
  awaiting++;
  if (c.overdue) due.push(`"${row.query}" has awaited a targeting decision since ${row.targeting.first_seen || 'an unrecorded date'}; decide_by ${c.decideBy} has passed. It stays undraftable. Add a localized_variant row that resolves it, or record targeting.targeted=false with a reason.`);
}

if (due.length) {
  warn(['Discovery-gap targeting decisions overdue (reported, not release-blocking):', ...due.map((d) => `  - ${d}`)], `overdue-targeting-decision(s)=${due.length}`);
} else {
  console.log(`Discovery-gap decisions due OK: ${bare.length} location-implying target(s) examined, ${awaiting} awaiting a decision, none past decide_by (${today}).`);
}
process.exit(0);
