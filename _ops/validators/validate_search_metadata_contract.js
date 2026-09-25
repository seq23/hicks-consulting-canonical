'use strict';
/**
 * SEARCH METADATA CONTRACT (titles and meta descriptions of every sitemap page)
 *
 * On 25 Sep 2026 Bing's crawl of hicksconsulting.org found 14 duplicate-title
 * groups and 22 duplicate-description groups. The titles were a truncation
 * defect: 78 published pages carried a ~45-character chop of their real title
 * ("Boundary Problems Really Sound Like in | Hicks Consulting" on six pages).
 * The descriptions were one templated sentence per topic, some cut mid-word
 * ("... move forward with more cla."). Eight titles were under 30 characters
 * and 21 descriptions sat outside 110-160.
 *
 * validate_seo_metadata_contract.js only asked for a <title> of 8+ characters,
 * and validate_title_uniqueness_contract.js checks manifest titles, not what the
 * page actually ships - so a page could render a title that was not its title
 * and every check still passed. This contract reads the shipped <head> of every
 * sitemap page and asserts:
 *
 *   1. <title> is 30-70 characters (Bing flags "Title too long" above 70) and
 *      unique across the sitemap;
 *   2. a published manifest page's <title> is exactly searchTitle(manifest
 *      title) from scripts/lib/search_metadata.js: the whole title (plus the
 *      site suffix when it fits), or a hand-authored whole-phrase short form
 *      from data/search/title_short_forms.json - never a character chop, so the
 *      truncation cannot come back; every short form must still be in use;
 *   3. the meta description is 110-160 characters, unique, ends on a whole
 *      sentence, and does not end on a chopped word;
 *   4. no 8-word run is shared by the descriptions of more than 2 pages - a
 *      templated or appended sentence is a duplicate with the nouns swapped;
 *   5. og:title / twitter:title agree with the <title> they mirror (social
 *      descriptions may be written for their own card and are not pinned);
 *   6. the page renderer (scripts/autonomy/lib/render_resource.mjs) goes through
 *      scripts/lib/search_metadata.js and no longer cuts descriptions by
 *      character count - a rule the generator ignores is a wish.
 *
 * It hard-fails if it examined zero pages. Repair with
 * `node scripts/search/apply_search_metadata.js` (manifest pages); hand-authored
 * pages are edited at their source under pages/.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const ROOT = process.cwd();
const lib = require(path.join(ROOT, 'scripts/lib/search_metadata.js'));

const failures = [];
const rel = (p) => path.relative(ROOT, p).replaceAll(path.sep, '/');
const pageFile = (route) => path.join(ROOT, 'pages', route.replace(/^\//, '').replace(/\/$/, ''), 'index.html');

// ------------------------------------------------------------- the corpus
const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) fail('SEARCH METADATA: sitemap.xml is missing, so there is no list of public pages to examine.');
const routes = [...fs.readFileSync(sitemapPath, 'utf8').matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
if (!routes.length) fail('SEARCH METADATA: sitemap.xml lists 0 URLs. This check examined nothing and proves nothing.');

let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/admin/content_manifest.json'), 'utf8')); } catch { manifest = null; }
if (!Array.isArray(manifest)) fail('SEARCH METADATA: data/admin/content_manifest.json is missing or not an array; manifest titles cannot be checked.');
const manifestByRoute = new Map();
for (const e of manifest) {
  if (e && e.status === 'published' && e.validationPassed === true && e.title) manifestByRoute.set(e.publicPath || e.slug, e);
}

const pages = [];
for (const route of routes) {
  const file = pageFile(route);
  if (!fs.existsSync(file)) { failures.push(`${route}: in sitemap.xml but ${rel(file)} does not exist.`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  pages.push({ route, file: rel(file), html, meta: lib.readMeta(html) });
}
if (!pages.length) fail('SEARCH METADATA: 0 sitemap pages could be read from pages/. This check examined nothing.');

// ------------------------------------------------------------- per page
const titleOwners = new Map();
const descOwners = new Map();
let manifestChecked = 0;
for (const { route, file, html, meta } of pages) {
  const { title, description } = meta;
  if (!title) { failures.push(`${file}: no <title>.`); continue; }
  if (title.length < lib.TITLE_MIN || title.length > lib.TITLE_MAX) failures.push(`${file}: <title> is ${title.length} characters ("${title}"); the range is ${lib.TITLE_MIN}-${lib.TITLE_MAX}.`);
  const tkey = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!titleOwners.has(tkey)) titleOwners.set(tkey, []);
  titleOwners.get(tkey).push(route);
  for (const [key, label] of [['ogTitle', 'og:title'], ['twitterTitle', 'twitter:title']]) {
    if (meta[key] !== null && meta[key] !== title) failures.push(`${file}: ${label} "${meta[key]}" does not match <title> "${title}".`);
  }

  const entry = manifestByRoute.get(route);
  if (entry) {
    manifestChecked += 1;
    const expected = lib.searchTitle(entry.title);
    if (!expected) failures.push(`${file}: manifest title "${entry.title}" has no ${lib.TITLE_MIN}-${lib.TITLE_MAX} character whole-phrase form; add a short form to data/search/title_short_forms.json.`);
    else if (title !== expected) failures.push(`${file}: <title> is "${title}" but the manifest title makes it "${expected}" (scripts/lib/search_metadata.js searchTitle). A hand-shortened or chopped title is the 25 Sep truncation defect.`);
  }

  if (!description) { failures.push(`${file}: no meta description.`); continue; }
  if (!lib.descriptionInRange(description)) failures.push(`${file}: meta description is ${description.length} characters; the range is ${lib.DESC_MIN}-${lib.DESC_MAX}. ("${description}")`);
  if (!lib.endsWhole(description)) failures.push(`${file}: meta description does not end on a whole sentence: "${description}"`);
  else if (!lib.finalWordIsWhole(description, html)) failures.push(`${file}: meta description ends on a chopped word: "${description}"`);
  if (!descOwners.has(description)) descOwners.set(description, []);
  descOwners.get(description).push(route);
}

// ------------------------------------------------------------- across pages
for (const [, owners] of titleOwners) {
  if (owners.length > 1) failures.push(`DUPLICATE TITLE on ${owners.length} pages: ${owners.join(', ')}`);
}
for (const [desc, owners] of descOwners) {
  if (owners.length > 1) failures.push(`DUPLICATE DESCRIPTION on ${owners.length} pages (${owners.join(', ')}): "${desc}"`);
}
const descByRoute = new Map(pages.filter((p) => p.meta.description).map((p) => [p.route, p.meta.description]));
for (const [run, owners] of lib.boilerplateRuns(descByRoute)) {
  failures.push(`BOILERPLATE DESCRIPTION: the run "${run}" appears in ${owners.length} descriptions (max ${lib.BOILERPLATE_MAX_PAGES}): ${owners.join(', ')}`);
}

if (manifestByRoute.size && !manifestChecked) failures.push('0 published manifest pages were found in the sitemap; the manifest-title assertion reached nothing.');

// ------------------------------------------------------------- the short forms
// Hand-authored short titles are a second list next to the manifest; a stale
// entry (its title retired or renamed) would be a rule governing nothing.
const shortForms = lib.loadShortForms();
const publishedTitles = [...manifestByRoute.values()].map((e) => e.title);
for (const [full, short] of Object.entries(shortForms.titles)) {
  const used = publishedTitles.some((t) => t === full || t.startsWith(`${full}: `));
  if (!used) failures.push(`STALE SHORT FORM: data/search/title_short_forms.json shortens "${full}", which no published manifest page carries.`);
  if (short.length >= full.length) failures.push(`SHORT FORM NOT SHORTER: "${short}" for "${full}".`);
}
if (!Object.keys(shortForms.titles).length) failures.push('data/search/title_short_forms.json is missing or has no titles; long manifest titles cannot be given a compliant <title>.');

// ------------------------------------------------------------- the generator
const rendererPath = 'scripts/autonomy/lib/render_resource.mjs';
const renderer = fs.readFileSync(path.join(ROOT, rendererPath), 'utf8');
const code = renderer.replace(/^\s*\/\/.*$/gm, '');
if (!/search_metadata\.js/.test(code)) failures.push(`UNLINKED GENERATOR: ${rendererPath} does not load scripts/lib/search_metadata.js, so new pages are titled and described by rules this contract does not govern.`);
if (/description[\s\S]{0,120}\.slice\(\s*0\s*,\s*\d+\s*\)/.test(code)) failures.push(`CHARACTER-CUT DESCRIPTION: ${rendererPath} cuts a description with .slice(0, N) again; that is how "... with more cla." was made.`);
if (!/fitDescription\(/.test(code) || !/searchTitle\(/.test(code)) failures.push(`${rendererPath} must build the description with fitDescription() and the title with searchTitle().`);

if (failures.length) {
  fail([`Search metadata contract: examined ${pages.length} sitemap page(s), ${manifestChecked} of them manifest pages.`, ...failures]);
}
console.log(`Search metadata contract OK (${pages.length} sitemap pages: every <title> ${lib.TITLE_MIN}-${lib.TITLE_MAX} characters and unique, ${manifestChecked} manifest titles shipped as searchTitle() gives them, every description ${lib.DESC_MIN}-${lib.DESC_MAX} characters, unique, whole-sentence, no 8-word run on more than ${lib.BOILERPLATE_MAX_PAGES} pages; renderer wired to scripts/lib/search_metadata.js).`);
