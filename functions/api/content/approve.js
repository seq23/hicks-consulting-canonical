import { decide, jsonResponse } from './_shared.js';

export async function onRequestPost({ request, env }) {
  return decide(request, env, 'approve');
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
}
