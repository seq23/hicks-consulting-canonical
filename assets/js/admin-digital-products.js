function applyHicksTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.documentElement.style.setProperty('color-scheme', isDark ? 'dark' : 'light');
  document.querySelectorAll('.theme-toggle').forEach((toggle) => {
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    const icon = toggle.querySelector('.theme-icon');
    const text = toggle.querySelector('.theme-text');
    if (icon) icon.textContent = isDark ? '☼' : '☾';
    if (text) text.textContent = isDark ? 'Light' : 'Dark';
  });
}

function wireThemeToggle() {
  const toggles = Array.from(document.querySelectorAll('.theme-toggle'));
  let stored = 'light';
  try { stored = localStorage.getItem('hicks-theme') || 'light'; } catch (e) {}
  applyHicksTheme(stored === 'dark' ? 'dark' : 'light');
  toggles.forEach((toggle) => toggle.addEventListener('click', (event) => {
    event.preventDefault();
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const nextTheme = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('hicks-theme', nextTheme); } catch (e) {}
    applyHicksTheme(nextTheme);
  }));
}

function wireMobileNav() {
  const toggles = Array.from(document.querySelectorAll('.nav-toggle'));
  const nav = document.getElementById('site-navigation');
  if (!toggles.length || !nav) return;
  const setNavState = (isOpen) => {
    toggles.forEach((toggle) => {
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    });
    nav.classList.toggle('is-open', isOpen);
    document.body.classList.toggle('nav-open', isOpen);
  };
  toggles.forEach((toggle) => toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setNavState(toggle.getAttribute('aria-expanded') !== 'true');
  }));
  nav.querySelectorAll('a, button').forEach((item) => item.addEventListener('click', () => setNavState(false)));
}

const ADMIN_PASSWORD_HASH = 'c7ef3319e6cf6aab9035156df95f18dfec2ba2178f733940eda688758805708b';
const SESSION_KEY = 'hc_admin_unlocked';
const ADMIN_AUTH_HASH_KEY = 'hc_admin_password_hash_v1';
let PRODUCTS = [];

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAdminAuthHash() {
  try {
    return localStorage.getItem(ADMIN_AUTH_HASH_KEY) || sessionStorage.getItem(ADMIN_AUTH_HASH_KEY) || '';
  } catch (error) {
    return '';
  }
}

function setAdminAuthHash(hash) {
  try {
    localStorage.setItem(ADMIN_AUTH_HASH_KEY, hash);
  } catch (error) {
    try { sessionStorage.setItem(ADMIN_AUTH_HASH_KEY, hash); } catch (innerError) {}
  }
}

function clearAdminAuthHash() {
  try { localStorage.removeItem(ADMIN_AUTH_HASH_KEY); } catch (error) {}
  try { sessionStorage.removeItem(ADMIN_AUTH_HASH_KEY); } catch (error) {}
}

function adminAuthHeaders(extra = {}) {
  const hash = getAdminAuthHash();
  return {
    ...extra,
    ...(hash ? { 'x-admin-password-hash': hash } : {})
  };
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

async function loadProducts() {
  const api = await fetchJson('/api/digital-products');
  if (api && Array.isArray(api.products)) return api.products;
  const seed = await fetchJson('/data/products/digital_products.json');
  return Array.isArray(seed?.products) ? seed.products : [];
}

function counts(products) {
  return ['draft','ready_for_approval','published','revoked'].reduce((out, status) => {
    out[status] = products.filter((item) => item.status === status).length;
    return out;
  }, {});
}

function getFilters() {
  return {
    q: (document.getElementById('product-search')?.value || '').toLowerCase().trim(),
    type: document.getElementById('product-type-filter')?.value || 'all',
    status: document.getElementById('product-status-filter')?.value || 'all'
  };
}

function filteredProducts() {
  const filters = getFilters();
  let out = PRODUCTS.slice();
  if (filters.type !== 'all') out = out.filter((item) => item.productType === filters.type);
  if (filters.status !== 'all') out = out.filter((item) => item.status === filters.status);
  if (filters.q) out = out.filter((item) => [item.id, item.title, item.description, item.category].some((value) => String(value || '').toLowerCase().includes(filters.q)));
  return out.sort((a, b) => String(a.productType).localeCompare(String(b.productType)) || String(a.title).localeCompare(String(b.title)));
}

function statusHelp(item) {
  if (item.productType === 'premium' && item.checkoutStatus === 'placeholder') return 'Needs real Gumroad URL before publish.';
  if (item.status === 'published') return 'Live on public download page.';
  if (item.status === 'ready_for_approval') return 'Ready for final human publish action.';
  return 'Not public.';
}

function renderRows() {
  const body = document.getElementById('digital-products-tbody');
  if (!body) return;
  const items = filteredProducts();
  const summary = document.getElementById('product-filter-summary');
  if (summary) summary.textContent = `Showing ${items.length} of ${PRODUCTS.length} products.`;
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="8" class="muted">No digital products match the current filters.</td></tr>';
    return;
  }
  body.innerHTML = items.map((item) => `<tr>
    <td><strong>${escapeHtml(item.title)}</strong><div class="muted small">${escapeHtml(item.id)}</div><div class="muted small">${escapeHtml(statusHelp(item))}</div></td>
    <td>${item.productType === 'premium' ? 'Premium Download' : 'Free Download'}</td>
    <td><span class="badge">${escapeHtml(String(item.status || '').replaceAll('_', ' '))}</span></td>
    <td>${escapeHtml(item.priceLabel || (item.productType === 'free' ? 'Free' : ''))}</td>
    <td class="small">${item.productType === 'premium' ? escapeHtml(item.gumroadUrl || 'Missing Gumroad URL') : escapeHtml(item.downloadUrl || 'Missing download URL')}</td>
    <td>${escapeHtml(item.coverSource || 'none')}</td>
    <td>${item.featured ? 'Yes' : 'No'}</td>
    <td><button class="small-button" type="button" data-edit-product="${escapeHtml(item.id)}">Edit</button><button class="small-button" type="button" data-publish-product="${escapeHtml(item.id)}">Publish</button><button class="small-button alt" type="button" data-revoke-product="${escapeHtml(item.id)}">Revoke</button></td>
  </tr>`).join('');
  document.querySelectorAll('[data-edit-product]').forEach((button) => button.addEventListener('click', () => fillForm(button.getAttribute('data-edit-product'))));
  document.querySelectorAll('[data-publish-product]').forEach((button) => button.addEventListener('click', () => mutateProductStatus(button.getAttribute('data-publish-product'), 'publish')));
  document.querySelectorAll('[data-revoke-product]').forEach((button) => button.addEventListener('click', () => mutateProductStatus(button.getAttribute('data-revoke-product'), 'revoke')));
}

