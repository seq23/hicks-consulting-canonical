'use strict';
/*
 * One pass over the rendered site that makes three facts true on every page.
 *
 * It runs against dist/ for the same reason injectOrganizationSchemaSitewide()
 * does: dist/ is wiped and rebuilt on every `npm run build`, the 147 page
 * sources are hand-authored and machine-generated in roughly equal measure, and
 * a fact stamped into all of them by hand would drift the moment the next
 * resource was published. The output is inert static markup, so a crawler sees
 * it without executing anything.
 *
 * It is invoked AFTER the sitemap/lastmod ledger block in scripts/site_build.js,
 * deliberately. The ledger hashes the rendered page to decide <lastmod>, and
 * excludes the organization block precisely because byte-identical boilerplate
 * stamped on every page would move all 147 URLs to today's date at once - the
 * mass date-bump scripts/cadence_gate.js exists to flag. Running after the
 * ledger keeps that property for this boilerplate too, with no second exclusion
 * regex to keep in step.
 *
 * 1. Social card (checklist b6). og:image pointed at a 2000x2000 logo with no
 *    og:image:width/height, so every share surface cropped the mark to a square
 *    sliver and Lighthouse could not size the card. It now points at the
 *    1200x630 assets/og-card.png on this site's own host, with width, height and
 *    alt, and twitter:image follows it.
 *
 * 2. Publisher identity (checklist c1). Every Article and WebPage carried its
 *    own anonymous `publisher: {"@type":"Organization","name":...}` blank node -
 *    no logo, no sameAs, and never the same entity twice. Each one becomes a
 *    reference to the single canonical node that
 *    injectOrganizationSchemaSitewide() already stamps, so the whole site
 *    resolves to one identified organization.
 *
 * 3. Priced services (checklist c3). No node on the site stated a price, so no
 *    answer engine could read what a session costs. The three published session
 *    fees in data/entities/service_schema.json - the same numbers /faq/ states
 *    in prose - ship as Service nodes with an Offer, on the service routes only.
 *
 * 4. The same fees in visible text (checklist c5). The c3 pass put $200/$165/$85
 *    into the markup of five routes by topic, and four of them - /, /therapy/,
 *    /coaching/ and /good-faith-estimate/ - never showed a price to a reader.
 *    Markup a page's visible text does not support is what Google treats as
 *    deceptive, and the penalty is every rich result on the domain, so the
 *    Search Readiness audit flagged the homepage on 26 Oct 2026. The fix is not
 *    to delete the prices: it is to emit the visible fee list from the SAME
 *    data file, in the same pass, so the text and the Offer can never disagree.
 *    A route whose own source already states every fee (/faq/, which is where
 *    the numbers are published) is left alone. /coaching/ left the route list
 *    instead of gaining the block: coaching is non-clinical and is not sold at
 *    the therapy session fees, so a priced therapy Offer there is a claim that
 *    page cannot back either way.
 *    Guarded by _ops/validators/validate_search_readiness_surfaces.js, which
 *    now fails any built page that carries a priced Offer the page's own
 *    visible text does not state.
 *
 * It also adds the root manifest and icon links, which belong with the root
 * files the build now emits.
 *
 * Rule 0: it throws rather than returning quietly if it rewrites zero pages.
 */
const fs = require('fs');
const path = require('path');

const ORG_ID = 'https://www.hicksconsulting.org/#organization';
const OG_IMAGE = 'https://www.hicksconsulting.org/assets/og-card.png';
const OG_WIDTH = '1200';
const OG_HEIGHT = '630';
const OG_ALT = 'Hicks Consulting';
const ORG_TYPES = /^(Organization|ProfessionalService|LocalBusiness|Corporation|NewsMediaOrganization|MedicalBusiness|MedicalOrganization|HealthAndBeautyBusiness)$/;

const isOrgNode = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  return types.some((t) => typeof t === 'string' && ORG_TYPES.test(t));
};

const ORG_NAMES = new Set(['Hicks Consulting', 'Hicks Consulting PLLC']);

/**
 * True when a nested organization-family node is meant to BE this site's
 * organization: it either carries the canonical @id already or names the
 * practice. A third-party organization - a cited publication, a licensing
 * body - is left exactly as it was found, because collapsing it into this
 * site's identity would state something false.
 */
