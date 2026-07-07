import { jsonResponse } from './_shared.js';

export async function onRequestPost() {
  return jsonResponse({ ok: false, error: 'Use /api/digital-products/update for combined metadata and file upload.' }, 405);
}
