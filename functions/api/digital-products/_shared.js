const SEED_CATALOG_URL = '/data/products/digital_products.json';
const KV_KEY = 'digital_products_catalog_v1';
const ALLOWED_TYPES = new Set(['free', 'premium']);
const ALLOWED_STATUSES = new Set(['draft', 'ready_for_approval', 'published', 'revoked']);

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export function clean(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function slugify(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

export function requireAdmin(request, env) {
  const expected = env.DIGITAL_PRODUCTS_ADMIN_TOKEN;
  if (!expected) return { ok: false, response: jsonResponse({ ok: false, error: 'Digital products admin token is not configured.' }, 503) };
  const actual = request.headers.get('x-admin-token') || '';
  if (actual !== expected) return { ok: false, response: jsonResponse({ ok: false, error: 'Digital products admin token did not match.' }, 401) };
  return { ok: true };
}

async function readSeedCatalog(request) {
  const url = new URL(SEED_CATALOG_URL, request.url);
  const res = await fetch(url.toString()).catch(() => null);
  if (!res || !res.ok) return { schemaVersion: '1.0.0', products: [] };
  return res.json().catch(() => ({ schemaVersion: '1.0.0', products: [] }));
}

export async function readCatalog(request, env) {
  if (env.DIGITAL_PRODUCTS_KV && typeof env.DIGITAL_PRODUCTS_KV.get === 'function') {
    const stored = await env.DIGITAL_PRODUCTS_KV.get(KV_KEY, 'json').catch(() => null);
    if (stored && Array.isArray(stored.products)) return { ...stored, apiConfigured: true };
  }
  const seed = await readSeedCatalog(request);
  return { ...seed, apiConfigured: Boolean(env.DIGITAL_PRODUCTS_KV) };
}

export async function writeCatalog(env, catalog) {
  if (!env.DIGITAL_PRODUCTS_KV || typeof env.DIGITAL_PRODUCTS_KV.put !== 'function') {
    return { ok: false, response: jsonResponse({ ok: false, error: 'DIGITAL_PRODUCTS_KV binding is required before product changes can persist.' }, 503) };
  }
  await env.DIGITAL_PRODUCTS_KV.put(KV_KEY, JSON.stringify(catalog, null, 2));
  return { ok: true };
}

async function uploadFile(env, file, keyPrefix) {
  if (!file || typeof file.name !== 'string' || file.size === 0) return '';
  if (!env.DIGITAL_PRODUCT_FILES || typeof env.DIGITAL_PRODUCT_FILES.put !== 'function') {
    throw new Error('DIGITAL_PRODUCT_FILES R2 binding is required before file uploads can persist.');
  }
  const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'bin';
  const key = `${keyPrefix}.${extension}`;
  await env.DIGITAL_PRODUCT_FILES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' }
  });
  const publicBase = clean(env.DIGITAL_PRODUCT_FILES_PUBLIC_BASE_URL || '');
  return publicBase ? `${publicBase.replace(/\/$/, '')}/${key}` : `/api/digital-products/file/${key}`;
}

export async function productFromForm(request, env) {
  const form = await request.formData();
  const id = slugify(form.get('id') || form.get('title'));
  const productType = clean(form.get('productType'));
  const status = clean(form.get('status')) || 'draft';
  if (!id) throw new Error('Product ID or title is required.');
  if (!ALLOWED_TYPES.has(productType)) throw new Error('Product type must be free or premium.');
  if (!ALLOWED_STATUSES.has(status)) throw new Error('Invalid product status.');

  const pdf = form.get('pdf');
  const cover = form.get('cover');
  const pdfUrl = await uploadFile(env, pdf, `digital-products/${id}/source`);
  const coverUrl = await uploadFile(env, cover, `digital-products/${id}/cover`);
  const gumroadUrl = clean(form.get('gumroadUrl'));
  const priceLabel = clean(form.get('priceLabel')) || (productType === 'free' ? 'Free' : '$10');
  const checkoutStatus = productType === 'premium'
    ? (gumroadUrl && gumroadUrl !== 'https://www.gumroad.com' ? (status === 'published' ? 'live' : 'ready') : 'placeholder')
    : 'not_applicable';

  return {
    id,
    title: clean(form.get('title')),
    productType,
    status,
    featured: form.get('featured') === 'on' || form.get('featured') === 'true',
    description: clean(form.get('description')),
    category: clean(form.get('category')) || (productType === 'premium' ? 'workbook' : 'worksheet'),
    downloadUrl: productType === 'free' ? pdfUrl : '',
    gumroadUrl: productType === 'premium' ? gumroadUrl : '',
    priceLabel,
    buttonLabel: productType === 'premium' ? `Buy on Gumroad - ${priceLabel}` : 'Download free resource',
    coverImageUrl: coverUrl,
    coverSource: coverUrl ? 'custom_image' : (pdfUrl ? 'pdf_first_page' : 'branded_placeholder'),
    checkoutStatus,
    publishedAt: status === 'published' ? new Date().toISOString().slice(0, 10) : ''
  };
}

export function validateProductForPublication(product) {
  if (product.status !== 'published') return null;
  if (!product.title || !product.description) return 'Published products require title and description.';
  if (product.productType === 'free' && !product.downloadUrl) return 'Published free downloads require a PDF download URL.';
  if (product.productType === 'premium') {
    if (!product.gumroadUrl) return 'Published premium downloads require a Gumroad URL.';
    if (product.gumroadUrl === 'https://www.gumroad.com') return 'Published premium downloads may not use the Gumroad placeholder URL.';
    if (product.checkoutStatus !== 'live') return 'Published premium downloads require live checkout status.';
    if (!product.priceLabel) return 'Published premium downloads require a price label.';
  }
  return null;
}

export function mergeProduct(existing, incoming) {
  const merged = { ...(existing || {}), ...incoming };
  if (!incoming.downloadUrl && existing && existing.downloadUrl) merged.downloadUrl = existing.downloadUrl;
  if (!incoming.coverImageUrl && existing && existing.coverImageUrl) merged.coverImageUrl = existing.coverImageUrl;
  if ((!incoming.coverSource || incoming.coverSource === 'branded_placeholder') && existing && existing.coverSource && existing.coverSource !== 'branded_placeholder') merged.coverSource = existing.coverSource;
  if (merged.productType === 'premium' && merged.status === 'published' && merged.gumroadUrl && merged.gumroadUrl !== 'https://www.gumroad.com') merged.checkoutStatus = 'live';
  if (merged.productType === 'premium') merged.buttonLabel = `Buy on Gumroad - ${merged.priceLabel || '$10'}`;
  if (merged.productType === 'free') merged.buttonLabel = merged.buttonLabel || 'Download free resource';
  return merged;
}

export function upsertProduct(catalog, product) {
  const products = Array.isArray(catalog.products) ? catalog.products.slice() : [];
  if (product.featured) {
    for (const item of products) {
      if (item.productType === product.productType) item.featured = false;
    }
  }
  const index = products.findIndex((item) => item.id === product.id);
  if (index >= 0) products[index] = mergeProduct(products[index], product);
  else products.push(mergeProduct(null, product));
  return { ...catalog, updatedAt: new Date().toISOString(), products };
}
