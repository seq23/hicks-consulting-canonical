'use strict';
/**
 * MEASURED URL 404 CONTRACT
 *
 * Every URL Search Console measured for hicksconsulting.org (the pages in
 * gsc_truth.json and in the target set) must resolve to something this repo
 * ships: a sitemap page, a page source under pages/ (deliberately noindexed
 * pages included), a static file, or a _redirects rule whose target ships.
 * A measured URL that 404s throws its impressions away; the fix is a 301 to the
 * live page on the same topic (see validate_redirect_targets.js).
 *
 * Offline and deterministic: the check reads the repo, not the network.
 * Hard-fails if it examines zero measured URLs.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const ROOT = process.cwd();
const DIR = 'data/search_intelligence';
const HOSTS = new Set(['hicksconsulting.org', 'www.hicksconsulting.org']);
const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return null; } };

const truth = readJson(`${DIR}/gsc_truth.json`);
const set = readJson(`${DIR}/target_query_set.json`);
if (!truth) fail(`MEASURED URL 404: ${DIR}/gsc_truth.json is missing or invalid, so no measured URL can be checked.`);
const measured = new Map();
const note = (url, impressions, from) => {
  if (!url) return;
  const m = measured.get(url) || { impressions: 0, from: new Set() };
  m.impressions += Number(impressions || 0); m.from.add(from); measured.set(url, m);
};
for (const r of truth.rows || []) note(r.page, r.impressions, 'gsc_truth');
for (const t of (set && set.targets) || []) for (const p of t.pages || []) note(p.page, 0, 'target_query_set');
if (!measured.size) fail('MEASURED URL 404: 0 measured URLs in gsc_truth.json and target_query_set.json. This check examined nothing.');

const sitemap = new Set([...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]));
const redirects = new Map();
for (const raw of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [from, to] = line.split(/\s+/);
  if (from && to) redirects.set(from, to);
}
const pageSource = (p) => fs.existsSync(path.join(ROOT, 'pages', p.replace(/^\/|\/$/g, ''), 'index.html'));
const staticFile = (p) => !p.endsWith('/') && [ROOT, path.join(ROOT, 'pages')].some((base) => {
  const f = path.join(base, p.replace(/^\//, ''));
  return f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile();
});
// Cloudflare Pages serves /x and /x/ for the same page, so both spellings count.
const ships = (p) => p === '/' || [p, p.endsWith('/') ? p.slice(0, -1) : `${p}/`].some((v) => sitemap.has(v) || (v.endsWith('/') && pageSource(v))) || staticFile(p);
function resolves(p, depth = 0) {
  if (ships(p)) return true;
  const to = redirects.get(p) || redirects.get(p.endsWith('/') ? p.slice(0, -1) : `${p}/`);
  if (!to || depth > 3) return false;
  if (/^https?:\/\//.test(to)) return true; // off-site target, not ours to resolve
  return resolves(to.split(/[?#]/)[0], depth + 1);
}

const failures = [];
for (const [url, m] of measured) {
  let u;
  try { u = new URL(url); } catch { failures.push(`${url}: not a URL.`); continue; }
  if (!HOSTS.has(u.hostname)) { failures.push(`${url}: host ${u.hostname} is not hicksconsulting.org.`); continue; }
  const p = decodeURIComponent(u.pathname);
  if (!resolves(p)) failures.push(`${url} (${m.impressions} impressions, from ${[...m.from].join('+')}): no sitemap page, page source, static file or redirect serves ${p}; it 404s. Add a 301 to the live page on the same topic.`);
}
if (failures.length) fail([`Measured URL 404 contract: ${measured.size} measured URL(s) examined.`, ...failures]);
console.log(`Measured URL 404 contract OK (${measured.size} measured URLs from Search Console, every one served by a page, static file or redirect).`);
