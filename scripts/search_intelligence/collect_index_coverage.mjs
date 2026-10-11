#!/usr/bin/env node
// Daily: URL Inspection rotation over sitemap.xml into
// data/search_intelligence/index_coverage.json, with counts by coverageState.
//
// Up to PER_RUN_CAP URLs per run, oldest inspection first, WORKERS calls in
// parallel (one call takes ~6 s; serial would be ~15 min for the sitemap).
// URLs not reached this run keep their last result and its inspected_at.
// URL Inspection allows 2,000 calls a day per property; 150 leaves the rest free.
//
// Outcomes: no credential -> NAMED STOP, file untouched (written as
// NOT_INSPECTED rows only if none exists); 401/403/quota -> NAMED STOP recorded
// with the owner step, inspected rows kept; nothing inspected at all -> exit 1.
import { PROPERTY, SI_DIR, serviceAccount, accessToken, api, readJson, writeJson, sitemapUrls, ownerStep, GscError } from './lib/gsc_client.mjs';

const OUT = `${SI_DIR}/index_coverage.json`;
const PER_RUN_CAP = 150;
const WORKERS = 8;

function rowFrom(url, resp, at) {
  const r = resp?.inspectionResult?.indexStatusResult || {};
  return {
    url, verdict: r.verdict || null, coverageState: r.coverageState || 'UNKNOWN', lastCrawlTime: r.lastCrawlTime || null,
    indexingState: r.indexingState || null, robotsTxtState: r.robotsTxtState || null, pageFetchState: r.pageFetchState || null,
    googleCanonical: r.googleCanonical || null, userCanonical: r.userCanonical || null, inspected_at: at
  };
}

function write(urls, byUrl, state, namedStop, inspected) {
  const rows = urls.map((u) => byUrl.get(u) || { url: u, verdict: null, coverageState: 'NOT_INSPECTED', inspected_at: null });
  const count = (key) => rows.reduce((a, r) => ({ ...a, [r[key] || 'NONE']: (a[r[key] || 'NONE'] || 0) + 1 }), {});
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  const doc = {
    schema_version: '1.0',
    truth_source: 'google_search_console_url_inspection',
    property: PROPERTY,
    collected_at: new Date().toISOString(),
    state,
    named_stop: namedStop,
    sitemap_url_count: urls.length,
    inspected_this_run: inspected,
    rotation: { per_run_cap: PER_RUN_CAP, workers: WORKERS, order: 'oldest inspected_at first' },
    summary: { by_coverage_state: sorted(count('coverageState')), by_verdict: sorted(count('verdict')) },
    truth_boundary: 'Google index state per URL at inspected_at. Not a ranking or traffic measure; impressions are in gsc_truth.json.',
    urls: rows
  };
  writeJson(OUT, doc);
  console.log(`index-coverage ${state}: ${urls.length} sitemap URLs, ${inspected} inspected this run; by coverageState ${JSON.stringify(doc.summary.by_coverage_state)}`);
}

async function main() {
  const urls = sitemapUrls();
  if (!urls.length) { console.error('index-coverage: sitemap.xml lists 0 URLs; nothing to inspect is a failure.'); return 1; }
  const prev = readJson(OUT, null);
  const byUrl = new Map((prev?.urls || []).filter((r) => r.inspected_at).map((r) => [r.url, r]));
  const sa = serviceAccount();
  if (!sa) {
    console.log('NAMED STOP index-coverage: GSC_SERVICE_ACCOUNT_JSON is not set in this environment; the daily Agency SEO Monitor supplies it.');
    if (!prev) write(urls, byUrl, 'NAMED_STOP', 'GSC_SERVICE_ACCOUNT_JSON not set', 0);
    return 0;
  }
  const order = [...urls].sort((a, b) => (byUrl.get(a)?.inspected_at || '').localeCompare(byUrl.get(b)?.inspected_at || '') || a.localeCompare(b));
  const batch = order.slice(0, PER_RUN_CAP);
  let hold = null; const errors = []; let inspected = 0;
  let svc;
  try { svc = api(await accessToken(sa)); } catch (err) {
    if (!(err instanceof GscError) || !err.hold) throw err;
    hold = err;
  }
  let next = 0;
  async function worker() {
    while (!hold && next < batch.length) {
      const url = batch[next++];
      try {
        const resp = await svc.inspect(url);
        byUrl.set(url, rowFrom(url, resp, new Date().toISOString()));
        inspected += 1;
      } catch (err) {
        if (err instanceof GscError && err.hold) { hold = hold || err; return; }
        errors.push(`${url}: ${err.message.slice(0, 120)}`);
      }
    }
  }
  if (!hold) await Promise.all(Array.from({ length: WORKERS }, worker));
  if (hold) {
    const stop = `NAMED STOP index-coverage: URL Inspection ${hold.hold} (${hold.message.slice(0, 160)}). ${hold.hold === 'HELD_CREDENTIAL' ? ownerStep(sa) : 'Quota resets daily.'} ${inspected} URL(s) inspected this run are kept.`;
    console.log(stop);
    write(urls, byUrl, 'NAMED_STOP', stop, inspected);
    return 0;
  }
  if (!inspected) { console.error(`index-coverage: nothing inspected; first errors: ${errors.slice(0, 3).join(' | ')}`); return 1; }
  if (errors.length) console.log(`::warning title=URL inspection partial::${errors.length} URL(s) failed after retries: ${errors.slice(0, 5).join(' | ')}`);
  write(urls, byUrl, errors.length ? 'PARTIAL' : 'OK', null, inspected);
  return 0;
}

main().then((code) => process.exit(code), (err) => { console.error(`index-coverage failed: ${err.stack || err}`); process.exit(1); });
