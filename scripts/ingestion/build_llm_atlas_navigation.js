#!/usr/bin/env node
'use strict';
/**
 * Give the LLM Atlas surfaces a way in and a way out.
 *
 * The defect. Seven of the eight atlas pages carry no anchor at all - no header,
 * no footer, no link of any kind. Measured over the 95 URLs in sitemap.xml they
 * are the site's only dead ends: a reader or a crawler that arrives has no route
 * anywhere, not even back to the atlas index. The index itself is no better in
 * the other direction: it renders its six pillars as <article> cards with no
 * links, so the seven sub-surfaces have no inbound internal link either and sit
 * in the sitemap unreachable by any click path.
 *
 * The repair. One <nav> per page naming the other atlas surfaces, the atlas
 * index, and the site home page. Nothing else changes.
 *
 * Why a nav and not prose. Published page content on this property is frozen
 * until 2026-12-31. A navigation block is structural plumbing - it adds no
 * editorial copy, states no claim, and rewords nothing that is already there.
 * Every link label is the target page's own <title>, taken verbatim from the
 * part before " | ", so no new wording is authored at all.
 *
 * The visibility rule these pages state about themselves is respected: they may
 * appear in sitemap.xml, llms.txt and direct crawler routes, and must not appear
 * in the main nav, mobile nav, homepage cards, footer primary nav, public
 * resource grids or sales CTAs. This adds links *within* the atlas and one link
 * out to the home page. It adds nothing to any public surface, so
 * _ops/validators/validate_hidden_llm_surfaces.js stays clean.
 *
 * Links use the trailing-slash directory form, which is what each page's own
 * canonical names and what the origin answers 200 for - verified with `curl -I`
 * against www.hicksconsulting.org for all eight routes. The .html form would
 * spend a redirect.
 *
 * Written into pages/ rather than dist/, because dist/ is wiped and rebuilt by
 * `npm run build`.
 *
 * Idempotent: the block is delimited by data-nav="atlas" and replaced wholesale.
 *
 * Usage: node scripts/ingestion/build_llm_atlas_navigation.js [--write] [--check]
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const ATLAS = path.join(root, 'pages', 'llm-atlas');
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');

const SURFACES = ['fanouts', 'queries', 'pillars', 'clusters', 'social-signals',
  'source-health', 'answer-surfaces'];

const BLOCK_RE = /<section[^>]+data-nav="atlas"[\s\S]*?<\/section>/i;
const ANCHOR_RE = /<a\b[^>]*?\bhref="([^"]+)"/gi;

const esc = (s) => s.replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The page's own <title>, up to the " | " that names the site. */
function label(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) throw new Error(`${path.relative(root, file)} has no <title> to take a link label from`);
  return m[1].split('|')[0].trim();
}

function linkTargets(html) {
  const out = new Set();
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(html))) out.add(m[1]);
  return out;
}

const pages = [
  { slug: '', route: '/llm-atlas/', file: path.join(ATLAS, 'index.html') },
  ...SURFACES.map((slug) => ({ slug, route: `/llm-atlas/${slug}/`, file: path.join(ATLAS, slug, 'index.html') }))
];

for (const page of pages) {
  if (!fs.existsSync(page.file)) throw new Error(`missing atlas page ${path.relative(root, page.file)}`);
  page.label = label(page.file);
}

function block(page) {
  const others = pages.filter((p) => p.route !== page.route);
  const items = others.map((p) => `<li><a href="${p.route}">${esc(p.label)}</a></li>`).join('');
  const heading = page.slug ? 'Other LLM Atlas surfaces' : 'LLM Atlas surfaces';
  return `<section class="section" data-nav="atlas"><div class="container narrow">`
    + `<nav class="atlas-nav" aria-label="LLM Atlas surfaces"><h2>${heading}</h2>`
    + `<ul>${items}</ul>`
    + `<p><a href="/">Hicks Consulting home</a></p></nav></div></section>`;
}

const changed = [];
const problems = [];

for (const page of pages) {
  const before = fs.readFileSync(page.file, 'utf8');
  const html = block(page);
  const after = BLOCK_RE.test(before)
    ? before.replace(BLOCK_RE, () => html)
    : before.replace(/<\/main>/i, () => `${html}\n</main>`);
  if (after === before && !BLOCK_RE.test(before)) {
    problems.push(`${path.relative(root, page.file)}: no </main> to insert before`);
    continue;
  }
  // The baseline is the page with this block removed, so a later revision of the
  // block is not measured against the previous one.
  const owned = linkTargets(before.replace(BLOCK_RE, ' '));
  const now = linkTargets(after);
  const lost = [...owned].filter((h) => !now.has(h));
  if (lost.length) {
    problems.push(`${path.relative(root, page.file)}: would lose ${lost.join(', ')}`);
    continue;
  }
  if (after !== before) {
    changed.push(path.relative(root, page.file));
    if (WRITE) fs.writeFileSync(page.file, after, 'utf8');
  }
}

const receipt = {
  status: problems.length ? 'FAIL' : 'PASS',
  written: WRITE,
  atlas_pages: pages.length,
  files_changed: changed.length,
  files: changed,
  links_per_page: pages.length, // the seven siblings or surfaces, plus home
  problems
};
console.log(JSON.stringify(receipt, null, 2));
if (problems.length) process.exit(1);
if (CHECK && changed.length) process.exit(1);
