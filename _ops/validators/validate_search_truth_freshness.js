'use strict';
/**
 * SEARCH TRUTH FRESHNESS
 *
 * data/search_intelligence/gsc_truth.json is collected daily by the Agency SEO
 * Monitor (search-truth job). This check proves the measurement half of the
 * search loop is alive and consistent:
 *   1. gsc_truth.json exists, was collected within MAX_AGE_HOURS, and either
 *      holds rows (state OK, property impressions > 0) or records a NAMED STOP;
 *   2. gsc_query_history.json holds at least one window, the latest matching truth;
 *   3. target_query_set.json is built from this truth, every target carries
 *      source gsc_truth and a positive number;
 *   4. demand_families.json accounts for every target impression, every
 *      qualifying family is a client proposal (or client-approved) with a
 *      one-line proposed change;
 *   5. strengthening_ledger.json is empty with a reason unless the client
 *      approved a family.
 * Hard-fails on zero rows or zero targets.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const ROOT = process.cwd();
const DIR = 'data/search_intelligence';
const MAX_AGE_HOURS = Number(process.env.SEARCH_TRUTH_MAX_AGE_HOURS || 96);
const now = Date.now();
const read = (rel) => {
  const full = path.join(ROOT, DIR, rel);
  if (!fs.existsSync(full)) fail(`SEARCH TRUTH: ${DIR}/${rel} is missing; the daily search-truth job has not produced it.`);
  try { return JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { fail(`SEARCH TRUTH: ${DIR}/${rel} is invalid JSON: ${e.message}`); }
  return null;
};
const failures = [];
const truth = read('gsc_truth.json');
const age = (now - Date.parse(truth.collected_at)) / 36e5;
if (!(age >= 0 && age <= MAX_AGE_HOURS)) failures.push(`gsc_truth.json collected_at ${truth.collected_at} is ${Number.isFinite(age) ? age.toFixed(1) : '?'}h old (> ${MAX_AGE_HOURS}h): the daily search-truth job has stopped.`);
if (truth.state === 'NAMED_STOP') {
  if (!String(truth.named_stop || '').startsWith('NAMED STOP')) failures.push('gsc_truth.json state NAMED_STOP carries no named_stop text.');
} else if (truth.state !== 'OK') failures.push(`gsc_truth.json state is ${truth.state}; expected OK or NAMED_STOP.`);
const rows = Array.isArray(truth.rows) ? truth.rows : [];
if (!rows.length) fail([`SEARCH TRUTH: gsc_truth.json holds 0 query x page rows. This check examined nothing.`, ...failures]);
if (truth.row_count !== rows.length) failures.push(`gsc_truth.json row_count ${truth.row_count} != ${rows.length} rows.`);
if (!(truth.totals?.impressions > 0)) failures.push('gsc_truth.json property total impressions is not positive.');
for (const r of rows) if (!r.query || !r.page || !(r.impressions > 0)) { failures.push(`gsc_truth.json has a malformed row: ${JSON.stringify(r).slice(0, 160)}`); break; }

const hist = read('gsc_query_history.json');
const last = (hist.windows || []).slice(-1)[0];
if (!last) failures.push('gsc_query_history.json has no windows.');
else if (last.end_date !== truth.window?.end_date) failures.push(`gsc_query_history.json latest window ends ${last.end_date}, truth ends ${truth.window?.end_date}.`);

const set = read('target_query_set.json');
const targets = Array.isArray(set.targets) ? set.targets : [];
if (!targets.length) failures.push('target_query_set.json holds 0 targets.');
if (set.window?.end_date !== truth.window?.end_date) failures.push(`target_query_set.json window ${set.window?.end_date} is not truth window ${truth.window?.end_date}; rebuild it from gsc_truth.json.`);
if (set.target_count !== targets.length) failures.push(`target_query_set.json target_count ${set.target_count} != ${targets.length}.`);
const unmeasured = targets.filter((t) => t.source !== 'gsc_truth' || !(Number(t.measurement?.value) > 0));
if (unmeasured.length) failures.push(`target_query_set.json has ${unmeasured.length} target(s) without source gsc_truth and a positive number, e.g. "${unmeasured[0].query}".`);
const truthQueries = new Set(rows.map((r) => r.query));
const invented = targets.filter((t) => !truthQueries.has(t.query));
if (invented.length) failures.push(`target_query_set.json has ${invented.length} target(s) that are not Search Console queries, e.g. "${invented[0].query}".`);

const fam = read('demand_families.json');
const families = Array.isArray(fam.families) ? fam.families : [];
const famImpr = families.reduce((a, f) => a + Number(f.impressions || 0), 0);
const targetImpr = targets.reduce((a, t) => a + Number(t.impressions || 0), 0);
if (famImpr !== targetImpr) failures.push(`demand_families.json accounts for ${famImpr} impressions; the targets hold ${targetImpr}.`);
for (const f of families.filter((x) => x.qualifies)) {
  if (!['proposal', 'approved'].includes(f.status)) failures.push(`family ${f.family} qualifies but has status ${f.status}; a client site records it as a proposal.`);
  if (!String(f.proposed_change || '').trim() || /\n/.test(f.proposed_change)) failures.push(`family ${f.family} qualifies but has no one-line proposed_change.`);
}
for (const f of families.filter((x) => !x.qualifies)) if (f.status !== 'measured_only') failures.push(`family ${f.family} does not qualify but has status ${f.status}.`);

const ledger = read('strengthening_ledger.json');
const approved = families.filter((f) => f.status === 'approved').length;
if (!Array.isArray(ledger.entries)) failures.push('strengthening_ledger.json has no entries array.');
else if (ledger.entries.length && !approved) failures.push(`strengthening_ledger.json records ${ledger.entries.length} strengthening(s) but the client approved no family; client sites change only on approval.`);
if (!String(ledger.reason || '').trim()) failures.push('strengthening_ledger.json carries no reason.');

if (failures.length) fail([`Search truth freshness: ${rows.length} rows, ${targets.length} targets, ${families.length} families examined.`, ...failures]);
console.log(`Search truth freshness OK (${truth.state}, collected ${age.toFixed(1)}h ago, ${truth.window.start_date}..${truth.window.end_date}: ${truth.totals.impressions} impressions, ${rows.length} rows; ${targets.length} measured targets; ${families.length} families, ${families.filter((f) => f.status === 'proposal').length} proposal(s), ${approved} approved; ledger ${ledger.entries.length} entr(ies)).`);
