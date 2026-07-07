import { jsonResponse, readCatalog } from './_shared.js';

export async function onRequestGet({ request, env }) {
  return jsonResponse(await readCatalog(request, env));
}

export async function onRequestPost({ request, env }) {
  return jsonResponse({ ok: false, error: 'Use /api/digital-products/update for product changes.' }, 405);
}