const isThisOrganization = (node) => node['@id'] === ORG_ID
  || ORG_NAMES.has(node.name)
  || ORG_NAMES.has(node.legalName);

/**
 * Replace every nested node that means this organization with a reference to
 * the one canonical node. A partial copy carrying the right @id is replaced
 * too: JSON-LD merges those by @id, but the checklist reads the FIRST
 * organization-family node it meets in document order, and a copy with only
 * name and url reads as an organization with no logo and no sameAs.
 *
 * The root of a block is left alone: that is where a real organization node
 * legitimately lives.
 */
function referenceOrganization(node, isRoot = true) {
  if (Array.isArray(node)) return node.map((entry) => referenceOrganization(entry, isRoot));
  if (!node || typeof node !== 'object') return node;
  if (!isRoot && isOrgNode(node) && isThisOrganization(node)) return { '@id': ORG_ID };
  const out = {};
  for (const [key, value] of Object.entries(node)) out[key] = referenceOrganization(value, false);
  return out;
}

function serviceNodes(config) {
  return {
    '@context': 'https://schema.org',
    '@graph': config.services.map((service) => ({
      '@type': 'Service',
      name: service.name,
      description: service.description,
      serviceType: 'Virtual therapy',
      provider: { '@id': ORG_ID },
      areaServed: [{ '@type': 'State', name: 'Tennessee' }, { '@type': 'City', name: 'Memphis' }],
      offers: {
        '@type': 'Offer',
        price: service.price,
        priceCurrency: config.priceCurrency,
        availability: 'https://schema.org/InStock',
        url: 'https://www.hicksconsulting.org/faq/'
      }
    }))
  };
}

const FEE_BLOCK_ID = 'hicks-session-fees';

// The visible counterpart of serviceNodes(), built from the same config so a fee
// can never be stated in one and not the other. Rendered before </main> so it
// reads as the last word of the page rather than footer boilerplate.
function feeBlock(config) {
  const items = config.services
    .map((service) => `<li><strong>$${escapeHtml(service.price)}</strong> &mdash; ${escapeHtml(service.name)}</li>`)
    .join('');
  return `<section class="section" id="${FEE_BLOCK_ID}" aria-label="Session fees">` +
    '<div class="container narrow">' +
    '<span class="section-label">Session fees</span>' +
    '<h2>What a session costs</h2>' +
    `<ul>${items}</ul>` +
    '<p>Hicks Consulting is a private-pay practice. A superbill can be provided for possible ' +
    'out-of-network reimbursement. <a href="/faq/">See the full FAQ</a>.</p>' +
    '</div></section>';
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Text a reader sees: script, style and tags removed. The audit that flagged the
// homepage reads the page the same way, so this is the test it will apply.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function statesEveryFee(html, config) {
  const text = visibleText(html);
  return config.services.every((service) => text.includes(String(service.price)));
}

function setMeta(html, attr, name, content) {
  const existing = new RegExp(`<meta[^>]*${attr}=["']${name}["'][^>]*>`, 'i');
  const tag = `<meta ${attr}="${name}" content="${content}"/>`;
  if (existing.test(html)) {
    return html.replace(existing, tag);
  }
  return html.replace('</head>', `${tag}</head>`);
}

