import { jsonResponse, productFromForm, readCatalog, requireAdmin, upsertProduct, validateProductForPublication, writeCatalog } from './_shared.js';

export async function onRequestPost({ request, env }) {
  const auth = requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const product = await productFromForm(request, env);
    const publicationError = validateProductForPublication(product);
    if (publicationError) return jsonResponse({ ok: false, error: publicationError }, 400);
    const catalog = await readCatalog(request, env);
    const nextCatalog = upsertProduct(catalog, product);
    const write = await writeCatalog(env, nextCatalog);
    if (!write.ok) return write.response;
    return jsonResponse({ ok: true, products: nextCatalog.products, product });
  } catch (error) {
    return jsonResponse({ ok: false, error: error && error.message ? error.message : 'Digital product update failed.' }, 400);
  }
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
}
