#!/usr/bin/env node
// target_query_set.json from MEASURED demand only: one target per Search Console
// query in gsc_truth.json, carrying its source and its 28-day number. A query
// with no positive number is dropped and listed, never kept with a null.
// Nothing here is invented, phrased or guessed: the client decides what the site
// says; this file only records what people searched for and saw it for.
import { SI_DIR, readJson, writeJson } from './lib/gsc_client.mjs';

const truth = readJson(`${SI_DIR}/gsc_truth.json`);
if (!truth || !Array.isArray(truth.rows) || !truth.rows.length) {
  console.error(`search-targets: ${SI_DIR}/gsc_truth.json has no rows; refusing to write an empty target set.`);
  process.exit(1);
}
const round = (n) => Math.round(n * 100) / 100;
const byQuery = new Map();
for (const r of truth.rows) {
  const t = byQuery.get(r.query) || { query: r.query, impressions: 0, clicks: 0, wpos: 0, pages: new Map() };
  t.impressions += r.impressions; t.clicks += r.clicks; t.wpos += r.position * r.impressions;
  t.pages.set(r.page, (t.pages.get(r.page) || 0) + r.impressions);
  byQuery.set(r.query, t);
}
const dropped = [];
const targets = [];
for (const t of byQuery.values()) {
  if (!(t.impressions > 0)) { dropped.push({ query: t.query, source: 'gsc_truth', reason: 'zero impressions in the window' }); continue; }
  const pages = [...t.pages.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  targets.push({
    query: t.query,
    source: 'gsc_truth',
    measurement: { metric: 'impressions_28d', value: t.impressions, window: `${truth.window.start_date}..${truth.window.end_date}`, collected_at: truth.collected_at },
    impressions: t.impressions,
    clicks: t.clicks,
    position: round(t.wpos / t.impressions),
    landing_page: pages[0][0],
    pages: pages.map(([page, impressions]) => ({ page, impressions }))
  });
}
targets.sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
writeJson(`${SI_DIR}/target_query_set.json`, {
  schema_version: '1.0',
  generated_from: `${SI_DIR}/gsc_truth.json`,
  property: truth.property,
  window: truth.window,
  truth_collected_at: truth.collected_at,
  measurement_rule: 'Every target is a Search Console query row (source gsc_truth) with a positive 28-day impression count. Nothing unmeasured is admitted.',
  target_count: targets.length,
  impressions_total: targets.reduce((a, t) => a + t.impressions, 0),
  dropped_count: dropped.length,
  dropped,
  targets
});
console.log(`search-targets: ${targets.length} measured targets (${targets.reduce((a, t) => a + t.impressions, 0)} impressions), ${dropped.length} dropped.`);
