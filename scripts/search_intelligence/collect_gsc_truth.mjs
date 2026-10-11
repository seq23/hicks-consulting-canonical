#!/usr/bin/env node
// Daily: rolling 28-day Search Console query x page rows into
// data/search_intelligence/gsc_truth.json, plus one per-query entry per window
// in gsc_query_history.json, so week-on-week movement is read from committed
// files instead of a one-off pull (W41, 11 Oct 2026: the RED-week diagnosis had
// to be rebuilt from scratch because nothing kept the query history).
//
// Window: 28 days ending 3 days ago (Search Console's data lag).
// Outcomes, one line each, never a silent zero:
//   - no credential: NAMED STOP, exit 0, existing file left untouched (a
//     secretless run never blanks evidence);
//   - 401/403 or quota: NAMED STOP recorded in the file with the owner step, exit 0;
//   - Search Console answers with 0 rows: exit 1 (a property with 300 weekly
//     impressions returning nothing is a defect, not a quiet week).
import { PROPERTY, SI_DIR, serviceAccount, accessToken, api, readJson, writeJson, ownerStep, GscError } from './lib/gsc_client.mjs';

const OUT = `${SI_DIR}/gsc_truth.json`;
const HISTORY = `${SI_DIR}/gsc_query_history.json`;
const HISTORY_KEEP = 120; // daily windows kept
const day = (d) => d.toISOString().slice(0, 10);
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

async function allRows(svc, base) {
  const rows = [];
  for (let startRow = 0; ; startRow += 25000) {
    const res = await svc.searchAnalytics({ ...base, rowLimit: 25000, startRow });
    const batch = res.rows || [];
    rows.push(...batch);
    if (batch.length < 25000) return rows;
  }
}

async function main() {
  const sa = serviceAccount();
  if (!sa) {
    console.log('NAMED STOP gsc-truth: GSC_SERVICE_ACCOUNT_JSON is not set in this environment; the daily Agency SEO Monitor supplies it from repository secrets. Existing file left untouched.');
    return 0;
  }
  const end = new Date(Date.now() - 3 * 864e5);
  const start = new Date(end.getTime() - 27 * 864e5);
  const window = { start_date: day(start), end_date: day(end), days: 28 };
  const collected_at = new Date().toISOString();
  let totals; let rows;
  try {
    const svc = api(await accessToken(sa));
    const base = { startDate: window.start_date, endDate: window.end_date, type: 'web' };
    totals = (await svc.searchAnalytics(base)).rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    rows = await allRows(svc, { ...base, dimensions: ['query', 'page'] });
  } catch (err) {
    if (!(err instanceof GscError) || !err.hold) throw err;
    const stop = `NAMED STOP gsc-truth: Search Console ${err.hold} (${err.message.slice(0, 160)}). ${err.hold === 'HELD_CREDENTIAL' ? ownerStep(sa) : 'Quota resets daily.'}`;
    console.log(stop);
    const prev = readJson(OUT, {});
    writeJson(OUT, { ...prev, schema_version: '1.0', property: PROPERTY, collected_at, state: 'NAMED_STOP', named_stop: stop });
    return 0;
  }
  if (!rows.length) {
    console.error(`gsc-truth: Search Console returned 0 query x page rows for ${PROPERTY} ${window.start_date}..${window.end_date} (property total ${totals.impressions} impressions). Refusing to write an empty truth.`);
    return 1;
  }
  const out = rows.map((r) => ({
    query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr, 4), position: round(r.position)
  })).sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query) || a.page.localeCompare(b.page));
  const attributed = out.reduce((a, r) => a + r.impressions, 0);
  const doc = {
    schema_version: '1.0',
    truth_source: 'google_search_console_search_analytics',
    property: PROPERTY,
    collected_at,
    state: 'OK',
    named_stop: null,
    window,
    totals: { clicks: totals.clicks, impressions: totals.impressions, ctr: round(totals.ctr, 4), position: round(totals.position) },
    row_count: out.length,
    query_count: new Set(out.map((r) => r.query)).size,
    page_count: new Set(out.map((r) => r.page)).size,
    attributed_impressions: attributed,
    truth_boundary: 'Rows are query x page for the window. Search Console withholds anonymised queries from query rows, so attributed_impressions is below totals.impressions; the property total is the headline number.',
    rows: out
  };
  writeJson(OUT, doc);

  // History: one entry per window end date, per-query totals across pages.
  const byQuery = {};
  for (const r of out) {
    const q = (byQuery[r.query] ||= { impressions: 0, clicks: 0, wpos: 0 });
    q.impressions += r.impressions; q.clicks += r.clicks; q.wpos += r.position * r.impressions;
  }
  const queries = Object.fromEntries(Object.entries(byQuery).sort((a, b) => b[1].impressions - a[1].impressions || a[0].localeCompare(b[0]))
    .map(([q, v]) => [q, { impressions: v.impressions, clicks: v.clicks, position: round(v.wpos / v.impressions) }]));
  const hist = readJson(HISTORY, { schema_version: '1.0', property: PROPERTY, windows: [] });
  const windows = (hist.windows || []).filter((w) => w.end_date !== window.end_date);
  windows.push({ ...window, collected_at, totals: doc.totals, queries });
  windows.sort((a, b) => a.end_date.localeCompare(b.end_date));
  writeJson(HISTORY, { schema_version: '1.0', property: PROPERTY, keep: HISTORY_KEEP, windows: windows.slice(-HISTORY_KEEP) });

  console.log(`gsc-truth OK: ${PROPERTY} ${window.start_date}..${window.end_date}: ${totals.impressions} impressions / ${totals.clicks} clicks; ${out.length} query x page rows (${doc.query_count} queries, ${doc.page_count} pages, ${attributed} attributed impressions); history ${Math.min(windows.length, HISTORY_KEEP)} window(s).`);
  return 0;
}

main().then((code) => process.exit(code), (err) => { console.error(`gsc-truth failed: ${err.stack || err}`); process.exit(1); });
