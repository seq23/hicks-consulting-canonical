(function digitalProducts() {
  const CATALOG_URL = '/data/products/digital_products.json';
  const API_URL = '/api/digital-products';

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) return null;
    return res.json().catch(() => null);
  }

  async function loadCatalog() {
    const api = await fetchJson(API_URL);
    if (api && Array.isArray(api.products)) return api;
    const seed = await fetchJson(CATALOG_URL);
    return seed && Array.isArray(seed.products) ? seed : { products: [] };
  }

  function isPublished(item) {
    return item && item.status === 'published';
  }

  function typeLabel(item) {
    return item.productType === 'premium' ? 'PREMIUM DOWNLOAD' : 'FREE DOWNLOAD';
  }

  function actionLabel(item) {
    if (item.productType === 'premium') return item.buttonLabel || `Buy on Gumroad${item.priceLabel ? ` - ${item.priceLabel}` : ''}`;
    return item.buttonLabel || 'Download free resource';
  }

  function actionHref(item) {
    return item.productType === 'premium' ? item.gumroadUrl : item.downloadUrl;
  }

  function coverMarkup(item) {
    if (item.coverSource === 'branded_placeholder') {
      return `<div class="digital-product-cover-fallback"><span>${escapeHtml(typeLabel(item))}</span><strong>${escapeHtml(item.title)}</strong><em>Hicks Consulting</em></div>`;
    }
    if (item.coverImageUrl) {
      return `<img src="${escapeHtml(item.coverImageUrl)}" alt="${escapeHtml(item.title)} preview" loading="lazy"/>`;
    }
    if (item.coverSource === 'pdf_first_page' && item.downloadUrl) {
      return `<object class="digital-product-pdf-cover" data="${escapeHtml(item.downloadUrl)}#page=1" type="application/pdf" aria-label="${escapeHtml(item.title)} PDF cover"><span>${escapeHtml(item.title)}</span></object>`;
    }
    return `<div class="digital-product-cover-fallback"><span>${escapeHtml(typeLabel(item))}</span><strong>${escapeHtml(item.title)}</strong><em>Hicks Consulting</em></div>`;
  }

  function productCard(item) {
    const href = actionHref(item);
    const disabled = !href || (item.productType === 'premium' && item.checkoutStatus !== 'live');
    const button = disabled
      ? `<span class="button alt digital-product-disabled">Checkout coming soon</span>`
      : `<a class="button" href="${escapeHtml(href)}"${item.productType === 'premium' ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(actionLabel(item))}</a>`;
    return `<article class="resource-type-card digital-product-card">
      <div class="digital-product-cover">${coverMarkup(item)}</div>
      <span class="section-label">${escapeHtml(typeLabel(item))}</span>
      <h2>${escapeHtml(item.title)}</h2>
      <p>${escapeHtml(item.description)}</p>
      <div class="product-meta-list"><span>${escapeHtml(item.category || 'Download')}</span>${item.priceLabel ? `<span>${escapeHtml(item.priceLabel)}</span>` : ''}</div>
      <div class="hero-actions">${button}</div>
    </article>`;
  }

  function renderGrid(target, products, type) {
    const items = products.filter((item) => isPublished(item) && item.productType === type);
    if (!items.length) {
      target.innerHTML = `<div class="soft-panel digital-product-empty"><h3>No ${type === 'premium' ? 'premium downloads' : 'free downloads'} are published yet.</h3><p class="muted">Approved downloads will appear here after they are published from admin.</p></div>`;
      return;
    }
    target.innerHTML = items.map(productCard).join('');
  }

  function latestFeatured(products, type) {
    return products
      .filter((item) => isPublished(item) && item.productType === type && item.featured === true)
      .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))[0] || null;
  }

  function renderFeaturedPremium(products) {
    const target = document.querySelector('[data-featured-premium-download]');
    if (!target) return;
    const item = latestFeatured(products, 'premium');
    if (!item) return;
    const href = actionHref(item);
    const button = href && item.checkoutStatus === 'live'
      ? `<a class="button" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(actionLabel(item))}</a>`
      : `<span class="button alt digital-product-disabled">Checkout coming soon</span>`;
    target.innerHTML = `<span class="section-label">FEATURED PREMIUM DOWNLOAD</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.description)}</p><div class="product-meta-list"><span>${escapeHtml(item.category || 'Workbook')}</span>${item.priceLabel ? `<span>${escapeHtml(item.priceLabel)}</span>` : ''}<span>Gumroad checkout</span></div><div class="hero-actions">${button}<a class="button alt" href="/resources/premium-downloads/">View premium downloads</a></div>`;
  }

  async function init() {
    const payload = await loadCatalog();
    const products = payload.products || [];
    document.querySelectorAll('[data-digital-products]').forEach((target) => {
      renderGrid(target, products, target.getAttribute('data-digital-products'));
    });
    renderFeaturedPremium(products);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
