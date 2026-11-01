#!/usr/bin/env node
// Search loop (seq23/search-loop) site view for this repo.
//
// The engine reads a site's pages from the repo root and turns each file path
// into its URL (about/index.html -> /about/). This site's page sources live
// under pages/, so read in place they would come out as /pages/about/ and
// every internal link the engine wrote would 404. The engine is shared and is
// not edited per site, so before a run this lays a read-only view of the
// PUBLISHED pages at the root, at the paths their URLs say. "Published" is
// exactly the built sitemap (scripts/site_build.js decides it from the
// manifest), so an approved-but-unreleased or revoked page is never linked.
//
// Every mirrored path is in search-loop.config.json protected_paths, so the
// engine never edits a client-approved page; it only links to them. A mirrored
// top-level name missing from protected_paths stops the run (the two lists can
// never drift silently). `clean` removes the view before anything is committed.
//
//   node .github/scripts/search_loop_site_view.mjs make    (after npm run build)
//   node .github/scripts/search_loop_site_view.mjs clean
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const record = path.join(root, '.search-loop-site-view.json');
const mode = process.argv[2];

function clean() {
  if (!fs.existsSync(record)) { console.log('site view: nothing to clean'); return; }
  const { created = [] } = JSON.parse(fs.readFileSync(record, 'utf8'));
  for (const rel of created) fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  fs.rmSync(record, { force: true });
  console.log(`site view: removed ${created.length} mirrored path(s)`);
}

function make() {
  clean();
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'search-loop.config.json'), 'utf8'));
  const prefix = cfg.output.url_prefix;
  const protectedSet = new Set(cfg.protected_paths || []);
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const routes = [...sitemap.matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]).filter((r) => !r.startsWith(prefix));
  if (!routes.length) { console.error('NAMED STOP [SITE_VIEW_EMPTY] sitemap.xml lists no pages; run npm run build first.'); process.exit(1); }
  const tops = new Set();
  const created = new Set();
  let files = 0;
  for (const route of routes) {
    const clean = route.replace(/^\//, '').replace(/\/$/, '');
    const src = path.join(root, 'pages', clean, 'index.html');
    if (!fs.existsSync(src)) continue;
    const top = clean ? clean.split('/')[0] : 'index.html';
    tops.add(top);
    const destRel = clean ? path.posix.join(clean, 'index.html') : 'index.html';
    const dest = path.join(root, destRel);
    if (fs.existsSync(dest) && !created.has(top)) { console.error(`NAMED STOP [SITE_VIEW_COLLISION] ${top} already exists at the repo root; the view would overwrite it.`); process.exit(1); }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    created.add(top);
    files++;
  }
  const unprotected = [...tops].filter((t) => !protectedSet.has(t));
  fs.writeFileSync(record, JSON.stringify({ created: [...created].sort() }, null, 2) + '\n');
  if (unprotected.length) {
    clean();
    console.error(`NAMED STOP [SITE_VIEW_UNPROTECTED] published top-level path(s) not in search-loop.config.json protected_paths: ${unprotected.join(', ')}. Add them so the engine can never edit a client-approved page.`);
    process.exit(1);
  }
  console.log(`site view: mirrored ${files} published page(s) under ${tops.size} top-level path(s), all protected`);
}

if (mode === 'make') make();
else if (mode === 'clean') clean();
else { console.error('usage: search_loop_site_view.mjs make|clean'); process.exit(1); }