async function mutateProductStatus(id, action) {
  const message = document.getElementById('digital-product-form-message');
  const endpoint = {
    publish: '/api/digital-products/publish',
    revoke: '/api/digital-products/revoke'
  }[action];
  if (!endpoint) return;
  if (message) message.textContent = `${action === 'publish' ? 'Publishing' : 'Revoking'} product...`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: adminAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id })
  }).catch((error) => ({ ok: false, json: async () => ({ error: error.message }) }));
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    if (message) message.textContent = payload.error || `Product could not be ${action === 'publish' ? 'published' : 'revoked'}.`;
    return;
  }
  PRODUCTS = payload.products || PRODUCTS;
  renderStats();
  renderRows();
  if (message) message.textContent = action === 'publish' ? 'Product published.' : 'Product revoked.';
}

function renderStats() {
  const c = counts(PRODUCTS);
  const map = { 'draft-count': c.draft, 'ready-count': c.ready_for_approval, 'published-count': c.published, 'revoked-count': c.revoked };
  Object.entries(map).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.textContent = String(value || 0); });
}

function fillForm(id) {
  const item = PRODUCTS.find((product) => product.id === id);
  const form = document.getElementById('digital-product-form');
  if (!item || !form) return;
  ['id','productType','status','title','description','category','priceLabel','gumroadUrl'].forEach((name) => {
    if (form.elements[name]) form.elements[name].value = item[name] || '';
  });
  if (form.elements.featured) form.elements.featured.checked = item.featured === true;
  window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
}

function bindFilters() {
  ['product-search','product-type-filter','product-status-filter'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', renderRows);
    el.addEventListener('change', renderRows);
  });
}

function normalizeForm(form) {
  const data = new FormData(form);
  if (!data.get('priceLabel') && data.get('productType') === 'premium') data.set('priceLabel', '$10');
  return data;
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('digital-product-form-message');
  if (message) message.textContent = 'Saving product...';
  const res = await fetch('/api/digital-products/update', {
    method: 'POST',
    headers: adminAuthHeaders(),
    body: normalizeForm(form)
  }).catch((error) => ({ ok: false, json: async () => ({ error: error.message }) }));
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    if (message) message.textContent = payload.error || 'Product could not be saved. Please confirm you are signed in and try again.';
    return;
  }
  PRODUCTS = payload.products || PRODUCTS;
  renderStats();
  renderRows();
  if (message) message.textContent = 'Product saved. Publish remains a separate intentional action.';
}

async function renderAdmin() {
  PRODUCTS = await loadProducts();
  bindFilters();
  renderStats();
  renderRows();
  const form = document.getElementById('digital-product-form');
  if (form) form.addEventListener('submit', saveProduct);
  const reset = document.getElementById('reset-product-form');
  if (reset) reset.addEventListener('click', () => form?.reset());
  document.getElementById('login-panel').hidden = true;
  document.getElementById('admin-panel').hidden = false;
}

async function unlockAdmin() {
  const password = document.getElementById('admin-password').value.trim();
  const hash = await sha256(password);
  if (hash !== ADMIN_PASSWORD_HASH) {
    document.getElementById('login-message').textContent = 'Password did not match.';
    return;
  }
  sessionStorage.setItem(SESSION_KEY, 'true');
  setAdminAuthHash(hash);
  document.getElementById('login-message').textContent = '';
  await renderAdmin();
}

function lockAdmin() {
  sessionStorage.removeItem(SESSION_KEY);
  clearAdminAuthHash();
  document.getElementById('admin-panel').hidden = true;
  document.getElementById('login-panel').hidden = false;
  document.getElementById('admin-password').value = '';
}

window.unlockAdmin = unlockAdmin;
window.lockAdmin = lockAdmin;

document.addEventListener('DOMContentLoaded', async () => {
  wireMobileNav();
  wireThemeToggle();
  const storedHash = getAdminAuthHash();
  if (storedHash === ADMIN_PASSWORD_HASH || sessionStorage.getItem(SESSION_KEY) === 'true') {
    sessionStorage.setItem(SESSION_KEY, 'true');
    if (storedHash !== ADMIN_PASSWORD_HASH) setAdminAuthHash(ADMIN_PASSWORD_HASH);
    await renderAdmin();
  }
});
