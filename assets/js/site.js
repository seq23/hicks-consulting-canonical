function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function fetchJson(url) {
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json();
}

async function loadManifest() {
  const fallback = await fetchJson('/data/admin/content_manifest.json');
  return (fallback || []).filter(item => item.validationPassed === true && item.status === 'published');
}

async function renderPublishedResources(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const items = await loadManifest();
  items.sort((a, b) => String(b.publishAt || '').localeCompare(String(a.publishAt || '')));
  if (!items.length) {
    container.innerHTML = '<article class="resource-card" data-animate="zoom"><span class="badge">Resources</span><h3>Fresh resources are on the way.</h3><p class="muted small">Approved content will appear here automatically after it is published.</p></article>';
    return;
  }
  container.innerHTML = items.map(item => `
    <article class="resource-card" data-animate="zoom">
      <span class="badge">${escapeHtml(item.type)}</span>
      <h3><a href="${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a></h3>
      <p class="muted small">Track: ${escapeHtml(item.track)} · ${escapeHtml((item.publishAt || '').slice(0,10))}</p>
      <p><a class="eyebrow-link" href="${escapeHtml(item.slug)}">Read more →</a></p>
    </article>
  `).join('');
  wireAnimations();
}

async function wireFormLinks() {
  const config = await fetchJson('/data/system/config.json');
  const forms = config?.forms || {};
  document.querySelectorAll('[data-form-key]').forEach(el => {
    const key = el.getAttribute('data-form-key');
    const url = forms[key] || '';
    const valid = /^https:\/\/forms\.gle\/.+/i.test(url);
    if (valid) {
      el.setAttribute('href', url);
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
      el.removeAttribute('aria-disabled');
      return;
    }
    el.setAttribute('href', '/contact/');
    el.setAttribute('aria-disabled', 'true');
  });
}

function wireAnimations() {
  const items = document.querySelectorAll('[data-animate]');
  if (!items.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach(item => item.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .14, rootMargin: '0px 0px -30px 0px' });
  items.forEach(item => observer.observe(item));
}

document.addEventListener('DOMContentLoaded', () => {
  renderPublishedResources('published-resources');
  wireFormLinks();
  wireAnimations();
});

window.wireFormLinks = wireFormLinks;
