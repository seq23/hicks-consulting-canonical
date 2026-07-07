import { jsonResponse } from '../_shared.js';

export async function onRequestGet({ params, env }) {
  if (!env.DIGITAL_PRODUCT_FILES || typeof env.DIGITAL_PRODUCT_FILES.get !== 'function') {
    return jsonResponse({ ok: false, error: 'DIGITAL_PRODUCT_FILES R2 binding is not configured.' }, 503);
  }
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const key = parts.join('/');
  if (!key) return jsonResponse({ ok: false, error: 'Missing file key.' }, 400);
  const object = await env.DIGITAL_PRODUCT_FILES.get(key);
  if (!object) return jsonResponse({ ok: false, error: 'File not found.' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=3600');
  return new Response(object.body, { headers });
}
