'use strict';
/*
 * SEARCH READINESS SURFACE CONTRACT
 *
 * The owner's Search Readiness Checklist runs against the live site every
 * Monday and wrote four failures for hicksconsulting.org on 25 Oct 2026. Each
 * was fixed at source; this is the guard that keeps them fixed, because the
 * checklist runs weekly against production and this runs on every pull request.
 *
 *   a9  /favicon.ico, /apple-touch-icon.png and /site.webmanifest all answered
 *       404. Browsers ask for those at the root whatever the <link> tags say.
 *   b6  og:image pointed at a 2000x2000 logo with no og:image:width or
 *       og:image:height, so every share surface cropped it to a square sliver.
 *   c1  Every page's first organization-family node was an anonymous
 *       `publisher` blank node with no logo and no sameAs - never the same
 *       entity twice, so no answer engine could tell what entity the site is.
 *   c3  No node anywhere stated a price, so nothing could read what a session
 *       costs.
 *   c5  (26 Oct 2026) The c3 fix then published $200/$165/$85 in the markup of
 *       five routes chosen by topic, four of which never showed a fee to a
 *       reader - the homepage among them. Markup the visible page does not
 *       support is treated as deceptive and the penalty is every rich result on
 *       the domain. Every page that carries a priced Offer must state that
 *       price in its own visible text, whether the fee block stamped it or the
 *       page's own prose did.
 *
 * It asserts the BUILT output, because every one of these facts is stamped at
 * build time by scripts/render/normalize_head_and_schema.js: checking pages/
 * would prove nothing about what ships. It reads the repo, never the network.
 *
 * The price check is the one that matters most and the easiest to let rot: the
 * Offer prices must equal the numbers /faq/ states in prose. A fee that changes
 * in the FAQ and not in the schema publishes a wrong price to answer engines,
 * so that drift fails here.
 *
 * Rule 0: hard-fails if it examines zero pages rather than passing an empty
 * check.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const root = process.cwd();
const dist = path.join(root, 'dist');
const HOST = 'www.hicksconsulting.org';
const ORG_TYPES = /^(Organization|ProfessionalService|LocalBusiness|Corporation|NewsMediaOrganization|MedicalBusiness|MedicalOrganization|HealthAndBeautyBusiness)$/;
const ORG_REQUIRED = ['name', 'url', 'logo', 'sameAs'];

if (!fs.existsSync(dist)) fail('SEARCH READINESS: dist/ does not exist. Run `npm run build` before this check; it governs the built site.');

const errors = [];
const skip = new Set(['admin', 'preview', 'assets', 'data']);

// ------------------------------------------------- a9: the root files browsers ask for
const rootFiles = ['favicon.ico', 'apple-touch-icon.png', 'site.webmanifest'];
for (const file of rootFiles) {
  const full = path.join(dist, file);
  if (!fs.existsSync(full)) { errors.push(`root-file-missing: dist/${file} does not ship, so https://${HOST}/${file} answers 404.`); continue; }
  if (!fs.statSync(full).size) errors.push(`root-file-empty: dist/${file} ships with zero bytes.`);
}
const manifestPath = path.join(dist, 'site.webmanifest');
if (fs.existsSync(manifestPath)) {
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (error) { errors.push(`manifest-unparseable: dist/site.webmanifest is not JSON (${error.message}).`); }
  if (manifest) {
    if (!manifest.name || !manifest.start_url) errors.push('manifest-incomplete: site.webmanifest needs at least name and start_url.');
    for (const icon of manifest.icons || []) {
      const iconPath = path.join(dist, String(icon.src || '').replace(/^\//, ''));
      if (!fs.existsSync(iconPath)) errors.push(`manifest-icon-404: site.webmanifest names ${icon.src}, which does not ship.`);
    }
    if (!(manifest.icons || []).length) errors.push('manifest-no-icons: site.webmanifest declares no icons, which is the whole reason it exists.');
  }
}

// ------------------------------------------------- the og:image asset and its real pixel size
function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(24);
  fs.readSync(fd, head, 0, 24, 0);
  fs.closeSync(fd);
  if (head.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const ogAssetRel = 'assets/og-card.png';
const ogAsset = path.join(dist, ogAssetRel);
let ogSize = null;
if (!fs.existsSync(ogAsset)) {
  errors.push(`og-image-missing: dist/${ogAssetRel} does not ship, so every og:image on the site is a 404.`);
} else {
  ogSize = pngSize(ogAsset);
  if (!ogSize) errors.push(`og-image-not-png: dist/${ogAssetRel} is not a PNG.`);
  else if (ogSize.width !== 1200 || ogSize.height !== 630) errors.push(`og-image-wrong-size: dist/${ogAssetRel} is ${ogSize.width}x${ogSize.height}; the share card must be 1200x630.`);
}

// ------------------------------------------------- the published session fees
const serviceConfig = JSON.parse(fs.readFileSync(path.join(root, 'data', 'entities', 'service_schema.json'), 'utf8'));
const faqSource = path.join(root, 'pages', 'faq', 'index.html');
if (!fs.existsSync(faqSource)) {
  errors.push('faq-missing: pages/faq/index.html is gone, so the published fees have no source to agree with.');
} else {
  const faq = fs.readFileSync(faqSource, 'utf8');
  if (!faq.includes(serviceConfig.faqSourceAnswer)) {
    errors.push(`price-drift: pages/faq/index.html no longer contains the answer data/entities/service_schema.json quotes (${serviceConfig.faqSourceAnswer}). The published fees changed; update the schema prices to match before this ships.`);
  }
  for (const service of serviceConfig.services) {
    if (!faq.includes(`$${service.price}`)) errors.push(`price-drift: the schema prices "${service.name}" at $${service.price}, which does not appear in the FAQ answer.`);
  }
}

// ------------------------------------------------- walk the built public pages
function jsonLdNodes(html) {
  const out = [];
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(match[1])); } catch { /* a block this check cannot read is reported by shape, below */ }
  }
  return out;
}

