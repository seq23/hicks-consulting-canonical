#!/usr/bin/env node
// Daily: record what Search Console holds for sitemaps (sitemaps.list) into
// data/search_intelligence/gsc_sitemaps.json, and submit the www sitemap only
// when the property does not list it. Stale registrations (any http:// URL, or any
// sitemap on the apex hicksconsulting.org, which 301s to www since 11 Oct 2026)
// are deleted with sitemaps.delete: the site owner decided this on 11 Oct 2026
// (the client's Google Business Profile is untouched; this is the Search Console
// property only). Every deletion is kept in the file's deletions history, with
// the sitemaps.list taken before and after it.
import { PROPERTY, SI_DIR, SITE_ORIGIN, READWRITE, serviceAccount, accessToken, api, writeJson, ownerStep, GscError } from './lib/gsc_client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/gsc_client.mjs';

const OUT = `${SI_DIR}/gsc_sitemaps.json`;
const SITEMAP = `${SITE_ORIGIN}/sitemap.xml`;
const listed = (resp) => (resp?.sitemap || []).some((s) => s.path === SITEMAP);
export const STALE_RULE = 'http:// or apex (hicksconsulting.org) sitemap registrations are deleted; www https sitemap kept (owner decision 2026-10-11)';
export const isStale = (p) => p !== SITEMAP && (/^http:\/\//i.test(p) || /^https?:\/\/hicksconsulting\.org\//i.test(p));
const paths = (resp) => (resp?.sitemap || []).map((s) => s.path);

async function main() {
  const sa = serviceAccount();
  const base = { schema_version: '1.0', property: PROPERTY, collected_at: new Date().toISOString(), sitemap_url: SITEMAP };
  if (!sa) {
    console.log('NAMED STOP gsc-sitemaps: GSC_SERVICE_ACCOUNT_JSON is not set in this environment.');
    if (!fs.existsSync(path.join(ROOT, OUT))) writeJson(OUT, { ...base, state: 'NAMED_STOP', named_stop: 'GSC_SERVICE_ACCOUNT_JSON not set' });
    return 0;
  }
  let before; let after; let submitted = false; const deleted = [];
  try {
    const ro = api(await accessToken(sa));
    before = await ro.listSitemaps();
    after = before;
    const stale = paths(before).filter(isStale);
    if (!listed(before) || stale.length) {
      const rw = api(await accessToken(sa, READWRITE));
      if (!listed(before)) { await rw.submitSitemap(SITEMAP); submitted = true; }
      for (const p of stale) { await rw.deleteSitemap(p); deleted.push(p); console.log(`gsc-sitemaps: deleted stale registration ${p}`); }
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
    role: s.path === SITEMAP ? 'canonical_www' : (isStale(s.path) ? 'stale_still_listed' : 'other_recorded')
  }));
  const prior = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, OUT), 'utf8')); } catch { return {}; } })();
  const deletions = [...(prior.deletions || [])];
  if (deleted.length) deletions.push({ at: base.collected_at, deleted, list_before: paths(before), list_after: paths(after), decided_by: 'site owner, 2026-10-11 (not the client)' });
  const state = listed(after) ? 'REGISTERED' : 'NOT_LISTED';
  writeJson(OUT, { ...base, state, submitted_this_run: submitted, listed_before: listed(before), listed_after: listed(after),
    stale_rule: STALE_RULE, deleted_this_run: deleted, sitemaps: entries, deletions });
  const www = entries.find((e) => e.path === SITEMAP) || {};
  console.log(`gsc-sitemaps ${state}: ${entries.length} entr(ies); www listed before=${listed(before)} submitted=${submitted}; lastDownloaded=${www.lastDownloaded} errors=${www.errors} warnings=${www.warnings}; others: ${entries.filter((e) => e.path !== SITEMAP).map((e) => e.path).join(', ') || 'none'}`);
  const staleLeft = entries.filter((e) => isStale(e.path)).map((e) => e.path);
  if (staleLeft.length) { console.error(`gsc-sitemaps: stale registration(s) still listed after delete: ${staleLeft.join(', ')}`); return 1; }
  if (state !== 'REGISTERED') { console.error(`gsc-sitemaps: ${SITEMAP} submitted and still not listed on ${PROPERTY}.`); return 1; }
  return 0;
}

main().then((code) => process.exit(code), (err) => { console.error(`gsc-sitemaps failed: ${err.stack || err}`); process.exit(1); });
