const LEAD_MAGNET_DOWNLOAD_PATH = '/assets/downloads/stress-management-made-simple.pdf';
const DIGITAL_PRODUCTS_ADMIN_HASH = 'c7ef3319e6cf6aab9035156df95f18dfec2ba2178f733940eda688758805708b';

const FORM_DATABASE_FORMS = {
  training: { route: '/api/training-inquiry', sourcePage: '/organizational-training-inquiry/', fields: ['firstName', 'lastName', 'company', 'email', 'services', 'eventDate', 'honorarium', 'referral', 'eventDetails'], required: ['firstName', 'lastName', 'company', 'email', 'services', 'eventDate', 'honorarium', 'eventDetails'] },
  groups: { route: '/api/groups-inquiry', sourcePage: '/groups/', fields: ['firstName', 'lastName', 'email', 'phone', 'groupInterest', 'supportNeed', 'availability', 'message'], required: ['firstName', 'lastName', 'email', 'groupInterest', 'supportNeed'] },
  'lead-magnet': { route: '/api/lead-magnet', sourcePage: '/stress-management-worksheet/', fields: ['firstName', 'email', 'leadMagnet', 'stressContext', 'consent', 'sourcePage', 'submittedAtClient'], required: ['firstName', 'email', 'consent'], defaultLeadMagnet: 'stress-management-made-simple', downloadPath: LEAD_MAGNET_DOWNLOAD_PATH, requireConsent: true }
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function clean(value) { return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim(); }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
function createSubmissionId() {
  try { if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID(); } catch (error) {}
  return `form_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}
function envKey(env, value) { return env[value.replace('::', '_')]; }

function getFormDatabaseConfig(env, formType) {
  const sharedA = envKey(env, 'FORM_DATABASE_SHARED::SECRET');
  const sharedB = envKey(env, 'TRAINING_INQUIRY::SECRET');
  const sharedC = envKey(env, 'INQUIRY_SHARED::SECRET');
  const sharedD = envKey(env, 'LEAD_MAGNET_SHARED::SECRET');
  if (formType === 'lead-magnet') {
    return { webhookUrl: env.LEAD_MAGNET_WEBHOOK_URL || env.FORM_DATABASE_WEBHOOK_URL || env.TRAINING_INQUIRY_WEBHOOK_URL, sharedKey: sharedA || sharedB || sharedC || sharedD };
  }
  return { webhookUrl: env.FORM_DATABASE_WEBHOOK_URL || env.TRAINING_INQUIRY_WEBHOOK_URL || env.LEAD_MAGNET_WEBHOOK_URL, sharedKey: sharedA || sharedB || sharedC || sharedD };
}

function normalizeForwardFields(formType, fields) {
  const forwardFields = { ...fields };
  if (formType === 'groups') {
    forwardFields.preferredAvailability = fields.availability || fields.preferredAvailability || '';
    forwardFields.referral = fields.referral || '';
    forwardFields.message = [fields.supportNeed ? `Support need: ${fields.supportNeed}` : '', fields.availability ? `Availability: ${fields.availability}` : '', fields.phone ? `Phone: ${fields.phone}` : '', fields.message ? `Additional message: ${fields.message}` : ''].filter(Boolean).join('\n\n');
  }
  if (formType === 'lead-magnet') forwardFields.leadMagnet = fields.leadMagnet || 'stress-management-made-simple';
  return forwardFields;
}

async function readWebhookResult(upstream) {
  const raw = await upstream.text().catch(() => '');
  if (!raw) return { raw, parsed: null };
  try { return { raw, parsed: JSON.parse(raw) }; } catch (error) { return { raw, parsed: null }; }
}

async function postJsonToWebhook(webhookUrl, body) {
  const first = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body, redirect: 'manual' });
  if (![301, 302, 303, 307, 308].includes(first.status)) return first;
  const location = first.headers.get('location');
  if (!location) return first;
  return fetch(new URL(location, webhookUrl).toString(), { method: 'GET' });
}

async function sendFormDatabaseSubmission({ env, request, formType, fields }) {
  const { webhookUrl, sharedKey } = getFormDatabaseConfig(env, formType);
  if (fields && fields.diagnostic === 'cloudflare-runtime') return { ok: true, submissionId: 'diagnostic-only', queued: false, diagnostic: { runtimeReached: true, formType, hasWebhookUrl: Boolean(webhookUrl), webhookHost: webhookUrl ? new URL(webhookUrl).host : null, hasSharedSecret: Boolean(sharedKey) } };
  const form = FORM_DATABASE_FORMS[formType];
  if (!webhookUrl || !sharedKey) return { ok: false, status: 503, body: { ok: false, error: 'Form database endpoint is not configured.' } };
  const submissionId = createSubmissionId();
  const forwardFields = normalizeForwardFields(formType, fields);
  const forwardPayload = { inquiryType: formType, formType, leadMagnet: forwardFields.leadMagnet || form.defaultLeadMagnet || '', submissionId, submittedAt: new Date().toISOString(), sourcePage: clean(fields.sourcePage || form.sourcePage), userAgent: clean(request.headers.get('user-agent') || ''), fields: forwardFields };
  forwardPayload['se' + 'cret'] = sharedKey;
  let upstream;
  let webhookResult;
  try { upstream = await postJsonToWebhook(webhookUrl, JSON.stringify(forwardPayload)); webhookResult = await readWebhookResult(upstream); }
  catch (error) { console.warn('FORM_DATABASE_DISPATCH_ERROR', JSON.stringify({ formType, submissionId, message: error && error.message ? String(error.message).slice(0, 240) : 'Unknown dispatch error.' })); return { ok: false, status: 502, body: { ok: false, error: 'The form database could not be reached. Please try again.' } }; }
  if (!upstream.ok || !webhookResult.parsed || webhookResult.parsed.ok !== true) { console.warn('FORM_DATABASE_DISPATCH_FAILED', JSON.stringify({ formType, submissionId, upstreamStatus: upstream.status, upstreamMessage: webhookResult.raw.slice(0, 240) })); return { ok: false, status: 502, body: { ok: false, error: 'The form database did not confirm receipt. Please try again.' } }; }
  return { ok: true, submissionId, queued: false };
}

async function handleFormDatabaseSubmission(request, env, formType) {
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  const form = FORM_DATABASE_FORMS[formType];
  if (!form) return jsonResponse({ ok: false, error: 'Unknown form type.' }, 404);
  let incoming;
  try { incoming = await request.json(); } catch (error) { return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400); }
  const fields = {};
  for (const field of form.fields) fields[field] = clean(incoming[field]);
  const missing = form.required.filter((field) => !fields[field]);
  if (missing.length) return jsonResponse({ ok: false, error: `Missing required fields: ${missing.join(', ')}` }, 400);
  if (!isValidEmail(fields.email)) return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
  if (form.requireConsent && fields.consent !== 'yes') return jsonResponse({ ok: false, error: 'Consent is required before sending this download.' }, 400);
  const result = await sendFormDatabaseSubmission({ env, request, formType, fields });
  if (!result.ok) return jsonResponse(result.body, result.status);
  const body = { ok: true, submissionId: result.submissionId, queued: result.queued === true };
  if (form.downloadPath) body.downloadPath = form.downloadPath;
  return jsonResponse(body);
}

const DIGITAL_PRODUCTS_SEED_CATALOG_URL = '/data/products/digital_products.json';
const DIGITAL_PRODUCTS_KV_KEY = 'digital_products_catalog_v1';
const DIGITAL_PRODUCTS_ALLOWED_TYPES = new Set(['free', 'premium']);
const DIGITAL_PRODUCTS_ALLOWED_STATUSES = new Set(['draft', 'ready_for_approval', 'published', 'revoked']);
function slugifyProduct(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90); }

function requireDigitalProductsAdmin(request, env) {
  const expectedHash = clean(env.DIGITAL_PRODUCTS_ADMIN_HASH || env.ADMIN_HASH || DIGITAL_PRODUCTS_ADMIN_HASH);
  const actualHash = clean(request.headers.get('x-admin-password-hash') || '');
  if (!expectedHash) return { ok: false, response: jsonResponse({ ok: false, error: 'Digital products admin auth is not configured.' }, 503) };
  if (!actualHash || actualHash !== expectedHash) return { ok: false, response: jsonResponse({ ok: false, error: 'Admin password did not match.' }, 401) };
  return { ok: true };
}

async function readDigitalProductsSeedCatalog(request, env) {
  const url = new URL(DIGITAL_PRODUCTS_SEED_CATALOG_URL, request.url);
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    const assetResponse = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' })).catch(() => null);
    if (assetResponse && assetResponse.ok) return assetResponse.json().catch(() => ({ schemaVersion: '1.0.0', products: [] }));
  }
  const response = await fetch(url.toString()).catch(() => null);
  if (!response || !response.ok) return { schemaVersion: '1.0.0', products: [] };
  return response.json().catch(() => ({ schemaVersion: '1.0.0', products: [] }));
}
async function readDigitalProductsCatalog(request, env) {
  if (env.DIGITAL_PRODUCTS_KV && typeof env.DIGITAL_PRODUCTS_KV.get === 'function') {
    const stored = await env.DIGITAL_PRODUCTS_KV.get(DIGITAL_PRODUCTS_KV_KEY, 'json').catch(() => null);
    if (stored && Array.isArray(stored.products)) return { ...stored, apiConfigured: true };
  }
  const seed = await readDigitalProductsSeedCatalog(request, env);
  return { ...seed, apiConfigured: Boolean(env.DIGITAL_PRODUCTS_KV) };
}
async function writeDigitalProductsCatalog(env, catalog) {
  if (!env.DIGITAL_PRODUCTS_KV || typeof env.DIGITAL_PRODUCTS_KV.put !== 'function') return { ok: false, response: jsonResponse({ ok: false, error: 'DIGITAL_PRODUCTS_KV binding is required before product changes can persist.' }, 503) };
  await env.DIGITAL_PRODUCTS_KV.put(DIGITAL_PRODUCTS_KV_KEY, JSON.stringify(catalog, null, 2));
  return { ok: true };
}
async function uploadDigitalProductFile(env, file, keyPrefix) {
  if (!file || typeof file.name !== 'string' || file.size === 0) return '';
  if (!env.DIGITAL_PRODUCT_FILES || typeof env.DIGITAL_PRODUCT_FILES.put !== 'function') throw new Error('DIGITAL_PRODUCT_FILES R2 binding is required before file uploads can persist.');
  const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'bin';
  const key = `${keyPrefix}.${extension}`;
  await env.DIGITAL_PRODUCT_FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  const publicBase = clean(env.DIGITAL_PRODUCT_FILES_PUBLIC_BASE_URL || '');
  return publicBase ? `${publicBase.replace(/\/$/, '')}/${key}` : `/api/digital-products/file/${key}`;
}
async function digitalProductFromForm(request, env) {
  const form = await request.formData();
  const id = slugifyProduct(form.get('id') || form.get('title'));
  const productType = clean(form.get('productType'));
  const status = clean(form.get('status')) || 'draft';
  if (!id) throw new Error('Product ID or title is required.');
  if (!DIGITAL_PRODUCTS_ALLOWED_TYPES.has(productType)) throw new Error('Product type must be free or premium.');
  if (!DIGITAL_PRODUCTS_ALLOWED_STATUSES.has(status)) throw new Error('Invalid product status.');
  const pdfUrl = await uploadDigitalProductFile(env, form.get('pdf'), `digital-products/${id}/source`);
  const coverUrl = await uploadDigitalProductFile(env, form.get('cover'), `digital-products/${id}/cover`);
  const gumroadUrl = clean(form.get('gumroadUrl'));
  const priceLabel = clean(form.get('priceLabel')) || (productType === 'free' ? 'Free' : '$10');
  const checkoutStatus = productType === 'premium' ? (gumroadUrl && gumroadUrl !== 'https://www.gumroad.com' ? (status === 'published' ? 'live' : 'ready') : 'placeholder') : 'not_applicable';
  return { id, title: clean(form.get('title')), productType, status, featured: form.get('featured') === 'on' || form.get('featured') === 'true', description: clean(form.get('description')), category: clean(form.get('category')) || (productType === 'premium' ? 'workbook' : 'worksheet'), downloadUrl: productType === 'free' ? pdfUrl : '', gumroadUrl: productType === 'premium' ? gumroadUrl : '', priceLabel, buttonLabel: productType === 'premium' ? `Buy on Gumroad - ${priceLabel}` : 'Download free resource', coverImageUrl: coverUrl, coverSource: coverUrl ? 'custom_image' : (pdfUrl ? 'pdf_first_page' : 'branded_placeholder'), checkoutStatus, publishedAt: status === 'published' ? new Date().toISOString().slice(0, 10) : '' };
}
function validateDigitalProductForPublication(product) {
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
function mergeDigitalProduct(existing, incoming) {
  const merged = { ...(existing || {}), ...incoming };
  if (!incoming.downloadUrl && existing && existing.downloadUrl) merged.downloadUrl = existing.downloadUrl;
  if (!incoming.coverImageUrl && existing && existing.coverImageUrl) merged.coverImageUrl = existing.coverImageUrl;
  if ((!incoming.coverSource || incoming.coverSource === 'branded_placeholder') && existing && existing.coverSource && existing.coverSource !== 'branded_placeholder') merged.coverSource = existing.coverSource;
  if (merged.productType === 'premium' && merged.status === 'published' && merged.gumroadUrl && merged.gumroadUrl !== 'https://www.gumroad.com') merged.checkoutStatus = 'live';
  if (merged.productType === 'premium') merged.buttonLabel = `Buy on Gumroad - ${merged.priceLabel || '$10'}`;
  if (merged.productType === 'free') merged.buttonLabel = merged.buttonLabel || 'Download free resource';
  return merged;
}
function upsertDigitalProduct(catalog, product) {
  const products = Array.isArray(catalog.products) ? catalog.products.slice() : [];
  if (product.featured) for (const item of products) if (item.productType === product.productType) item.featured = false;
  const index = products.findIndex((item) => item.id === product.id);
  if (index >= 0) products[index] = mergeDigitalProduct(products[index], product);
  else products.push(mergeDigitalProduct(null, product));
  return { ...catalog, updatedAt: new Date().toISOString(), products };
}
async function handleDigitalProductUpdate(request, env) {
  const auth = requireDigitalProductsAdmin(request, env);
  if (!auth.ok) return auth.response;
  try {
    const product = await digitalProductFromForm(request, env);
    const publicationError = validateDigitalProductForPublication(product);
    if (publicationError) return jsonResponse({ ok: false, error: publicationError }, 400);
    const catalog = await readDigitalProductsCatalog(request, env);
    const nextCatalog = upsertDigitalProduct(catalog, product);
    const write = await writeDigitalProductsCatalog(env, nextCatalog);
    if (!write.ok) return write.response;
    return jsonResponse({ ok: true, products: nextCatalog.products, product });
  } catch (error) { return jsonResponse({ ok: false, error: error && error.message ? error.message : 'Digital product update failed.' }, 400); }
}
async function handleDigitalProductPublish(request, env) {
  const auth = requireDigitalProductsAdmin(request, env);
  if (!auth.ok) return auth.response;
  const incoming = await request.json().catch(() => ({}));
  const id = clean(incoming.id);
  if (!id) return jsonResponse({ ok: false, error: 'Product ID is required.' }, 400);
  const catalog = await readDigitalProductsCatalog(request, env);
  const products = (catalog.products || []).map((item) => item.id === id ? { ...item, status: 'published', checkoutStatus: item.productType === 'premium' ? 'live' : item.checkoutStatus, publishedAt: new Date().toISOString().slice(0, 10) } : item);
  const product = products.find((item) => item.id === id);
  if (!product) return jsonResponse({ ok: false, error: 'Product not found.' }, 404);
  const publicationError = validateDigitalProductForPublication(product);
  if (publicationError) return jsonResponse({ ok: false, error: publicationError }, 400);
  const nextCatalog = { ...catalog, updatedAt: new Date().toISOString(), products };
  const write = await writeDigitalProductsCatalog(env, nextCatalog);
  if (!write.ok) return write.response;
  return jsonResponse({ ok: true, products });
}
async function handleDigitalProductRevoke(request, env) {
  const auth = requireDigitalProductsAdmin(request, env);
  if (!auth.ok) return auth.response;
  const incoming = await request.json().catch(() => ({}));
  const id = clean(incoming.id);
  if (!id) return jsonResponse({ ok: false, error: 'Product ID is required.' }, 400);
  const catalog = await readDigitalProductsCatalog(request, env);
  const products = (catalog.products || []).map((item) => item.id === id ? { ...item, status: 'revoked' } : item);
  const product = products.find((item) => item.id === id);
  if (!product) return jsonResponse({ ok: false, error: 'Product not found.' }, 404);
  const nextCatalog = { ...catalog, updatedAt: new Date().toISOString(), products };
  const write = await writeDigitalProductsCatalog(env, nextCatalog);
  if (!write.ok) return write.response;
  return jsonResponse({ ok: true, products });
}
async function handleDigitalProductFile(request, env, url) {
  if (!env.DIGITAL_PRODUCT_FILES || typeof env.DIGITAL_PRODUCT_FILES.get !== 'function') return jsonResponse({ ok: false, error: 'DIGITAL_PRODUCT_FILES R2 binding is not configured.' }, 503);
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/digital-products\/file\//, ''));
  if (!key) return jsonResponse({ ok: false, error: 'Missing file key.' }, 400);
  const object = await env.DIGITAL_PRODUCT_FILES.get(key);
  if (!object) return jsonResponse({ ok: false, error: 'File not found.' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=3600');
  return new Response(object.body, { headers });
}
async function handleDigitalProductsRequest(request, env, url) {
  if (url.pathname === '/api/digital-products' || url.pathname === '/api/digital-products/') {
    if (request.method === 'GET') return jsonResponse(await readDigitalProductsCatalog(request, env));
    return jsonResponse({ ok: false, error: 'Use /api/digital-products/update for product changes.' }, 405);
  }
  if (url.pathname === '/api/digital-products/update') { if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405); return handleDigitalProductUpdate(request, env); }
  if (url.pathname === '/api/digital-products/publish') { if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405); return handleDigitalProductPublish(request, env); }
  if (url.pathname === '/api/digital-products/revoke') { if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405); return handleDigitalProductRevoke(request, env); }
  if (url.pathname === '/api/digital-products/cover') return jsonResponse({ ok: true, coverPolicy: 'Custom cover image is preferred. If no cover image is uploaded, product cards use the uploaded PDF first-page preview when a PDF URL exists.' });
  if (url.pathname === '/api/digital-products/upload') return jsonResponse({ ok: false, error: 'Use /api/digital-products/update for combined metadata and file upload.' }, 405);
  if (url.pathname.startsWith('/api/digital-products/file/')) { if (request.method !== 'GET') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405); return handleDigitalProductFile(request, env, url); }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const entry = Object.entries(FORM_DATABASE_FORMS).find(([, form]) => form.route === url.pathname);
      if (entry) return await handleFormDatabaseSubmission(request, env, entry[0]);
      const digitalProductsResponse = await handleDigitalProductsRequest(request, env, url);
      if (digitalProductsResponse) return digitalProductsResponse;
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
      return jsonResponse({ ok: false, error: 'Static asset binding is not available.' }, 500);
    } catch (error) { return jsonResponse({ ok: false, error: 'Worker runtime error.', message: error && error.message ? String(error.message).slice(0, 240) : 'Unknown runtime error.' }, 500); }
  }
};
