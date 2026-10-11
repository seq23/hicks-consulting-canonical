#!/usr/bin/env node
// Daily: record what Search Console holds for sitemaps (sitemaps.list) into
// data/search_intelligence/gsc_sitemaps.json, and submit the www sitemap only
// when the property does not list it. The stale non-www entry
// (http(s)://hicksconsulting.org/sitemap.xml) is recorded, never deleted: removing
// a property entry is the client's call.
import { PROPERTY, SI_DIR, SITE_ORIGIN, READWRITE, serviceAccount, accessToken, api, writeJson, ownerStep, GscError } from './lib/gsc_client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/gsc_client.mjs';

const OUT = `${SI_DIR}/gsc_sitemaps.json`;
const SITEMAP = `${SITE_ORIGIN}/sitemap.xml`;
const listed = (resp) => (resp?.sitemap || []).some((s) => s.path === SITEMAP);

async function main() {
  const sa = serviceAccount();
  const base = { schema_version: '1.0', property: PROPERTY, collected_at: new Date().toISOString(), sitemap_url: SITEMAP };
  if (!sa) {
    console.log('NAMED STOP gsc-sitemaps: GSC_SERVICE_ACCOUNT_JSON is not set in this environment.');
    if (!fs.existsSync(path.join(ROOT, OUT))) writeJson(OUT, { ...base, state: 'NAMED_STOP', named_stop: 'GSC_SERVICE_ACCOUNT_JSON not set' });
    return 0;
  }
  let before; let after; let submitted = false;
  try {
    const ro = api(await accessToken(sa));
    before = await ro.listSitemaps();
    after = before;
    if (!listed(before)) {
      await api(await accessToken(sa, READWRITE)).submitSitemap(SITEMAP);
      submitted = true;
      after = await ro.listSitemaps();
    }
  } catch (err) {
    if (!(err instanceof GscError) || !err.hold) throw err;
    const stop = `NAMED STOP gsc-sitemaps: Search Console ${err.hold} (${err.message.slice(0, 160)}). ${ownerStep(sa)}`;
    console.log(stop);
    writeJson(OUT, { ...base, state: 'NAMED_STOP', named_stop: stop });
    return 0;
  }
  const entries = (after.sitemap || []).map((s) => ({
    path: s.path, lastSubmitted: s.lastSubmitted || null, lastDownloaded: s.lastDownloaded || null, isPending: !!s.isPending,
    errors: Number(s.errors || 0), warnings: Number(s.warnings || 0), contents: s.contents || [],
    role: s.path === SITEMAP ? 'canonical_www' : 'other_recorded_not_deleted'
  }));
  const state = listed(after) ? 'REGISTERED' : 'NOT_LISTED';
  writeJson(OUT, { ...base, state, submitted_this_run: submitted, listed_before: listed(before), listed_after: listed(after),
    note: 'Entries other than the www sitemap are recorded only; deleting a Search Console sitemap entry is the client\'s decision.', sitemaps: entries });
  const www = entries.find((e) => e.path === SITEMAP) || {};
  console.log(`gsc-sitemaps ${state}: ${entries.length} entr(ies); www listed before=${listed(before)} submitted=${submitted}; lastDownloaded=${www.lastDownloaded} errors=${www.errors} warnings=${www.warnings}; others: ${entries.filter((e) => e.path !== SITEMAP).map((e) => e.path).join(', ') || 'none'}`);
  if (state !== 'REGISTERED') { console.error(`gsc-sitemaps: ${SITEMAP} submitted and still not listed on ${PROPERTY}.`); return 1; }
  return 0;
}

main().then((code) => process.exit(code), (err) => { console.error(`gsc-sitemaps failed: ${err.stack || err}`); process.exit(1); });
