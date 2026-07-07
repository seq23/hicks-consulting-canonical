import { jsonResponse } from './_shared.js';

export async function onRequestGet() {
  return jsonResponse({ ok: true, coverPolicy: 'Custom cover image is preferred. If no cover image is uploaded, product cards use the uploaded PDF first-page preview when a PDF URL exists.' });
}
