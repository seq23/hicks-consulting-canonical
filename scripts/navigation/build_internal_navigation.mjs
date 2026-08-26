#!/usr/bin/env node
/**
 * Regenerate internal navigation in pages/ from taxonomy the repo already holds.
 *
 * Why this exists
 * ---------------
 * The four resource category hubs shipped an empty <ul id="*-published"></ul>
 * and filled it in the browser from /data/admin/content_manifest.json. A reader
 * with JS saw the list; the HTML that a crawler reads contained no link to any
 * article, guide, insight or white paper at all. The measured effect was that 69
 * of the site's 98 public pages had zero inbound internal links and 71 were
 * unreachable from the homepage by following hrefs. Sitemap membership does not
 * substitute for that.
 *
 * This script writes the same list into the HTML at source-edit time, and adds
 * a visible breadcrumb plus a related-links block to every published resource
 * page. The browser-side renderer in assets/js/site.js still runs and still
 * replaces the list with the identical markup, so the page a reader sees is
 * unchanged; the difference is that the links now exist before JS runs.
 *
 * Scope discipline
 * ----------------
 * The client repo is under a content and publishing-cadence freeze. This script
 * only ever inserts or replaces two elements, both purely navigational:
 *   <nav class="page-breadcrumb"> ... </nav>   directly after <main>
 *   <nav class="related-nav">     ... </nav>   directly before </main>
 * and the contents of the four hub <ul id="*-published"> containers. It never
 * touches editorial prose, headings, meta descriptions, publication status or
 * cadence, and it creates no new page or URL. Neither inserted element contains
 * an h1/h2/h3, so the heading shape that
 * _ops/validators/deep/validate_site_intent_preservation.js pins on the nine
 * protected NAV pages is preserved.
 *
 * Relationships used are the ones already recorded in the manifest, not invented:
 *   - contentType groups a page into articles / guides / insights / white-papers
 *   - an insight's id is its parent article's id plus "-N", and its title is the
 *     parent article's title, a colon, then the section name
 *   - publishedAt/scheduledAt gives the real reading order inside a category
 * Anchor text is the target page's own <h1>, so it is descriptive and varies by
 * construction. Only pages whose manifest status is "published" are ever linked,
 * because scripts/site_build.js deletes every other resource route from dist.
 *
 * Run: node scripts/navigation/build_internal_navigation.mjs [--check]
 * Idempotent: re-running after a publish refreshes the blocks in place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PAGES = path.join(ROOT, 'pages');
const CHECK_ONLY = process.argv.includes('--check');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/admin/content_manifest.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const routeToSource = (route) => path.join(PAGES, route.replace(/^\//, '').replace(/\/$/, ''), 'index.html');
const releaseDate = (item) => String(item.publishedAt || item.scheduledAt || '');

function readHeading(route) {
  const file = routeToSource(route);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** The published, rendered set. Anything else is absent from dist. */
const published = manifest
  .filter((i) => i.status === 'published' && i.validationPassed === true && String(i.slug || '').startsWith('/resources/'))
  .filter((i) => fs.existsSync(routeToSource(i.publicPath || i.slug)))
  .map((i) => ({ ...i, route: (i.publicPath || i.slug), heading: readHeading(i.publicPath || i.slug) }))
  .filter((i) => i.heading);

const byType = (t) => published.filter((i) => i.contentType === t).sort((a, b) => releaseDate(b).localeCompare(releaseDate(a)));

const CATEGORIES = [
  { type: 'articles', hub: '/resources/articles/', containerId: 'articles-published', label: 'Articles' },
  { type: 'guides', hub: '/resources/guides/', containerId: 'guides-published', label: 'Guides' },
  { type: 'insights', hub: '/resources/insights/', containerId: 'insights-published', label: 'Insights' },
  { type: 'white-papers', hub: '/resources/white-papers/', containerId: 'white-papers-published', label: 'White Papers' },
];

/* ---------- taxonomy: which insight belongs to which article ---------- */

const articlesByTitle = new Map(byType('articles').map((a) => [a.title, a]));
/** parent route -> insight children, in the order their ids number them */
const childrenOf = new Map();
/** insight route -> { parent, section } */
const parentOfInsight = new Map();

for (const insight of byType('insights')) {
  const parentTitle = insight.title.split(': ')[0];
  const parent = articlesByTitle.get(parentTitle);
  if (!parent || parentTitle === insight.title) continue;
  const section = insight.title.slice(parentTitle.length + 2).trim();
  if (!section) continue;
  if (!childrenOf.has(parent.route)) childrenOf.set(parent.route, []);
  childrenOf.get(parent.route).push({ ...insight, section });
  parentOfInsight.set(insight.route, { parent, section });
}
for (const list of childrenOf.values()) {
  list.sort((a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop()));
}

