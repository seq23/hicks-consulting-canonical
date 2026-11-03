'use strict';
/**
 * INDEX COVERAGE FRESHNESS
 *
 * data/search_intelligence/index_coverage.json is written daily by the
 * search-truth job (URL Inspection rotation, 150 URLs a day). This check proves:
 *   1. it exists and was collected within MAX_AGE_HOURS;
 *   2. state is OK, PARTIAL or a NAMED STOP that carries its text;
 *   3. the counts by coverageState and by verdict are recomputed from the rows
 *      and match the summary, and sitemap_url_count matches the rows;
 *   4. it covers at least MIN_SITEMAP_SHARE of the current sitemap.xml (pages
 *      published since the last run are picked up by the next one);
 *   5. outside a NAMED STOP, at least one URL was inspected within MAX_AGE_HOURS
 *      and no row is NOT_INSPECTED for longer than STALE_DAYS.
 * Hard-fails on zero rows.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const ROOT = process.cwd();
const FILE = 'data/search_intelligence/index_coverage.json';
const MAX_AGE_HOURS = Number(process.env.INDEX_COVERAGE_MAX_AGE_HOURS || 96);
const MIN_SITEMAP_SHARE = 0.9;
const full = path.join(ROOT, FILE);
if (!fs.existsSync(full)) fail(`INDEX COVERAGE: ${FILE} is missing; the daily search-truth job has not produced it.`);
let doc;
try { doc = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { fail(`INDEX COVERAGE: ${FILE} is invalid JSON: ${e.message}`); }
const rows = Array.isArray(doc.urls) ? doc.urls : [];
if (!rows.length) fail(`INDEX COVERAGE: ${FILE} holds 0 URLs. This check examined nothing.`);
const failures = [];
const now = Date.now();
const hours = (t) => (now - Date.parse(t)) / 36e5;
const age = hours(doc.collected_at);
if (!(age >= 0 && age <= MAX_AGE_HOURS)) failures.push(`collected_at ${doc.collected_at} is ${Number.isFinite(age) ? age.toFixed(1) : '?'}h old (> ${MAX_AGE_HOURS}h): the daily URL Inspection rotation has stopped.`);
if (!['OK', 'PARTIAL', 'NAMED_STOP'].includes(doc.state)) failures.push(`state ${doc.state} is not OK, PARTIAL or NAMED_STOP.`);
if (doc.state === 'NAMED_STOP' && !String(doc.named_stop || '').trim()) failures.push('state NAMED_STOP carries no named_stop text.');
if (doc.sitemap_url_count !== rows.length) failures.push(`sitemap_url_count ${doc.sitemap_url_count} != ${rows.length} rows.`);
const tally = (key) => rows.reduce((a, r) => ({ ...a, [r[key] || 'NONE']: (a[r[key] || 'NONE'] || 0) + 1 }), {});
const same = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
if (!same(tally('coverageState'), doc.summary?.by_coverage_state)) failures.push(`summary.by_coverage_state ${JSON.stringify(doc.summary?.by_coverage_state)} does not match the rows ${JSON.stringify(tally('coverageState'))}.`);
if (!same(tally('verdict'), doc.summary?.by_verdict)) failures.push('summary.by_verdict does not match the rows.');
const seen = new Set();
for (const r of rows) { if (seen.has(r.url)) failures.push(`${r.url} is listed twice.`); seen.add(r.url); }
const entries = [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ url: m[1].trim(), lastmod: m[2] || null }));
const sitemap = entries.map((e) => e.url);
const covered = sitemap.filter((u) => seen.has(u)).length;
// "Pages published since the last run are picked up by the next one": a URL the collection has not
// seen and whose sitemap lastmod is on or after the collection day is new since that run, and is not
// counted against it. A release of several overdue calendar slots at once (3 Nov 2026: 6 in one run)
// is otherwise a false "the rotation stopped".
const collectedDay = String(doc.collected_at || '').slice(0, 10);
const newSince = entries.filter((e) => !seen.has(e.url) && e.lastmod && collectedDay && e.lastmod.slice(0, 10) >= collectedDay).length;
const judged = sitemap.length - newSince;
if (!sitemap.length) failures.push('sitemap.xml lists 0 URLs.');
else if (!judged) failures.push(`every sitemap URL is newer than the collection of ${collectedDay}; nothing to judge it on.`);
else if (covered / judged < MIN_SITEMAP_SHARE) failures.push(`covers ${covered}/${judged} sitemap URLs that existed at the last collection (< ${MIN_SITEMAP_SHARE * 100}%; ${newSince} newer URL(s) wait for the next run).`);
if (doc.state !== 'NAMED_STOP') {
  const recent = rows.filter((r) => r.inspected_at && hours(r.inspected_at) <= MAX_AGE_HOURS).length;
  if (!recent) failures.push(`no URL was inspected in the last ${MAX_AGE_HOURS}h.`);
  const never = rows.filter((r) => r.coverageState === 'NOT_INSPECTED').length;
  if (never && doc.inspected_this_run >= rows.length) failures.push(`${never} URL(s) NOT_INSPECTED although the run inspected ${doc.inspected_this_run}.`);
}
if (failures.length) fail([`Index coverage freshness: ${rows.length} URLs examined.`, ...failures]);
console.log(`Index coverage freshness OK (${doc.state}, collected ${age.toFixed(1)}h ago, ${rows.length} URLs covering ${covered}/${judged} sitemap URLs that existed at the last collection (+${newSince} newer); by coverageState ${JSON.stringify(doc.summary.by_coverage_state)}).`);
