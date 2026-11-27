#!/usr/bin/env node
// Behaviour proof for GET /api/digital-products/file/<key> (worker/_worker.js), 27 Nov 2026:
//   - a FREE product's own download is served (200, the bytes);
//   - a paid product's file is never served, by its key, an encoded key, a full URL or a key
//     planted in another product's row: 404, not one byte (Gumroad delivers it after payment);
//   - a revoked free product, an uncatalogued key and a catalog that cannot be read are 404;
//   - a product's cover image is served (the shop cards show it).
// Runs the real worker's fetch, loaded the way verify_lead_domain_setting.mjs loads it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const fileUrl = (rel) => JSON.stringify(pathToFileURL(path.resolve(rel)).href);
const workerSource = fs.readFileSync('worker/_worker.js', 'utf8')
  .replace("'./admin_runtime.mjs'", fileUrl('worker/admin_runtime.mjs'))
  .replace("'./form_guard.mjs'", fileUrl('worker/form_guard.mjs'));
const worker = (await load(workerSource)).default;

const errors = [];
const FILE = '/api/digital-products/file/';
const PAID_PDF = 'digital-products/paid-guide/source.pdf';
const FREE_PDF = 'digital-products/free-sheet/source.pdf';
const OLD_FREE_PDF = 'digital-products/old-sheet/source.pdf';
const PAID_COVER = 'digital-products/paid-guide/cover.png';
const catalog = {
  products: [
    { id: 'free-sheet', productType: 'free', status: 'published', downloadUrl: FILE + FREE_PDF, coverImageUrl: '' },
    { id: 'old-sheet', productType: 'free', status: 'revoked', downloadUrl: FILE + OLD_FREE_PDF, coverImageUrl: '' },
    // A paid product that was free once keeps its old downloadUrl (mergeDigitalProduct keeps it).
    { id: 'paid-guide', productType: 'premium', status: 'published', downloadUrl: FILE + PAID_PDF, gumroadUrl: 'https://example.gumroad.com/l/x', coverImageUrl: FILE + PAID_COVER },
    // A forged row pointing a "free" product at the paid file.
    { id: 'sneaky', productType: 'free', status: 'published', downloadUrl: FILE + PAID_PDF, coverImageUrl: '' },
  ],
};
const bytes = { [PAID_PDF]: 'PAID-PDF-BYTES', [FREE_PDF]: 'FREE-PDF-BYTES', [OLD_FREE_PDF]: 'OLD-PDF-BYTES', [PAID_COVER]: 'COVER-BYTES' };
const r2 = {
  async get(key) {
    if (!(key in bytes)) return null;
    return { body: bytes[key], httpEtag: '"e"', writeHttpMetadata(h) { h.set('content-type', key.endsWith('.pdf') ? 'application/pdf' : 'image/png'); } };
  },
};
const kv = (value) => ({ async get() { if (value instanceof Error) throw value; return value; }, async put() {} });
const assets = (seed) => ({ async fetch() { return seed ? new Response(JSON.stringify(seed), { status: 200 }) : new Response('no', { status: 404 }); } });
const env = { DIGITAL_PRODUCTS_KV: kv(catalog), DIGITAL_PRODUCT_FILES: r2, ASSETS: assets(null) };
const get = async (target, e = env) => {
  const res = await worker.fetch(new Request(`https://www.hicksconsulting.org${target}`), e, {});
  return { status: res.status, text: await res.text() };
};
const expect = async (target, status, why, e) => {
  const r = await get(target, e);
  if (r.status !== status) errors.push(`${why}: ${target} → ${r.status}, expected ${status}`);
  if (status !== 200 && /PDF-BYTES|COVER-BYTES/.test(r.text)) errors.push(`${why}: ${target} leaked file bytes`);
  return r;
};

const free = await expect(FILE + FREE_PDF, 200, 'a free product download is served');
if (free.text !== 'FREE-PDF-BYTES') errors.push('the free download is not its own bytes');
await expect(FILE + PAID_PDF, 404, 'a paid product file by its key');
await expect(FILE + encodeURIComponent(PAID_PDF), 404, 'a paid product file by an encoded key');
await expect(FILE + 'digital-products/paid-guide/source.PDF', 404, 'a paid product file in another case');
await expect(FILE + 'digital-products/paid-guide/source.docx', 404, 'any other file in a paid product folder');
await expect(FILE + OLD_FREE_PDF, 404, 'a revoked free product');
await expect(FILE + 'digital-products/unknown/source.pdf', 404, 'an uncatalogued key');
await expect(FILE + '%E0%A4%A', 400, 'a malformed key is a plain 400, never a 500');
const cover = await expect(FILE + PAID_COVER, 200, 'a product cover is served');
if (cover.text !== 'COVER-BYTES') errors.push('the cover is not its own bytes');
// Outage: the catalog store throws and the seed cannot be read → refused, never served.
await expect(FILE + FREE_PDF, 404, 'catalog unreadable (KV throws, no seed)', { ...env, DIGITAL_PRODUCTS_KV: kv(new Error('KV down')) });
await expect(FILE + PAID_PDF, 404, 'catalog unreadable, paid file', { ...env, DIGITAL_PRODUCTS_KV: kv(new Error('KV down')) });
// The catalog route a stranger reads still lists products (the shop page needs it).
const list = await get('/api/digital-products');
if (list.status !== 200 || !list.text.includes('paid-guide')) errors.push(`GET /api/digital-products → ${list.status}`);
// The old Pages Functions copy of this route (open to every key) is gone, so it cannot come back.
if (fs.existsSync('functions/api/digital-products/file')) errors.push('functions/api/digital-products/file still exists (an open copy of the file route)');

if (errors.length) {
  console.error(`Digital product file route FAILED:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('Digital product file route OK (free download 200, paid file 404 by key, encoded key, case and planted row, revoked 404, unreadable catalog 404, cover 200).');
