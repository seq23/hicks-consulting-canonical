#!/usr/bin/env node
// demand_families.json: every measured target grouped into a family by the page
// Google shows for it (the target's landing page), ranked by impressions.
//
// RULE (impressions-weighted): a family QUALIFIES when its 28-day impressions are
//   >= max(MIN_IMPRESSIONS, MIN_SHARE of all measured impressions) and its
//   impressions-weighted position is <= MAX_POSITION; at most TOP_N qualify, in
//   impression order.
//
// This is a CLIENT site: the client decides content. A qualifying family is
// therefore recorded with status "proposal" and a one-line proposed change, and
// nothing is strengthened until it is approved in this file: status "approved"
// with approved_by, approved_at and approval_note (a later run keeps all four).
// Approval comes from the client or, as on 11 Oct 2026, from the site owner on
// her own decision, and approved_by says which; strengthening_ledger.json records
// each approved change when it ships.
import { SI_DIR, readJson, writeJson } from './lib/gsc_client.mjs';

const MIN_IMPRESSIONS = 20;
const MIN_SHARE = 0.02;
const MAX_POSITION = 40;
const TOP_N = 12;
const OUT = `${SI_DIR}/demand_families.json`;
const LEDGER = `${SI_DIR}/strengthening_ledger.json`;

const set = readJson(`${SI_DIR}/target_query_set.json`);
if (!set || !set.targets?.length) { console.error('demand-families: target_query_set.json has no targets; refusing to write empty families.'); process.exit(1); }
const prev = readJson(OUT, { families: [] });
const prevStatus = new Map((prev.families || []).filter((f) => f.status && !['proposal', 'measured_only'].includes(f.status)).map((f) => [f.family, f]));
const round = (n) => Math.round(n * 10) / 10;
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };

const groups = new Map();
for (const t of set.targets) {
  const id = pathOf(t.landing_page);
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(t);
}
const total = set.impressions_total;
const floor = Math.max(MIN_IMPRESSIONS, Math.ceil(total * MIN_SHARE));
const families = [...groups.entries()].map(([page, qs]) => {
  const impressions = qs.reduce((a, q) => a + q.impressions, 0);
  const clicks = qs.reduce((a, q) => a + q.clicks, 0);
  const wpos = round(qs.reduce((a, q) => a + q.position * q.impressions, 0) / impressions);
  const head = qs[0];
  return {
    family: page, page: qs[0].landing_page, impressions, clicks, ctr: Math.round((clicks / impressions) * 1000) / 10,
    weighted_position: wpos, query_count: qs.length, head_query: head.query,
    queries: qs.map((q) => ({ query: q.query, impressions: q.impressions, clicks: q.clicks, position: q.position }))
  };
}).sort((a, b) => b.impressions - a.impressions || a.family.localeCompare(b.family));

let qualified = 0;
for (const [i, f] of families.entries()) {
  f.rank = i + 1;
  const passes = f.impressions >= floor && f.weighted_position <= MAX_POSITION && qualified < TOP_N;
  if (passes) {
    qualified += 1;
    f.qualifies = true;
    const kept = prevStatus.get(f.family);
    f.status = kept ? kept.status : 'proposal';
    if (kept?.approved_by) f.approved_by = kept.approved_by;
    if (kept?.approved_at) f.approved_at = kept.approved_at;
    if (kept?.approval_note) f.approval_note = kept.approval_note;
    const others = f.queries.slice(1, 3).map((q) => `"${q.query}"`).join(', ');
    f.proposed_change = f.weighted_position <= 10
      ? `Lead ${f.family} with a direct answer to "${f.head_query}" in its title and first paragraph: ${f.impressions} impressions at position ${f.weighted_position} earned ${f.clicks} click(s) (${f.ctr}% CTR).`
      : `Add a section to ${f.family} that answers "${f.head_query}"${others ? ` and ${others}` : ''}: ${f.impressions} impressions at position ${f.weighted_position}, below page one.`;
  } else {
    f.qualifies = false;
    f.status = 'measured_only';
    f.why_not = f.impressions < floor ? `${f.impressions} impressions < floor ${floor}` : f.weighted_position > MAX_POSITION ? `weighted position ${f.weighted_position} > ${MAX_POSITION}` : `outside the top ${TOP_N}`;
  }
}

writeJson(OUT, {
  schema_version: '1.0',
  generated_from: `${SI_DIR}/target_query_set.json`,
  window: set.window,
  truth_collected_at: set.truth_collected_at,
  rule: { grouping: 'one family per landing page (the page Google shows for the query)', min_impressions: MIN_IMPRESSIONS, min_share: MIN_SHARE, floor_this_window: floor, max_weighted_position: MAX_POSITION, top_n: TOP_N },
  client_approval: 'Client site: qualifying families are PROPOSALS. A family is strengthened only once its status is "approved" here, with approved_by naming who decided (the client, or the site owner on her own decision) and approved_at.',
  target_count: set.target_count,
  impressions_total: total,
  family_count: families.length,
  proposal_count: families.filter((f) => f.status === 'proposal').length,
  approved_count: families.filter((f) => f.status === 'approved').length,
  families
});

const approved = families.filter((f) => f.status === 'approved');
const ledger = readJson(LEDGER, null);
writeJson(LEDGER, {
  schema_version: '1.0',
  entries: ledger?.entries || [],
  reason: approved.length
    ? `${approved.length} family(ies) approved in demand_families.json (approved_by names who decided); each approved change is recorded here when it ships.`
    : 'Empty by design: hicksconsulting.org is a client site and the client decides content. Qualifying families are recorded as proposals in demand_families.json; nothing is strengthened until the client approves one there.',
  approved_families: approved.map((f) => f.family)
});
console.log(`demand-families: ${families.length} families from ${set.target_count} targets (${total} impressions); floor ${floor}; ${qualified} proposal(s): ${families.filter((f) => f.qualifies).slice(0, 3).map((f) => `${f.family} (${f.impressions})`).join(', ')}.`);