function deepNodes(value, out = []) {
  if (Array.isArray(value)) { for (const entry of value) deepNodes(entry, out); return out; }
  if (value && typeof value === 'object') {
    out.push(value);
    for (const entry of Object.values(value)) deepNodes(entry, out);
  }
  return out;
}

const typesOf = (node) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).filter((t) => typeof t === 'string');
const isOrg = (node) => typesOf(node).some((t) => ORG_TYPES.test(t));

// The text a reader (and the owner's audit) sees: script, style and tags gone.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

let examined = 0;
const servicePagesWithPrice = [];
const pagesStatingFees = [];

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skip.has(entry.name) && path.dirname(full) === dist) continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.html') || entry.name === '404.html') continue;
    const html = fs.readFileSync(full, 'utf8');
    if (!html.includes('</head>')) continue;
    const rel = path.relative(dist, full).split(path.sep).join('/');
    const route = rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`;
    examined++;

    // b6: the card a share surface renders.
    const og = (name) => (html.match(new RegExp(`<meta[^>]*property=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')) || [])[1];
    const image = og('og:image');
    if (!image) errors.push(`og-image-absent: ${route} has no og:image.`);
    else {
      let host = '';
      try { host = new URL(image).hostname; } catch { host = ''; }
      if (host !== HOST) errors.push(`og-image-off-host: ${route} points og:image at ${host || image}, not ${HOST}.`);
    }
    if (ogSize) {
      if (og('og:image:width') !== String(ogSize.width)) errors.push(`og-width-wrong: ${route} declares og:image:width ${og('og:image:width')}; the asset is ${ogSize.width}.`);
      if (og('og:image:height') !== String(ogSize.height)) errors.push(`og-height-wrong: ${route} declares og:image:height ${og('og:image:height')}; the asset is ${ogSize.height}.`);
    }
    if (!/<meta[^>]*name=["']twitter:card["'][^>]*content=["']summary_large_image["']/i.test(html)) {
      errors.push(`twitter-card-wrong: ${route} does not declare twitter:card summary_large_image.`);
    }

    // c1: one identified organization, everywhere.
    const nodes = jsonLdNodes(html);
    const orgs = deepNodes(nodes).filter(isOrg);
    if (!orgs.length) errors.push(`no-organization: ${route} carries no organization-family node.`);
    else {
      // The checklist reads the FIRST one it finds, so every one of them must hold up.
      for (const org of orgs) {
        const missing = ORG_REQUIRED.filter((key) => !org[key] || (Array.isArray(org[key]) && !org[key].length));
        if (missing.length) errors.push(`anonymous-organization: ${route} carries an organization node lacking ${missing.join(', ')}. Nested publisher nodes must be a reference to the canonical @id.`);
      }
    }

    // c3: a priced Offer on the service routes.
    if (serviceConfig.routes.includes(route)) {
      const priced = deepNodes(nodes).filter((n) => typesOf(n).includes('Service'))
        .filter((n) => deepNodes([n]).some((o) => typesOf(o).includes('Offer') && o.price !== undefined));
      if (!priced.length) errors.push(`no-priced-offer: ${route} is a service route but carries no Service with a priced Offer.`);
      else servicePagesWithPrice.push(route);
    }

    // c5: no page states a price in markup that its visible text withholds.
    // Checked on every built page, not just the service routes, because the
    // defect is a page carrying the claim - however it got there.
    const offerPrices = [...new Set(deepNodes(nodes)
      .filter((n) => typesOf(n).includes('Offer') && n.price !== undefined && Number(n.price) !== 0)
      .map((n) => String(n.price).replace(/\.0+$/, '')))];
    if (offerPrices.length) {
      const text = visibleText(html);
      const hidden = offerPrices.filter((price) => !text.includes(price));
      if (hidden.length) {
        errors.push(`price-not-visible: ${route} carries Offer price(s) ${hidden.map((p) => `$${p}`).join(', ')} that its visible text never states. Markup the page does not support costs the whole domain its rich results: either show the fee on the page or take the route off data/entities/service_schema.json routes.`);
      } else {
        pagesStatingFees.push(route);
      }
    }
  }
})(dist);

if (!examined) fail('SEARCH READINESS: examined 0 built pages. This check proves nothing.');
if (!servicePagesWithPrice.length) errors.push('no-priced-offer-anywhere: not one service route carried a priced Offer, so no answer engine can read what a session costs.');
// Rule 0 for the c5 half: a run that found no priced page at all examined nothing.
if (!pagesStatingFees.length && !errors.length) fail('SEARCH READINESS: not one built page carried a priced Offer, so the c5 price-visibility check examined nothing.');

if (errors.length) fail([`SEARCH READINESS SURFACE: ${errors.length} finding(s) across ${examined} built page(s).`, ...errors.map((e) => `- ${e}`)].join('\n'));

console.log(`Search readiness surfaces OK: ${examined} built pages, ${rootFiles.length} root files, og card ${ogSize.width}x${ogSize.height}, priced Offers on ${servicePagesWithPrice.length} service route(s), every fee visible on ${pagesStatingFees.length} page(s)`);