/* ---------- block builders ---------- */

const linkList = (items) =>
  `<ul class="clean resource-links">${items.map(({ href, text }) => `<li><a href="${esc(href)}">${esc(text)}</a></li>`).join('')}</ul>`;

const group = (label, items) => (items.length ? `<p class="eyebrow">${esc(label)}</p>${linkList(items)}` : '');

function relatedNav(groups) {
  const body = groups.map(([label, items]) => group(label, items)).filter(Boolean).join('');
  if (!body) return '';
  return `<nav aria-label="Related pages" class="related-nav">${body}</nav>`;
}

/**
 * The visible breadcrumb is rendered from the page's own BreadcrumbList JSON-LD
 * so the two can never disagree, and so no trail is invented for a page that
 * does not already declare one.
 */
function breadcrumbNav(html, canonicalDomain = 'https://www.hicksconsulting.org') {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    if (!data || data['@type'] !== 'BreadcrumbList' || !Array.isArray(data.itemListElement)) continue;
    const crumbs = [...data.itemListElement].sort((a, b) => a.position - b.position);
    if (crumbs.length < 2) return '';
    const parts = crumbs.map((c, idx) => {
      const name = esc(c.name);
      if (idx === crumbs.length - 1) return `<li aria-current="page">${name}</li>`;
      const href = String(c.item || '').replace(canonicalDomain, '') || '/';
      return `<li><a href="${esc(href)}">${name}</a></li>`;
    });
    return `<nav aria-label="Breadcrumb" class="page-breadcrumb"><ol class="crumbs">${parts.join('')}</ol></nav>`;
  }
  return '';
}

/* ---------- writer ---------- */

const BREADCRUMB_RE = /<nav aria-label="Breadcrumb" class="page-breadcrumb">[\s\S]*?<\/nav>/;
const RELATED_RE = /<nav aria-label="Related pages" class="related-nav">[\s\S]*?<\/nav>/;

const changed = [];

function applyToFile(file, { breadcrumb = true, related = '' } = {}) {
  const before = fs.readFileSync(file, 'utf8');
  let html = before;

  html = html.replace(BREADCRUMB_RE, '');
  html = html.replace(RELATED_RE, '');

  if (breadcrumb) {
    const crumb = breadcrumbNav(html);
    if (crumb) html = html.replace(/<main\b[^>]*>/i, (tag) => `${tag}${crumb}`);
  }
  if (related) html = html.replace(/<\/main>/i, `${related}</main>`);

  if (html !== before) {
    if (!CHECK_ONLY) fs.writeFileSync(file, html);
    changed.push(path.relative(ROOT, file));
  }
}

/* ---------- 1. category hubs: render the list into the HTML ---------- */

for (const cat of CATEGORIES) {
  const file = routeToSource(cat.hub);
  if (!fs.existsSync(file)) continue;
  const items = byType(cat.type);
  const before = fs.readFileSync(file, 'utf8');
  // Matches what renderPublishedResourcesList() in assets/js/site.js produces,
  // so the client-side re-render is a visual no-op.
  const rows = items.length
    ? items.map((i) => `<li><a href="${esc(i.route)}">${esc(i.title)}</a><span class="muted small"> — ${esc(releaseDate(i).slice(0, 10))}</span></li>`).join('')
    : '<li class="muted">No published resources are live in this section yet.</li>';
  const containerRe = new RegExp(`(<ul class="clean resource-list" id="${cat.containerId}">)[\\s\\S]*?(</ul>)`);
  if (!containerRe.test(before)) {
    console.warn(`hub container not found: ${cat.containerId}`);
    continue;
  }
  let html = before.replace(containerRe, `$1${rows}$2`);
  if (html !== before && !CHECK_ONLY) fs.writeFileSync(file, html);
  if (html !== before) changed.push(path.relative(ROOT, file));

  // Breadcrumb + a sideways link to the other categories, so a reader who lands
  // on one hub can reach the rest of the library without going back to /resources/.
  const siblings = CATEGORIES.filter((c) => c.type !== cat.type && byType(c.type).length)
    .map((c) => ({ href: c.hub, text: readHeading(c.hub) || c.label }));
  applyToFile(file, { related: relatedNav([['Other parts of the resource library', siblings]]) });
}

/* ---------- 2. articles ---------- */

