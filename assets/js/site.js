function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function resourceTypeLabel(type) {
  const map = {
    daily: 'Insight',
    weekly: 'Article',
    monthly: 'Guide',
    quarterly: 'White Paper'
  };
  return map[String(type || '').toLowerCase()] || type || 'Resource';
}

function resourceTypeKey(type) {
  const map = { daily: 'insights', weekly: 'articles', monthly: 'guides', quarterly: 'white-papers' };
  return map[String(type || '').toLowerCase()] || '';
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


function publicReleaseDate(item) {
  return String(item?.publishedAt || item?.scheduledAt || '');
}

function publicReleaseDateLabel(item) {
  return publicReleaseDate(item).slice(0, 10);
}

async function renderPublishedResourcesList(containerId, typeKey) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const items = await loadManifest();
  const filtered = items
    .filter(item => resourceTypeKey(item.type) === typeKey)
    .sort((a, b) => publicReleaseDate(b).localeCompare(publicReleaseDate(a)));
  if (!filtered.length) {
    container.innerHTML = '<li class="muted">No published resources are live in this section yet.</li>';
    return;
  }
  container.innerHTML = filtered.map(item => `<li><a href="${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a><span class="muted small"> — ${escapeHtml(publicReleaseDateLabel(item))}</span></li>`).join('');
}

