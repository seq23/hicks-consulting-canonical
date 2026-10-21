#!/usr/bin/env node
// Edge cache for static HTML, proved by running the real worker (21 Oct 2026).
//
// Until 21 Oct 2026 every page went worker -> env.ASSETS on every request:
// cf-cache-status DYNAMIC, 200-320 ms TTFB, three Ahrefs "Slow page" findings.
// worker/_worker.js now keeps static GET/HEAD responses on www in the colo cache,
// keyed by a build id the build stamps in. This check drives the worker with a
// fake cache and a fake ASSETS binding and requires:
//   1. a www page: first request MISS (one ASSETS fetch), second HIT (no fetch),
//      browser Cache-Control unchanged from the origin's;
//   2. HEAD served from cache with no body;
//   3. never cached: /api/*, /admin*, /agency*, /preview*, form routes, POST,
//      query strings, non-200 responses; the apex still 301s to www first;
//   4. the cache key carries BUILD_ID, and a built dist/_worker.js has it stamped
//      (no placeholder left) when a build is present.
// Hard-fails when it examined nothing.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fail } = require('../validation/protocol.js');
process.removeAllListeners('warning');
const worker = await import('../../worker/_worker.js');

const errors = [];
let examined = 0;
const WWW = 'https://www.hicksconsulting.org';

function harness(status = 200) {
  const store = new Map();
  const cache = {
    async match(req) { const r = store.get(req.url); return r ? r.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); }
  };
  let fetches = 0;
  const env = { ASSETS: { async fetch() { fetches++; return new Response('<html>page</html>', { status, headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0, must-revalidate' } }); } } };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  return { store, cache, env, ctx, pending, get fetches() { return fetches; } };
}

// 1 + 2: MISS then HIT, browser cache-control preserved, HEAD from cache.
{
  examined++;
  const h = harness();
  const req = () => new Request(`${WWW}/therapy/`);
  const first = await worker.serveStatic(req(), h.env, h.ctx, h.cache);
  await Promise.all(h.pending);
  const second = await worker.serveStatic(req(), h.env, h.ctx, h.cache);
  const head = await worker.serveStatic(new Request(`${WWW}/therapy/`, { method: 'HEAD' }), h.env, h.ctx, h.cache);
  if (first.headers.get('x-edge-cache') !== 'MISS') errors.push(`first request x-edge-cache=${first.headers.get('x-edge-cache')}, expected MISS`);
  if (second.headers.get('x-edge-cache') !== 'HIT') errors.push(`second request x-edge-cache=${second.headers.get('x-edge-cache')}, expected HIT`);
  if (h.fetches !== 1) errors.push(`ASSETS fetched ${h.fetches} times for MISS+HIT+HEAD, expected 1`);
  for (const [name, res] of [['MISS', first], ['HIT', second], ['HEAD', head]]) {
    if (res.headers.get('cache-control') !== 'public, max-age=0, must-revalidate') errors.push(`${name} browser cache-control is "${res.headers.get('cache-control')}", expected the origin's`);
    if (res.headers.has('x-origin-cache-control')) errors.push(`${name} leaks x-origin-cache-control`);
  }
  if ((await second.text()) !== '<html>page</html>') errors.push('HIT body differs from the origin body');
  if (head.body !== null) errors.push('HEAD from cache carries a body');
  const keys = [...h.store.keys()];
  if (keys.length !== 1 || !keys[0].includes(`__build=${worker.BUILD_ID}`)) errors.push(`cache key ${keys[0]} does not carry BUILD_ID`);
}

// 3: never cached.
const never = [
  ['GET', `${WWW}/api/digital-products`],
  ['GET', `${WWW}/admin/`],
  ['GET', `${WWW}/agency/`],
  ['GET', `${WWW}/preview/x/`],
  ['POST', `${WWW}/therapy/`],
  ['GET', `${WWW}/therapy/?utm_source=x`],
  ['GET', 'https://hicks-consulting-canonical.pages.dev/therapy/'],
];
for (const [method, url] of never) {
  examined++;
  if (worker.isEdgeCacheable(new Request(url, { method, body: method === 'POST' ? '{}' : undefined }))) errors.push(`${method} ${url} is edge-cacheable; it must not be`);
}
{
  examined++;
  const h = harness(404);
  await worker.serveStatic(new Request(`${WWW}/nope/`), h.env, h.ctx, h.cache);
  await Promise.all(h.pending);
  if (h.store.size) errors.push('a 404 response was stored in the edge cache');
}
{
  examined++;
  const res = await worker.default.fetch(new Request('https://hicksconsulting.org/therapy/'), {}, {});
  if (res.status !== 301 || res.headers.get('location') !== `${WWW}/therapy/`) errors.push(`apex no longer 301s to www before caching (status ${res.status})`);
}
{
  examined++;
  const src = fs.readFileSync('worker/_worker.js', 'utf8');
  if (!src.includes("return await serveStatic(request, env, ctx)")) errors.push('worker fetch handler no longer routes static requests through serveStatic');
}

// 4: stamped build id in a built worker.
if (fs.existsSync('dist/_worker.js')) {
  examined++;
  const built = fs.readFileSync('dist/_worker.js', 'utf8');
  if (built.includes("'__HICKS_BUILD_ID__'")) errors.push('dist/_worker.js still carries the __HICKS_BUILD_ID__ placeholder; a deploy would reuse the previous build cache');
  if (!/export const BUILD_ID = '[0-9a-f]{16}'/.test(built)) errors.push('dist/_worker.js BUILD_ID is not a 16-hex build hash');
}

if (!examined) errors.push('edge cache contract examined nothing');
if (errors.length) fail(['Edge cache contract failed:', ...errors.map((e) => `- ${e}`)]);
console.log(`Edge cache contract OK (${examined} cases: MISS->HIT on www, origin browser Cache-Control kept, API/admin/forms/POST/query/non-200 never cached, apex 301 first, build id stamped).`);
