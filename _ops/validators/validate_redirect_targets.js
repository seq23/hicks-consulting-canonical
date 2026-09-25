'use strict';
/**
 * REDIRECT TARGETS CONTRACT
 *
 * On 25 Sep 2026 Bing still held four Wix-era URLs as 404 on hicksconsulting.org:
 * /services, /about-8, /copy-of-services and /copy-of-corporate-and-origizational-t
 * (the last one still indexed). They now 301 to the live page on the same topic
 * through _redirects. This contract keeps that true and keeps every redirect honest:
 *
 *   1. every legacy URL Bing reported is redirected (with and without the
 *      trailing slash) with a 301;
 *   2. every rule in _redirects parses, and its target is a page that ships:
 *      a source file under pages/ that is either a sitemap route or declares
 *      itself noindex (/admin/) - a redirect into a 404 is not a fix;
 *   3. no rule points at the home page, which is a soft 404 to a search engine;
 *   4. no source is listed twice (the second rule is dead) and no source is a
 *      live sitemap route (the rule would hide a published page).
 *
 * It hard-fails if _redirects has zero rules.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const ROOT = process.cwd();

// Reported by Bing Webmaster Site Explorer on 25 Sep 2026 (E404 / I404).
const BING_LEGACY_404S = ['/services', '/about-8', '/copy-of-services', '/copy-of-corporate-and-origizational-t'];

const failures = [];
const redirectsPath = path.join(ROOT, '_redirects');
if (!fs.existsSync(redirectsPath)) fail('REDIRECT TARGETS: _redirects is missing.');

const rules = [];
fs.readFileSync(redirectsPath, 'utf8').split('\n').forEach((raw, i) => {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return;
  const parts = line.split(/\s+/);
  if (parts.length < 2 || parts.length > 3 || !parts[0].startsWith('/')) {
    failures.push(`_redirects:${i + 1}: cannot parse "${line}".`);
    return;
  }
  rules.push({ line: i + 1, from: parts[0], to: parts[1], status: parts[2] || '302' });
});
if (!rules.length) fail('REDIRECT TARGETS: _redirects has 0 rules. This check examined nothing.');

const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) fail('REDIRECT TARGETS: sitemap.xml is missing, so redirect targets cannot be checked against the public pages.');
const liveRoutes = new Set([...fs.readFileSync(sitemapPath, 'utf8').matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]));
if (!liveRoutes.size) fail('REDIRECT TARGETS: sitemap.xml lists 0 URLs.');

const pageExists = (route) => fs.existsSync(path.join(ROOT, 'pages', route.replace(/^\//, '').replace(/\/$/, ''), 'index.html'));
// A page kept out of the sitemap on purpose (the /admin/ console) says so itself.
const isNoindexPage = (route) => /<meta[^>]+name="robots"[^>]+noindex|<meta[^>]+content="[^"]*noindex[^"]*"[^>]+name="robots"/i
  .test(fs.readFileSync(path.join(ROOT, 'pages', route.replace(/^\//, '').replace(/\/$/, ''), 'index.html'), 'utf8'));
const sources = new Map();
for (const rule of rules) {
  const where = `_redirects:${rule.line} (${rule.from} -> ${rule.to})`;
  if (sources.has(rule.from)) failures.push(`${where}: source already redirected at line ${sources.get(rule.from)}; this rule is dead.`);
  sources.set(rule.from, rule.line);
  if (/^https?:\/\//.test(rule.to)) continue; // off-site targets are not ours to resolve
  if (rule.to === '/') { failures.push(`${where}: redirects to the home page, which search engines treat as a soft 404.`); continue; }
  const target = rule.to.split(/[?#]/)[0];
  if (!pageExists(target)) failures.push(`${where}: target has no source under pages/, so the redirect lands on a 404.`);
  else if (!liveRoutes.has(target) && !isNoindexPage(target)) failures.push(`${where}: target is neither a sitemap page nor a deliberately noindexed page; it is probably pruned from the build.`);
  if (liveRoutes.has(rule.from)) failures.push(`${where}: source is itself a live sitemap page; the rule would hide it.`);
}

for (const legacy of BING_LEGACY_404S) {
  for (const variant of [legacy, `${legacy}/`]) {
    const rule = rules.find((r) => r.from === variant);
    if (!rule) failures.push(`LEGACY 404: ${variant} (held by Bing as 404 on 25 Sep 2026) has no redirect.`);
    else if (rule.status !== '301') failures.push(`LEGACY 404: ${variant} redirects with ${rule.status}; a retired URL needs a 301.`);
  }
}

if (failures.length) fail([`Redirect targets contract: examined ${rules.length} rule(s) in _redirects.`, ...failures]);
console.log(`Redirect targets contract OK (${rules.length} rules in _redirects, every internal target a live or deliberately noindexed page, none to the home page, no dead or shadowing rules; the ${BING_LEGACY_404S.length} Wix-era URLs Bing held as 404 each 301 to a live page on the same topic).`);
