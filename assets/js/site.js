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
  const selection = window.HicksResourceSelection;
  const recentItems = selection && typeof selection.selectRecentPublishedResources === 'function'
    ? selection.selectRecentPublishedResources(items, 4)
    : items.slice().sort((a, b) => publicReleaseDate(b).localeCompare(publicReleaseDate(a))).slice(0, 4);
  if (!recentItems.length) {
    container.innerHTML = '<article class="resource-card" data-animate="zoom"><span class="badge">Resources</span><h3>Fresh resources are on the way.</h3><p class="muted small">New resources will appear here as they are released.</p></article>';
    return;
  }
  container.innerHTML = recentItems.map(item => `
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
    const currentHref = el.getAttribute('href') || '';
    const url = forms[key] || currentHref || '';
    const validInternal = /^\/[A-Za-z0-9/_#?.=&%-]*$/.test(url);
    const validExternal = /^https:\/\/(forms\.gle|monika-hicks\.clientsecure\.me)\/?/i.test(url);
    const validMailto = /^mailto:/i.test(url) && key !== 'groups';

    if (validInternal || validExternal || validMailto) {
      el.setAttribute('href', url);
      if (validExternal || validMailto) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      } else {
        el.removeAttribute('target');
        el.removeAttribute('rel');
      }
      el.removeAttribute('aria-disabled');
      return;
    }

    el.setAttribute('href', '/contact/');
    el.setAttribute('aria-disabled', 'true');
  });
}





// Bot guard for the public forms; the server side is worker/form_guard.mjs.
// Cloudflare Turnstile (Managed, interaction-only) runs off-screen and only moves
// into the form when Cloudflare asks this visitor to tick a box. Its token is
// sent with the inquiry; with no token (blocked script, slow network) the
// server still delivers the inquiry, under its per-connection and daily caps.
const TURNSTILE_SITE_KEY = '0x4AAAAAAGO0LbmNdAeXEX1G';
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const OFF_SCREEN = 'position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;';
let turnstileReady = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileReady) {
    turnstileReady = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not start')));
      script.onerror = () => reject(new Error('Turnstile could not load'));
      document.head.appendChild(script);
    });
  }
  return turnstileReady;
}

function addFormGuard(form) {
  // Honeypot: off-screen, out of the tab order and hidden from screen readers, so
  // only a bot fills it. Its name matches no browser autofill field.
  const trap = document.createElement('div');
  trap.setAttribute('aria-hidden', 'true');
  trap.style.cssText = OFF_SCREEN;
  const bait = document.createElement('input');
  bait.type = 'text';
  bait.name = 'hp_website';
  bait.tabIndex = -1;
  bait.autocomplete = 'off';
  trap.appendChild(bait);
  form.appendChild(trap);

  let widgetId = null;
  let widgetFailed = !TURNSTILE_SITE_KEY;
  if (TURNSTILE_SITE_KEY) {
    const slot = document.createElement('div');
    slot.className = 'form-turnstile';
    slot.style.cssText = OFF_SCREEN;
    const submit = form.querySelector('button[type="submit"]');
    let anchor = submit;
    while (anchor && anchor.parentNode !== form) anchor = anchor.parentNode;
    form.insertBefore(slot, anchor || null);
    loadTurnstile()
      .then((turnstile) => {
        widgetId = turnstile.render(slot, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: 'interaction-only',
          'response-field': false,
          'before-interactive-callback': () => { slot.style.cssText = ''; },
          'after-interactive-callback': () => { slot.style.cssText = OFF_SCREEN; },
          'error-callback': () => { widgetFailed = true; }
        });
      })
      .catch(() => { widgetFailed = true; });
  }

  const currentToken = () => {
    try { if (widgetId !== null && window.turnstile) return window.turnstile.getResponse(widgetId) || ''; } catch (error) {}
    return '';
  };

  return {
    // A fast submit can beat the invisible check (the script loads, then the
    // check takes a few seconds), so wait up to 5 s for the token. Without one
    // the server still delivers, under its caps; the wait only keeps real
    // people on the verified path.
    async fields() {
      let token = currentToken();
      for (let waited = 0; !token && !widgetFailed && waited < 5000; waited += 250) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        token = currentToken();
      }
      return { website: bait.value, turnstileToken: token };
    },
    reset() {
      try { if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId); } catch (error) {}
    }
  };
}

async function submitInquiryPayload(endpoint, payload) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function wireInquiryForm(config) {
  const form = document.getElementById(config.formId);
  if (!form) return;

  const status = document.getElementById(config.statusId);
  const submit = form.querySelector('button[type="submit"]');
  const endpoint = form.getAttribute('data-endpoint') || form.getAttribute('action') || config.endpoint;
  const guard = addFormGuard(form);

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

    config.fields.forEach((name) => {
      payload[name] = String(formData.get(name) || '').trim();
    });

    const missingRequired = config.required.filter((name) => !payload[name]);
    if (missingRequired.length) {
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
      Object.assign(payload, await guard.fields());
      const response = await submitInquiryPayload(endpoint, payload);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || 'Submission failed');
      }

      form.reset();
      form.hidden = true;
      setStatus(config.successMessage, 'success');
      if (status) status.focus?.();
    } catch (error) {
      guard.reset();
      setStatus(config.errorMessage, 'error');
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText || config.submitLabel;
      }
    }
  });
}

function wireTrainingInquiryForm() {
  wireInquiryForm({
    formId: 'training-inquiry-form',
    statusId: 'training-inquiry-status',
    endpoint: '/api/training-inquiry',
    submitLabel: 'Submit Inquiry',
    fields: ['firstName', 'lastName', 'company', 'email', 'services', 'eventDate', 'honorarium', 'referral', 'eventDetails'],
    required: ['firstName', 'lastName', 'company', 'email', 'services', 'eventDate', 'honorarium', 'eventDetails'],
    successMessage: 'Thank you. Your organizational training inquiry has been received. Hicks Consulting will review your information and follow up as appropriate.',
    errorMessage: 'We could not submit the form just now. Please try again, or email info@hicksconsulting.org.'
  });
}



function wireGroupsInquiryForm() {
  wireInquiryForm({
    formId: 'group-inquiry-form',
    statusId: 'group-inquiry-status',
    endpoint: '/api/groups-inquiry',
    submitLabel: 'Submit Group Inquiry',
    fields: ['firstName', 'lastName', 'email', 'phone', 'groupInterest', 'supportNeed', 'availability', 'message'],
    required: ['firstName', 'lastName', 'email', 'groupInterest', 'supportNeed'],
    successMessage: 'Thank you. Your group inquiry has been received. Hicks Consulting will review your information and follow up as appropriate.',
    errorMessage: 'We could not submit the form just now. Please try again, or email info@hicksconsulting.org.'
  });
}

function wireLeadMagnetForm() {
  const form = document.getElementById('stress-worksheet-form');
  if (!form) return;

  const status = document.getElementById('stress-worksheet-status');
  const panel = document.getElementById('stress-worksheet-download');
  const downloadLink = panel ? panel.querySelector('[data-download-url]') : null;
  const submit = form.querySelector('button[type="submit"]');
  const endpoint = form.getAttribute('data-endpoint') || form.getAttribute('action') || '/api/lead-magnet';
  const guard = addFormGuard(form);

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
      submittedAtClient: new Date().toISOString(),
      leadMagnet: String(formData.get('leadMagnet') || 'stress-management-made-simple').trim(),
      firstName: String(formData.get('firstName') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      stressContext: String(formData.get('stressContext') || '').trim(),
      consent: formData.get('consent') === 'yes' ? 'yes' : ''
    };

    if (!payload.firstName || !payload.email || !payload.consent) {
      setStatus('Please enter your first name, email, and consent before downloading.', 'error');
      return;
    }

    const originalText = submit ? submit.textContent : '';
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Submitting…';
    }
    setStatus('', '');

    try {
      Object.assign(payload, await guard.fields());
      const response = await submitInquiryPayload(endpoint, payload);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || 'Submission failed');
      }

      form.reset();
      form.hidden = true;
      if (downloadLink) {
        downloadLink.setAttribute('href', result.downloadPath || downloadLink.getAttribute('data-download-url') || '/assets/downloads/stress-management-made-simple.pdf');
      }
      if (panel) panel.hidden = false;
      setStatus('Thank you. Your worksheet is ready below.', 'success');
      if (status) status.focus?.();
    } catch (error) {
      guard.reset();
      setStatus('We could not prepare the download just now. Please try again, or email info@hicksconsulting.org.', 'error');
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalText || 'Send me the worksheet';
      }
    }
  });
}


function wireBrowserCompatibility() {
  document.documentElement.style.setProperty('color-scheme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  document.querySelectorAll('img').forEach((img) => {
    if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
    if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
  });
}

function wireAnimations() {
  const animated = Array.from(document.querySelectorAll('[data-animate]'));
  if (!animated.length) return;

  if (!('IntersectionObserver' in window)) {
    animated.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  animated.forEach((el) => observer.observe(el));
}

function wireAnalytics() {
  document.documentElement.setAttribute('data-js-ready', 'true');
}

function runSafely(fn) {
  try { fn(); } catch (error) { console.error('[Hicks site]', error); }
}

document.addEventListener('DOMContentLoaded', () => {
  // Theme and navigation must wire first. If a content widget fails later, the core controls still work.
  runSafely(wireThemeToggle);
  runSafely(wireMobileNav);
  runSafely(wireBrowserCompatibility);
  runSafely(wireAnimations);
  runSafely(wireAnalytics);
  runSafely(() => renderPublishedResources('published-resources'));
  runSafely(() => renderPublishedResourcesList('insights-published', 'insights'));
  runSafely(() => renderPublishedResourcesList('articles-published', 'articles'));
  runSafely(() => renderPublishedResourcesList('guides-published', 'guides'));
  runSafely(() => renderPublishedResourcesList('white-papers-published', 'white-papers'));
  runSafely(wireFormLinks);
  runSafely(wireTrainingInquiryForm);
  runSafely(wireGroupsInquiryForm);
  runSafely(wireLeadMagnetForm);
});

window.wireFormLinks = wireFormLinks;

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

  toggles.forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      setNavState(!isOpen);
    });
  });

  nav.querySelectorAll('a, button').forEach((item) => item.addEventListener('click', () => setNavState(false)));
  document.addEventListener('click', (event) => {
    if (!document.body.classList.contains('nav-open')) return;
    if (nav.contains(event.target) || toggles.some((toggle) => toggle.contains(event.target))) return;
    setNavState(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) setNavState(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setNavState(false);
  });
}


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
  if (!toggles.length) return;

  let stored = 'light';
  try { stored = localStorage.getItem('hicks-theme') || 'light'; } catch (e) {}
  applyHicksTheme(stored === 'dark' ? 'dark' : 'light');

  toggles.forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('hicks-theme', nextTheme); } catch (e) {}
      applyHicksTheme(nextTheme);
    });
  });
}
