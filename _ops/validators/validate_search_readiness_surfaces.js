'use strict';
/*
 * SEARCH READINESS c3 (restored 10 Nov 2026, hostile review: c3 only).
 * The session fees published as Offer prices must equal the fees the site states:
 *   - every service in data/entities/service_schema.json is priced at a fee /faq/ states, and
 *     /faq/ still carries the answer the schema quotes;
 *   - every service route in the BUILT site (dist/) carries a Service with a priced Offer;
 *   - every built page that carries a non-zero Offer price states that price in its visible text.
 * A wrong or invisible fee in markup publishes a false price to answer engines.
 * Rule 0: zero built pages, or zero priced pages, is a hard failure.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const root = process.cwd();
const dist = path.join(root, 'dist');
if (!fs.existsSync(dist)) fail('SEARCH READINESS: dist/ does not exist. Run `npm run build` before this check; it governs the built site.');

const errors = [];
const skip = new Set(['admin', 'preview', 'assets', 'data']);
const serviceConfig = JSON.parse(fs.readFileSync(path.join(root, 'data', 'entities', 'service_schema.json'), 'utf8'));
if (!(serviceConfig.services || []).length) fail('SEARCH READINESS: data/entities/service_schema.json lists no services; the fee check examined nothing.');
const faqSource = path.join(root, 'pages', 'faq', 'index.html');
if (!fs.existsSync(faqSource)) {
  errors.push('faq-missing: pages/faq/index.html is gone, so the published fees have no source to agree with.');
} else {
  const faq = fs.readFileSync(faqSource, 'utf8');
  if (!faq.includes(serviceConfig.faqSourceAnswer)) errors.push(`price-drift: pages/faq/index.html no longer contains the answer data/entities/service_schema.json quotes (${serviceConfig.faqSourceAnswer}). Update the schema prices to match before this ships.`);
  for (const service of serviceConfig.services) if (!faq.includes(`$${service.price}`)) errors.push(`price-drift: the schema prices "${service.name}" at $${service.price}, which does not appear in the FAQ answer.`);
}

function jsonLdNodes(html) {
  const out = [];
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(match[1])); } catch { /* unreadable block: not a priced Offer */ }
  }
  return out;
}
function deepNodes(value, out = []) {
  if (Array.isArray(value)) { for (const entry of value) deepNodes(entry, out); return out; }
  if (value && typeof value === 'object') { out.push(value); for (const entry of Object.values(value)) deepNodes(entry, out); }
  return out;
}
const typesOf = (node) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).filter((t) => typeof t === 'string');
const visibleText = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');

let examined = 0;
const servicePagesWithPrice = [];
const pagesStatingFees = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (skip.has(entry.name) && path.dirname(full) === dist) continue; walk(full); continue; }
    if (!entry.name.endsWith('.html') || entry.name === '404.html') continue;
    const html = fs.readFileSync(full, 'utf8');
    if (!html.includes('</head>')) continue;
    const rel = path.relative(dist, full).split(path.sep).join('/');
    const route = rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`;
    examined++;
    const nodes = jsonLdNodes(html);
    if (serviceConfig.routes.includes(route)) {
      const priced = deepNodes(nodes).filter((n) => typesOf(n).includes('Service'))
        .filter((n) => deepNodes([n]).some((o) => typesOf(o).includes('Offer') && o.price !== undefined));
      if (!priced.length) errors.push(`no-priced-offer: ${route} is a service route but carries no Service with a priced Offer.`);
      else servicePagesWithPrice.push(route);
    }
    const offerPrices = [...new Set(deepNodes(nodes)
      .filter((n) => typesOf(n).includes('Offer') && n.price !== undefined && Number(n.price) !== 0)
      .map((n) => String(n.price).replace(/\.0+$/, '')))];
    if (offerPrices.length) {
      const text = visibleText(html);
      const hidden = offerPrices.filter((price) => !text.includes(price));
      if (hidden.length) errors.push(`price-not-visible: ${route} carries Offer price(s) ${hidden.map((p) => `$${p}`).join(', ')} that its visible text never states. Show the fee on the page or take the route off data/entities/service_schema.json routes.`);
      else pagesStatingFees.push(route);
    }
  }
})(dist);

if (!examined) fail('SEARCH READINESS: examined 0 built pages. This check proves nothing.');
if (!servicePagesWithPrice.length) errors.push('no-priced-offer-anywhere: not one service route carried a priced Offer.');
if (!pagesStatingFees.length && !errors.length) fail('SEARCH READINESS: not one built page carried a priced Offer, so the price-visibility check examined nothing.');
if (errors.length) fail([`SEARCH READINESS c3: ${errors.length} finding(s) across ${examined} built page(s).`, ...errors.map((e) => `- ${e}`)].join('\n'));
console.log(`Search readiness c3 OK: ${examined} built pages, priced Offers on ${servicePagesWithPrice.length} service route(s) equal to the /faq/ fees, every fee visible on ${pagesStatingFees.length} page(s)`);
