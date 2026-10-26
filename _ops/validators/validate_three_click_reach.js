'use strict';
/*
 * THREE-CLICK REACH CONTRACT
 *
 * Every URL in sitemap.xml must be reachable from the home page in at most
 * three clicks, following only the links the built pages actually carry.
 *
 * The owner's Search Readiness Checklist (item b7) failed hicksconsulting.org
 * on 25 Oct 2026 with eight orphans: the whole /llm-atlas/ family. Those eight
 * pages link to each other and to the home page - validate_llm_atlas_navigation
 * has proved that since the generator was guarded - but NOTHING on the site
 * linked INTO them. A ring of pages that only link to one another is still a
 * ring nothing can enter. They sat in sitemap.xml on no click path at all, so
 * Google crawled them last and ranked them lowest, if at all.
 *
 * The fix was one labelled link in the body of /resources/. This is the guard,
 * and it checks the property that matters - reachability - rather than the
 * presence of that one link, so any later navigation change that restores the
 * orphan state fails here instead of waiting a week for the live checklist.
 *
 * It walks dist/, not pages/: a link that only exists in a page source the
 * build prunes is not a click path. It is offline and deterministic.
 *
 * Rule 0: hard-fails if it reaches zero pages or the sitemap is empty.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const MAX_DEPTH = 3;

if (!fs.existsSync(DIST)) fail('THREE-CLICK REACH: dist/ does not exist. Run `npm run build` first; this check governs the built site.');

const norm = (route) => {
  let r = String(route || '').split('#')[0].split('?')[0];
  if (!r.startsWith('/')) return null;
  if (!r.endsWith('/') && !path.extname(r)) r += '/';
  return r;
};

const sitemapXml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const sitemap = [...sitemapXml.matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map((m) => norm(m[1])).filter(Boolean);
if (!sitemap.length) fail('THREE-CLICK REACH: sitemap.xml lists 0 URLs, so this check governs nothing.');

const fileFor = (route) => {
  const clean = route.replace(/^\//, '').replace(/\/$/, '');
  return clean ? path.join(DIST, clean, 'index.html') : path.join(DIST, 'index.html');
};

/** Every same-site route this page links to, from its rendered HTML. */
function linksOf(route) {
  const file = fileFor(route);
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, 'utf8');
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (/^(https?:)?\/\//i.test(href) || /^(mailto|tel|javascript):/i.test(href)) continue;
    const r = norm(href);
    if (r) out.add(r);
  }
  return [...out];
}

// Breadth-first from the home page, exactly as a crawler would.
const depth = new Map([['/', 0]]);
let frontier = ['/'];
for (let d = 1; d <= MAX_DEPTH && frontier.length; d += 1) {
  const next = [];
  for (const route of frontier) {
    for (const link of linksOf(route)) {
      if (depth.has(link)) continue;
      depth.set(link, d);
      next.push(link);
    }
  }
  frontier = next;
}

if (depth.size <= 1) fail('THREE-CLICK REACH: the home page yielded no internal links. This check examined nothing.');

const orphans = sitemap.filter((route) => !depth.has(route));
if (orphans.length) {
  fail([
    `THREE-CLICK REACH: ${orphans.length} of ${sitemap.length} sitemap URL(s) are not reachable from the home page within ${MAX_DEPTH} clicks.`,
    'A page in the sitemap that no page links to is a page Google crawls last and ranks lowest, if at all.',
    ...orphans.map((o) => `- ${o}`)
  ].join('\n'));
}

const deepest = Math.max(...sitemap.map((r) => depth.get(r)));
console.log(`Three-click reach OK (${sitemap.length} sitemap URLs, ${depth.size} routes reached from the home page, deepest sitemap URL at ${deepest} click(s)).`);