const articles = byType('articles');
articles.forEach((article, index) => {
  const file = routeToSource(article.route);
  if (!fs.existsSync(file)) return;
  const kids = (childrenOf.get(article.route) || []).map((c) => ({ href: c.route, text: c.section }));
  const near = [articles[index - 1], articles[index + 1]].filter(Boolean).map((a) => ({ href: a.route, text: a.heading }));
  applyToFile(file, {
    related: relatedNav([
      ['More on this topic', kids],
      ['Keep reading', [...near, { href: '/resources/articles/', text: 'All Hicks Consulting articles' }]],
    ]),
  });
});

/* ---------- 3. insights ---------- */

const insights = byType('insights');
insights.forEach((insight, index) => {
  const file = routeToSource(insight.route);
  if (!fs.existsSync(file)) return;
  const rel = parentOfInsight.get(insight.route);
  const groups = [];
  if (rel) {
    groups.push(['Read the full article', [{ href: rel.parent.route, text: rel.parent.heading }]]);
    const siblings = (childrenOf.get(rel.parent.route) || [])
      .filter((c) => c.route !== insight.route)
      .map((c) => ({ href: c.route, text: c.section }));
    groups.push(['More on this topic', siblings]);
  }
  const near = [insights[index - 1], insights[index + 1]]
    .filter(Boolean)
    .filter((i) => i.route !== insight.route && (!rel || parentOfInsight.get(i.route)?.parent.route !== rel.parent.route))
    .map((i) => ({ href: i.route, text: i.heading }));
  groups.push(['Keep reading', [...near, { href: '/resources/insights/', text: 'All Hicks Consulting insights' }]]);
  applyToFile(file, { related: relatedNav(groups) });
});

/* ---------- 4. guides and white papers ---------- */

for (const type of ['guides', 'white-papers']) {
  const list = byType(type);
  list.forEach((item, index) => {
    const file = routeToSource(item.route);
    if (!fs.existsSync(file)) return;
    const others = list.filter((_, i) => i !== index).map((o) => ({ href: o.route, text: o.heading }));
    const hub = CATEGORIES.find((c) => c.type === type).hub;
    applyToFile(file, {
      related: relatedNav([
        [type === 'guides' ? 'Other guides in this library' : 'Other white papers', others],
        ['Keep reading', [{ href: hub, text: readHeading(hub) || hub }, { href: '/resources/', text: readHeading('/resources/') || 'Resources' }]],
      ]),
    });
  });
}

/* ---------- 5. the two orphaned conversion pages ---------- */

/**
 * /request-consult/ and /book-discovery-call/ are listed as money pages in
 * data/internal_authority_graph.json and are in the sitemap, but nothing on the
 * site linked to either of them. They are reached here from the pages a reader
 * is actually on when they decide to start, rather than from the global footer,
 * which would make them footer boilerplate on all 98 pages.
 *
 * /therapy/, /coaching/ and /contact/ would each be a more obvious home, and are
 * deliberately not used. All three are protected NAV pages, and their measured
 * main-copy similarity against the preservation baseline is already 0.805, 0.850
 * and 0.815 against a 0.78 floor. Adding even a short link block to /therapy/
 * and /contact/ pushed them to 0.779 and 0.766 and hard-failed
 * validate_site_intent_preservation. The three entry points below are unprotected
 * and are where the same reader intent sits.
 */
const CONVERSION_ENTRY = ['/faq/', '/black-therapist-memphis/', '/anxiety-therapist-memphis/'];
const conversionTargets = ['/request-consult/', '/book-discovery-call/']
  .filter((r) => fs.existsSync(routeToSource(r)))
  .map((r) => ({ href: r, text: readHeading(r) }))
  .filter((t) => t.text);

for (const route of CONVERSION_ENTRY) {
  const file = routeToSource(route);
  if (!fs.existsSync(file) || !conversionTargets.length) continue;
  // No breadcrumb on these: they are top-level pages, and pages/index.html and
  // the other protected NAV pages should keep the shape their baseline pins.
  applyToFile(file, { breadcrumb: false, related: relatedNav([['Start a conversation', conversionTargets]]) });
}

/* ---------- report ---------- */

console.log(`published resources linked: ${published.length}`);
console.log(`  articles ${byType('articles').length} | guides ${byType('guides').length} | insights ${byType('insights').length} | white papers ${byType('white-papers').length}`);
console.log(`  insights mapped to a published parent article: ${parentOfInsight.size}/${byType('insights').length}`);
console.log(`${CHECK_ONLY ? 'would change' : 'updated'}: ${changed.length} source page(s)`);
if (CHECK_ONLY && changed.length) process.exit(1);