function normalizeHtml(html, route, serviceConfig) {
  let out = html;

  // 1. The social card.
  out = setMeta(out, 'property', 'og:image', OG_IMAGE);
  out = setMeta(out, 'property', 'og:image:width', OG_WIDTH);
  out = setMeta(out, 'property', 'og:image:height', OG_HEIGHT);
  out = setMeta(out, 'property', 'og:image:alt', OG_ALT);
  out = setMeta(out, 'name', 'twitter:image', OG_IMAGE);
  out = setMeta(out, 'name', 'twitter:card', 'summary_large_image');

  // Root files the build now emits, declared where a browser looks for them.
  if (!/rel=["']manifest["']/i.test(out)) {
    out = out.replace('</head>', '<link rel="manifest" href="/site.webmanifest"/></head>');
  }
  if (!/href=["']\/favicon\.ico["']/i.test(out)) {
    out = out.replace('</head>', '<link rel="icon" href="/favicon.ico" sizes="any"/></head>');
  }

  // 2. One publisher entity across the whole site.
  out = out.replace(/(<script[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/gi, (whole, open, body, close) => {
    // The canonical node itself is the one block that must keep its own shape.
    if (/id="hicks-organization-schema"/i.test(open)) return whole;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      // A block this pass cannot read is left exactly as it was found rather
      // than rewritten by regex, which is how JSON-LD gets corrupted.
      return whole;
    }
    return `${open}${JSON.stringify(referenceOrganization(parsed))}${close}`;
  });

  // 3. The published session fees, on the service routes only.
  if (serviceConfig.routes.includes(route) && !out.includes('id="hicks-service-offers"')) {
    const payload = `<script id="hicks-service-offers" type="application/ld+json">${JSON.stringify(serviceNodes(serviceConfig))}</script>`;
    out = out.replace('</head>', `${payload}</head>`);
  }

  // 4. The same fees where a reader can see them. A route that already states
  // every fee in its own source keeps its own words; a route that does not gets
  // the block, so no page carries a price its visible text withholds.
  if (serviceConfig.routes.includes(route) && !out.includes(`id="${FEE_BLOCK_ID}"`)
      && !statesEveryFee(out, serviceConfig)) {
    // </main> is where it reads as the last word of the page; </body> is the
    // fallback so a page with no <main> still shows the fee it claims, rather
    // than shipping an Offer no reader can check.
    const anchor = out.includes('</main>') ? '</main>' : out.includes('</body>') ? '</body>' : null;
    if (anchor) out = out.replace(anchor, `${feeBlock(serviceConfig)}${anchor}`);
  }

  return out;
}

function routeOf(dist, file) {
  const rel = path.relative(dist, file).split(path.sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel}`;
}

function normalize(dist, root) {
  const serviceConfig = JSON.parse(fs.readFileSync(path.join(root, 'data', 'entities', 'service_schema.json'), 'utf8'));
  // The same skip set injectOrganizationSchemaSitewide() uses: the admin console
  // and the client's private previews are not public pages.
  const skip = new Set(['admin', 'preview', 'assets', 'data']);
  let rewritten = 0;
  const servicePagesSeen = [];
  const feePagesSeen = [];
  const unsupportedPrices = [];

  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) && path.dirname(full) === dist) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.html')) continue;
      const html = fs.readFileSync(full, 'utf8');
      if (!html.includes('</head>')) continue;
      const route = routeOf(dist, full);
      const next = normalizeHtml(html, route, serviceConfig);
      if (next !== html) {
        fs.writeFileSync(full, next);
        rewritten++;
      }
      if (next.includes('id="hicks-service-offers"')) servicePagesSeen.push(route);
      if (next.includes(`id="${FEE_BLOCK_ID}"`)) feePagesSeen.push(route);
      if (next.includes('id="hicks-service-offers"') && !statesEveryFee(next, serviceConfig)) {
        unsupportedPrices.push(route);
      }
    }
  })(dist);

  // Rule 0: a pass that exits having done nothing is a defect, not a pass.
  if (!rewritten) throw new Error('normalize_head_and_schema: rewrote 0 pages, so it governs nothing.');
  if (!servicePagesSeen.length) throw new Error('normalize_head_and_schema: no service route received the priced Offer nodes.');
  if (!feePagesSeen.length) throw new Error('normalize_head_and_schema: no service route received the visible fee block, so the pass that is meant to make the prices readable did nothing.');
  // checklist c5: a priced Offer on a page that never shows the price is the
  // defect this pass exists to prevent, so it refuses to ship one.
  if (unsupportedPrices.length) {
    throw new Error(`normalize_head_and_schema: priced Offers on page(s) whose visible text states no fee: ${unsupportedPrices.join(', ')}`);
  }

  console.log(`head and schema: normalized ${rewritten} page(s); priced Offers on ${servicePagesSeen.length} service route(s); visible fee block on ${feePagesSeen.length}`);
}

module.exports = { normalize, referenceOrganization, isOrgNode, feeBlock, statesEveryFee, ORG_ID, OG_IMAGE, FEE_BLOCK_ID };