async function renderPublishedResources(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const items = await loadManifest();
  items.sort((a, b) => publicReleaseDate(b).localeCompare(publicReleaseDate(a)));
  if (!items.length) {
    container.innerHTML = '<article class="resource-card" data-animate="zoom"><span class="badge">Resources</span><h3>Fresh resources are on the way.</h3><p class="muted small">New resources will appear here as they are released.</p></article>';
    return;
  }
  container.innerHTML = items.map(item => `
    <article class="resource-card" data-animate="zoom">
      <span class="badge">${escapeHtml(resourceTypeLabel(item.type))}</span>
      <h3><a href="${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a></h3>
      <p class="muted small">Author: Monika Hicks, LCSW · ${escapeHtml(publicReleaseDateLabel(item))}</p>
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
    const valid = /^https:\/\/(forms\.gle|monika-hicks\.clientsecure\.me)\/?/i.test(url) || /^mailto:/i.test(url);
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




function wireTrainingInquiryForm() {
  const form = document.getElementById('training-inquiry-form');
  if (!form) return;

  const status = document.getElementById('training-inquiry-status');
  const submit = form.querySelector('button[type="submit"]');
  const endpoint = form.getAttribute('data-endpoint') || form.getAttribute('action') || '/api/training-inquiry';
  const lockedFieldNames = [
    'firstName',
    'lastName',
    'company',
    'email',
    'services',
    'eventDate',
    'honorarium',
    'referral',
    'eventDetails'
  ];

  const setStatus = (message, type) => {
    if (!status) return;
    status.textContent = message;
    status.className = `form-status ${type || ''}`.trim();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      sourcePage: window.location.pathname,
      submittedAtClient: new Date().toISOString()
    };

    lockedFieldNames.forEach((name) => {
      payload[name] = String(formData.get(name) || '').trim();
    });

    if (!payload.firstName || !payload.lastName || !payload.company || !payload.email || !payload.services || !payload.eventDetails) {
      setStatus('Please complete the required fields before submitting.', 'error');
      return;
    }

    const originalText = submit ? submit.textContent : '';
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Submitting…';
    }
    setStatus('', '');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || 'Submission failed');
      }

      form.reset();
      form.hidden = true;
      setStatus('Thank you. Your inquiry has been received. Hicks Consulting will review your information and follow up as appropriate.', 'success');
    } catch (error) {
      setStatus('We could not submit the form just now. Please try again, or email info@hicksconsulting.org.', 'error');
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText || 'Submit Inquiry';
      }
    }
  });
}


function wireGroupsInquiryForm() {
  const form = document.getElementById('group-inquiry-form');
  if (!form) return;

  const status = document.getElementById('group-inquiry-status');
  const submit = form.querySelector('button[type="submit"]');
  const endpoint = form.getAttribute('data-endpoint') || form.getAttribute('action') || '/api/groups-inquiry';
  const lockedFieldNames = [
    'firstName',
    'lastName',
    'email',
    'groupInterest',
    'preferredAvailability',
    'referral',
    'message'
  ];

  const setStatus = (message, type) => {
    if (!status) return;
    status.textContent = message;
    status.className = `form-status ${type || ''}`.trim();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      sourcePage: window.location.pathname,
      submittedAtClient: new Date().toISOString()
    };

    lockedFieldNames.forEach((name) => {
      payload[name] = String(formData.get(name) || '').trim();
    });

    if (!payload.firstName || !payload.lastName || !payload.email || !payload.groupInterest || !payload.message) {
      setStatus('Please complete the required fields before submitting.', 'error');
      return;
    }

    const originalText = submit ? submit.textContent : '';
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Submitting…';
    }
    setStatus('', '');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || 'Submission failed');
      }

      form.reset();
      form.hidden = true;
      setStatus('Thank you. Your group inquiry has been received. Hicks Consulting will review your information and follow up as appropriate.', 'success');
    } catch (error) {
      setStatus('We could not submit the form just now. Please try again, or email info@hicksconsulting.org.', 'error');
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText || 'Submit Group Inquiry';
      }
    }
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


async function wireAnalytics() {
  const config = await fetchJson('/data/system/config.json');
  const analytics = config?.analytics || {};
  const measurementId = String(analytics.measurementId || '').trim();
  const enabled = analytics.enabled === true && /^G-[A-Z0-9]+$/i.test(measurementId);
  if (!enabled || document.querySelector('script[data-ga4-loader="true"]')) return;

  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('js', new Date());
  gtag('config', measurementId, { anonymize_ip: true });

  const external = document.createElement('script');
  external.async = true;
  external.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  external.setAttribute('data-ga4-loader', 'true');
  document.head.appendChild(external);
}

function wireBrowserCompatibility() {
  document.documentElement.style.setProperty('color-scheme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  document.querySelectorAll('img').forEach((img) => {
    if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
    if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderPublishedResources('published-resources');
  renderPublishedResourcesList('insights-published', 'insights');
  renderPublishedResourcesList('articles-published', 'articles');
  renderPublishedResourcesList('guides-published', 'guides');
  renderPublishedResourcesList('white-papers-published', 'white-papers');
  wireFormLinks();
  wireTrainingInquiryForm();
  wireGroupsInquiryForm();
  wireAnimations();
  wireMobileNav();
  wireThemeToggle();
  wireBrowserCompatibility();
  wireAnalytics();
});

window.wireFormLinks = wireFormLinks;

function wireMobileNav() {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-navigation');
  if (!toggle || !nav) return;

  const closeNav = () => {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
    nav.classList.remove('is-open');
    document.body.classList.remove('nav-open');
  };

  const openNav = () => {
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation');
    nav.classList.add('is-open');
    document.body.classList.add('nav-open');
  };

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    if (isOpen) closeNav();
    else openNav();
  });

  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeNav));
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) closeNav();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav();
  });
}


function wireThemeToggle() {
  const toggle = document.querySelector('.theme-toggle');
  if (!toggle) return;

  const setTheme = (theme) => {
    const isDark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    const icon = toggle.querySelector('.theme-icon');
    const text = toggle.querySelector('.theme-text');
    if (icon) icon.textContent = isDark ? '☼' : '☾';
    if (text) text.textContent = isDark ? 'Light' : 'Dark';
    try { localStorage.setItem('hicks-theme', isDark ? 'dark' : 'light'); } catch (e) {}
    document.documentElement.style.setProperty('color-scheme', isDark ? 'dark' : 'light');
  };

  let stored = 'light';
  try { stored = localStorage.getItem('hicks-theme') || 'light'; } catch (e) {}
  setTheme(stored === 'dark' ? 'dark' : 'light');

  toggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
}

