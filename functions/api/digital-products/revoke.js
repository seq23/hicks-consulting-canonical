import { jsonResponse, readCatalog, requireAdmin, validateProductForPublication, writeCatalog } from './_shared.js';

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const incoming = await request.json().catch(() => ({}));
  const id = String(incoming.id || '').trim();
  if (!id) return jsonResponse({ ok: false, error: 'Product ID is required.' }, 400);
  const catalog = await readCatalog(request, env);
  const products = (catalog.products || []).map((item) => item.id === id ? { ...item, status: 'revoked', publishedAt: 'revoked' === 'published' ? new Date().toISOString().slice(0, 10) : item.publishedAt } : item);
  const product = products.find((item) => item.id === id);
  if (!product) return jsonResponse({ ok: false, error: 'Product not found.' }, 404);
  const publicationError = validateProductForPublication(product);
  if (publicationError) return jsonResponse({ ok: false, error: publicationError }, 400);
  const nextCatalog = { ...catalog, updatedAt: new Date().toISOString(), products };
  const write = await writeCatalog(env, nextCatalog);
  if (!write.ok) return write.response;
  return jsonResponse({ ok: true, products });
}
