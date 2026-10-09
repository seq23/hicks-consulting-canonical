#!/usr/bin/env node
'use strict';
/**
 * Repair the <title> and meta description of every published manifest page in
 * pages/, from the manifest and the page's own copy. Idempotent: a page that
 * already meets the contract is left byte-identical.
 *
 *   node scripts/search/apply_search_metadata.js          # write
 *   node scripts/search/apply_search_metadata.js --check  # report, exit 1 if anything would change
 *
 * The rules live in scripts/lib/search_metadata.js; the guard is
 * _ops/validators/validate_search_metadata_contract.js.
 */
const fs = require('fs');
const path = require('path');
const lib = require('../lib/search_metadata');

function applySearchMetadata({ manifest, check = false, allowUnresolved = false, releasing = [] } = {}) {
const root = process.cwd();
const CHECK = check;
manifest ||= JSON.parse(fs.readFileSync(path.join(root, 'data/admin/content_manifest.json'), 'utf8'));

const pageFile = (route) => path.join(root, 'pages', route.replace(/^\//, '').replace(/\/$/, ''), 'index.html');

const items = manifest
  .filter((e) => e && e.status === 'published' && e.validationPassed === true && typeof e.slug === 'string' && e.title)
  .map((e) => ({ route: e.publicPath || e.slug, title: e.title }))
  .filter((e) => fs.existsSync(pageFile(e.route)));

// Incumbents before newcomers. `releasing` names the routes this run is about
// to make public for the first time. Their queued legacy HTML is not public yet
// and is about to be rewritten, so it must not count against a page that is
// already live: on 8 Oct 2026 one released page of a templated series was
// declared "boilerplate" because 42 queued siblings carried the same legacy
// description, and the release lane refused to run at all. A live page is
// judged against the live site only; a newcomer is judged against everything
// settled before it and is held (a NAMED STOP in run_safe_publish) if it
// cannot be made distinct, never the other way round.
const releasingSet = new Set(releasing);
items.sort((a, b) => Number(releasingSet.has(a.route)) - Number(releasingSet.has(b.route)));

if (!items.length) {
  console.error('apply_search_metadata: 0 published manifest pages found under pages/. Nothing was examined.');
  throw new Error('Search metadata repair examined no published pages.');
}

// Every description on the public site, so a derived one cannot collide with a
// hand-authored page either.
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const sitemapRoutes = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
const descByRoute = new Map();
const titleByRoute = new Map();
const titleKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
for (const route of new Set([...sitemapRoutes, ...items.map((i) => i.route)])) {
  if (releasingSet.has(route)) continue;
  const file = pageFile(route);
  if (!fs.existsSync(file)) continue;
  const { description, title } = lib.readMeta(fs.readFileSync(file, 'utf8'));
  if (title) titleByRoute.set(route, titleKey(title));
  if (description) descByRoute.set(route, description);
}
const ownersOf = (desc) => [...descByRoute].filter(([, d]) => d === desc).map(([r]) => r);
const boilerplate = lib.boilerplateRuns(descByRoute);
const isBoilerplate = (desc) => [...lib.shinglesOf(desc)].some((sh) => boilerplate.has(sh));
// A new description may not become boilerplate either: none of its 8-word runs
// may already be held by BOILERPLATE_MAX_PAGES other pages.
function wouldBeBoilerplate(desc, route) {
  const runs = lib.shinglesOf(desc);
  let worst = 0;
  for (const run of runs) {
    let holders = 0;
    for (const [r, d] of descByRoute) if (r !== route && lib.shinglesOf(d).has(run)) holders += 1;
    worst = Math.max(worst, holders);
  }
  return worst >= lib.BOILERPLATE_MAX_PAGES;
}

let changed = 0;
const unresolved = [];
for (const item of items) {
  const file = pageFile(item.route);
  const html = fs.readFileSync(file, 'utf8');
  const meta = lib.readMeta(html);
  const title = lib.searchTitle(item.title);
  if (!title || [...titleByRoute].some(([route, value]) => route !== item.route && value === titleKey(title))) { unresolved.push(item.route); continue; }

  const current = meta.description || '';
  const newcomer = releasingSet.has(item.route);
  const usable = current && lib.finalWordIsWhole(current, html) && (newcomer
    // A newcomer's description is not in descByRoute yet: it may not equal a
    // settled one, nor push any 8-word run past the boilerplate limit.
    ? ownersOf(current).length === 0 && !wouldBeBoilerplate(current, item.route)
    : !isBoilerplate(current) && ownersOf(current).length === 1);
  let description = current;
  if (!(usable && lib.descriptionInRange(current) && lib.endsWhole(current))) {
    // An over-long but otherwise sound description is trimmed at a phrase
    // boundary first; a shared, templated or chopped one is never reused.
    const candidates = [...(usable ? [current] : []), ...lib.pagePassages(html)];
    const taken = new Set([...descByRoute].filter(([r]) => r !== item.route).map(([, d]) => d));
    description = null;
    for (let i = 0; i < candidates.length && !description; i += 1) {
      const fitted = lib.fitDescription(candidates.slice(i));
      if (fitted && !taken.has(fitted) && !isBoilerplate(fitted) && !wouldBeBoilerplate(fitted, item.route)) description = fitted;
    }
    if (!description) { unresolved.push(item.route); continue; }
  }
  descByRoute.set(item.route, description);

  titleByRoute.set(item.route, titleKey(title));
  const next = lib.writeMeta(html, { title, description });
  if (next !== html) {
    changed += 1;
    if (CHECK) console.log(`would change ${item.route}`);
    else fs.writeFileSync(file, next);
  }
}

if (unresolved.length) {
  console.error(`apply_search_metadata: could not give a compliant title and description to ${unresolved.length} page(s):\n  ${unresolved.join('\n  ')}`);
  if (!allowUnresolved) throw new Error('Search metadata repair has unresolved pages.');
}
console.log(`apply_search_metadata: ${items.length} published manifest page(s) examined, ${changed} ${CHECK ? 'would change' : 'rewritten'}.`);
return { examined: items.length, changed, unresolved };
}
module.exports = { applySearchMetadata };
if (require.main === module) {
  try {
    const result = applySearchMetadata({ check: process.argv.includes('--check') });
    if (process.argv.includes('--check') && result.changed) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
