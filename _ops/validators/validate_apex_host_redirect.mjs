#!/usr/bin/env node
// Apex -> www, proved in code rather than asserted in prose (11 Oct 2026).
//
// Until 11 Oct 2026 https://hicksconsulting.org/<path> answered 200 with a full
// copy of every page (canonical pointing at www) and Search Console still held
// a stale apex sitemap registration. This check:
//   1. runs the real Pages worker against apex requests and requires a 301
//      (GET/HEAD) or 308 (body-carrying) to https://www.hicksconsulting.org with
//      the path and query preserved, and requires www / pages.dev to pass through;
//   2. requires every <loc> in sitemap.xml and the robots.txt Sitemap line to be
//      on www (no sitemap URL on the apex);
//   3. requires the post-deploy smoke workflow to run the live curl check;
//   4. requires gsc_sitemaps.json, once written by the collector that deletes
//      stale registrations, to list no apex or http:// sitemap.
// Hard-fails when it examined nothing.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fail } = require('../validation/protocol.js');
// worker/_worker.js is an ES module in a package without "type": "module";
// Node's reparse notice on stderr is not a finding, so it is silenced here only.
process.removeAllListeners('warning');
const worker = await import('../../worker/_worker.js');

const errors = [];
const WWW = 'https://www.hicksconsulting.org';
const cases = [
  ['GET', 'https://hicksconsulting.org/', 301, `${WWW}/`],
  ['HEAD', 'https://hicksconsulting.org/black-therapist-memphis/', 301, `${WWW}/black-therapist-memphis/`],
  ['GET', 'https://hicksconsulting.org/therapy/?ref=a&b=2', 301, `${WWW}/therapy/?ref=a&b=2`],
  ['GET', 'http://hicksconsulting.org/sitemap.xml', 301, `${WWW}/sitemap.xml`],
  ['POST', 'https://hicksconsulting.org/api/forms/contact', 308, `${WWW}/api/forms/contact`],
];
let examined = 0;
for (const [method, url, status, location] of cases) {
  examined += 1;
  const init = method === 'POST' ? { method, body: '{}' } : { method };
  const res = await worker.default.fetch(new Request(url, init), {}, {});
  if (res.status !== status) errors.push(`apex ${method} ${url}: status ${res.status}, expected ${status}`);
  if (res.headers.get('location') !== location) errors.push(`apex ${method} ${url}: location ${res.headers.get('location')}, expected ${location}`);
}
for (const url of [`${WWW}/`, 'https://hicks-consulting-canonical.pages.dev/', 'https://abc123.hicks-consulting-canonical.pages.dev/therapy/']) {
  examined += 1;
  if (worker.apexRedirect(new Request(url)) !== null) errors.push(`non-apex host redirected: ${url}`);
}

const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (!locs.length) errors.push('sitemap.xml has zero <loc> entries; nothing examined');
for (const loc of locs) if (!loc.startsWith(`${WWW}/`)) errors.push(`sitemap.xml lists a non-www URL: ${loc}`);
const robotsSitemaps = [...fs.readFileSync('robots.txt', 'utf8').matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
if (!robotsSitemaps.length) errors.push('robots.txt names no Sitemap');
for (const s of robotsSitemaps) if (!s.startsWith(`${WWW}/`)) errors.push(`robots.txt Sitemap is not on www: ${s}`);

const smoke = fs.readFileSync('.github/workflows/postdeploy-smoke.yml', 'utf8');
if (!smoke.includes('scripts/verification/check_apex_redirect.mjs')) errors.push('postdeploy-smoke.yml does not run scripts/verification/check_apex_redirect.mjs');
if (!fs.existsSync('scripts/verification/check_apex_redirect.mjs')) errors.push('scripts/verification/check_apex_redirect.mjs is missing');

const gsc = JSON.parse(fs.readFileSync('data/search_intelligence/gsc_sitemaps.json', 'utf8'));
const stale = (p) => /^http:\/\//i.test(p) || /^https?:\/\/hicksconsulting\.org\//i.test(p);
if (gsc.stale_rule) {
  const left = (gsc.sitemaps || []).map((s) => s.path).filter(stale);
  if (left.length) errors.push(`gsc_sitemaps.json still lists stale registration(s): ${left.join(', ')}`);
}

if (errors.length) fail([`Apex host redirect: ${examined} worker cases, ${locs.length} sitemap URLs examined.`, ...errors]);
console.log(`Apex host redirect OK (${cases.length} apex requests fold into www with path and query; 3 non-apex hosts pass through; ${locs.length} sitemap URLs and ${robotsSitemaps.length} robots Sitemap line(s) on www; live check wired into postdeploy-smoke; Search Console sitemaps ${gsc.stale_rule ? 'free of stale registrations' : 'pre-deletion record (collector deletes on next run)'}).`);
