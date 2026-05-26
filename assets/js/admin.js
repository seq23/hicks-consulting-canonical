
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

const ADMIN_PASSWORD_HASH = 'c7ef3319e6cf6aab9035156df95f18dfec2ba2178f733940eda688758805708b';
const SESSION_KEY = 'hc_admin_unlocked';
let ADMIN_ITEMS = [];
let ADMIN_CONFIG = {};
let GENERATED_CANDIDATES = [];
let PUBLISH_QUEUE_ITEMS = [];

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
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

function typeLabel(item) {
  const value = item.contentType || '';
  const labels = { 'insights': 'Insight', 'articles': 'Article', 'guides': 'Guide', 'white-papers': 'White Paper', insight: 'Insight', article: 'Article', guide: 'Guide', whitepaper: 'White Paper', faq: 'FAQ', fanout: 'Fanout' };
  return labels[value] || String(item.type || value || '').replaceAll('-', ' ');
}

function statusInstruction(item) {
  if (item.status === 'ready_for_approval') return `Change status for ${item.id} from ready_for_approval to approved in the manifest.`;
  if (item.status === 'approved') return `Approved items auto-publish when scheduledAt is reached. Edit only if you need to delay or revoke.`;
  if (item.status === 'published') return `Change status for ${item.id} from published to revoked in the manifest.`;
  if (item.status === 'revoked') return `Change status for ${item.id} from revoked to approved when you want it to go live again.`;
  return '';
}

function formatDate(value) {
  if (!value) return 'Unscheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function actionLinks(item, config) {
  const edit = config.repo?.manifestEditUrl || '#';
  const preview = item.previewPath || '';
  const live = item.publicPath || item.slug || '';
  const previewLink = item.status !== 'published'
    ? (preview
      ? `<a class="button alt small-button" href="${escapeHtml(preview)}" target="_blank" rel="noopener noreferrer">Preview</a>`
      : `<span class="badge muted">No preview</span>`)
    : '';
  const liveLink = item.status === 'published' && live
    ? `<a class="button alt small-button" href="${escapeHtml(live)}" target="_blank" rel="noopener noreferrer">Live</a>`
    : '';
  return `
    <a class="button small-button" href="${escapeHtml(edit)}" target="_blank" rel="noopener noreferrer">Edit in GitHub</a>
    ${previewLink}
    ${liveLink}
  `;
}

function statusCounts(items) {
  return {
    ready_for_approval: items.filter(item => item.status === 'ready_for_approval').length,
    approved: items.filter(item => item.status === 'approved').length,
    published: items.filter(item => item.status === 'published').length,
    revoked: items.filter(item => item.status === 'revoked').length
  };
}

function getFilters() {
  return {
    q: (document.getElementById('admin-search')?.value || '').trim().toLowerCase(),
    status: document.getElementById('status-filter')?.value || 'all',
    type: document.getElementById('type-filter')?.value || 'all',
    from: document.getElementById('date-from')?.value || '',
    to: document.getElementById('date-to')?.value || '',
    sort: document.getElementById('sort-filter')?.value || 'scheduledAt-asc'
  };
}

function filterItems(items) {
  const filters = getFilters();
  let out = items.filter(item => item.validationPassed === true && ['ready_for_approval','approved','published','revoked'].includes(item.status));
  if (filters.status !== 'all') out = out.filter(item => item.status === filters.status);
  if (filters.type !== 'all') out = out.filter(item => (item.contentType || '') === filters.type);
  if (filters.from) out = out.filter(item => !item.scheduledAt || formatDate(item.scheduledAt) >= filters.from);
  if (filters.to) out = out.filter(item => !item.scheduledAt || formatDate(item.scheduledAt) <= filters.to);
  if (filters.q) {
    out = out.filter(item => [item.id, item.title, item.slug, item.publicPath, item.previewPath, item.status, item.contentType, item.type]
      .some(value => String(value || '').toLowerCase().includes(filters.q)));
  }
  const [field, direction] = filters.sort.split('-');
  out.sort((a, b) => {
    let av = field === 'type' ? typeLabel(a) : (a[field] || '');
    let bv = field === 'type' ? typeLabel(b) : (b[field] || '');
    if (field === 'scheduledAt') { av = av || '9999-12-31'; bv = bv || '9999-12-31'; }
    return direction === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
  });
  return out;
}

function renderRows(items, config) {
  if (!items.length) {
    return `<tr><td colspan="9" class="muted">No items match the current filters.</td></tr>`;
  }
  return items.map(item => `
    <tr>
      <td>${escapeHtml(item.title)}<div class="muted small">${escapeHtml(item.publicPath || item.slug)}</div><div class="muted small">${item.status === 'published' ? 'Live public item' : `Preview: ${escapeHtml(item.previewPath || 'not generated')}`}</div></td>
      <td>${escapeHtml(typeLabel(item))}</td>
      <td>${escapeHtml(item.track)}</td>
      <td><span class="badge">${escapeHtml(item.status.replaceAll('_', ' '))}</span></td>
      <td>${escapeHtml(formatDate(item.scheduledAt))}</td>
      <td>${item.validationPassed ? 'Passed' : 'No'}</td>
      <td>${item.requiresFooter ? 'Yes' : 'No'}</td>
      <td class="small">${escapeHtml(statusInstruction(item))}</td>
      <td>${actionLinks(item, config)}</td>
    </tr>
  `).join('');
}

function candidateWarnings(candidate) {
  const warnings = [];
  if (!candidate.llmPrompt || candidate.llmPrompt.length < 300) warnings.push('prompt too short');
  if (!Array.isArray(candidate.humanizationChecklist) || candidate.humanizationChecklist.length < 4) warnings.push('humanization checklist incomplete');
  if (!candidate.minimumWords || !candidate.targetWords) warnings.push('word floors missing');
  if (candidate.publicOnlyAfterApproval !== true) warnings.push('approval gate missing');
  return warnings;
}

function renderGeneratedCandidates() {
  const tbody = document.getElementById('generated-candidates-tbody');
  if (!tbody) return;
  const warnings = GENERATED_CANDIDATES.reduce((sum, item) => sum + candidateWarnings(item).length, 0);
  const candidateCount = document.getElementById('candidate-count');
  const queueCount = document.getElementById('queue-count');
  const warningCount = document.getElementById('candidate-warning-count');
  if (candidateCount) candidateCount.textContent = String(GENERATED_CANDIDATES.length);
  if (queueCount) queueCount.textContent = String(PUBLISH_QUEUE_ITEMS.length);
  if (warningCount) warningCount.textContent = String(warnings);
  if (!GENERATED_CANDIDATES.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">No generated candidates are queued. Run npm run ingest:all to refresh social/query-derived briefs.</td></tr>`;
    return;
  }
  tbody.innerHTML = GENERATED_CANDIDATES.map(item => {
    const itemWarnings = candidateWarnings(item);
    const promptBlock = item.llmPrompt ? `<details><summary>LLM draft prompt</summary><pre class="small">${escapeHtml(item.llmPrompt)}</pre></details>` : '';
    const route = item.suggestedRoute || '';
    const words = `${item.minimumWords || '?'} min / ${item.targetWords || '?'} target`;
    const status = item.approvalStatus || item.status || 'queued_for_owner_approval';
    return `<tr>
      <td><strong>${escapeHtml(item.title)}</strong><div class="muted small">${escapeHtml(route)}</div>${promptBlock}</td>
      <td>${escapeHtml(typeLabel(item))}</td>
      <td>${escapeHtml(item.clusterTitle || item.clusterId || '')}</td>
      <td>${escapeHtml(words)}</td>
      <td>${escapeHtml(item.sourceSignalCount || 0)}</td>
      <td><span class="badge">${escapeHtml(status.replaceAll('_', ' '))}</span>${itemWarnings.length ? `<div class="muted small">Warnings: ${escapeHtml(itemWarnings.join(', '))}</div>` : `<div class="muted small">Prewrite gate ready</div>`}</td>
      <td class="small">Approve by changing this item in <code>data/social/publish_queue.json</code> from queued_for_owner_approval to approved_for_drafting, then run the draft/prewrite loop. This does not publish automatically.</td>
    </tr>`;
  }).join('');
}

function renderFilteredAdmin() {
  const counts = statusCounts(ADMIN_ITEMS.filter(item => item.validationPassed === true));
  document.getElementById('ready-count').textContent = String(counts.ready_for_approval || 0);
  document.getElementById('approved-count').textContent = String(counts.approved || 0);
  document.getElementById('published-count').textContent = String(counts.published || 0);
  document.getElementById('revoked-count').textContent = String(counts.revoked || 0);
  const filtered = filterItems(ADMIN_ITEMS);
  document.getElementById('content-tbody').innerHTML = renderRows(filtered, ADMIN_CONFIG);
  const summary = document.getElementById('filter-summary');
  if (summary) summary.textContent = `Showing ${filtered.length} of ${ADMIN_ITEMS.length} validation-passed content items.`;
  renderGeneratedCandidates();
}

function bindFilters() {
  ['admin-search','status-filter','type-filter','date-from','date-to','sort-filter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', renderFilteredAdmin);
    if (el) el.addEventListener('change', renderFilteredAdmin);
  });
  document.querySelectorAll('[data-status-shortcut]').forEach(button => {
    button.addEventListener('click', () => {
      const select = document.getElementById('status-filter');
      if (select) select.value = button.getAttribute('data-status-shortcut') || 'all';
      renderFilteredAdmin();
    });
  });
}

async function renderAdmin() {
  const [manifest, config, briefPayload, publishQueue] = await Promise.all([
    fetchJson('/data/admin/content_manifest.json'),
    fetchJson('/data/system/config.json'),
    fetchJson('/data/intake/content_brief_candidates.json'),
    fetchJson('/data/social/publish_queue.json')
  ]);
  if (!manifest || !config) {
    document.getElementById('admin-message').textContent = 'Admin data failed to load.';
    return;
  }
  ADMIN_ITEMS = manifest;
  ADMIN_CONFIG = config;
  GENERATED_CANDIDATES = Array.isArray(briefPayload?.candidates) ? briefPayload.candidates : [];
  PUBLISH_QUEUE_ITEMS = Array.isArray(publishQueue?.items) ? publishQueue.items : [];
  document.getElementById('manifest-link').href = config.repo?.manifestViewUrl || '#';
  document.getElementById('manifest-edit-link').href = config.repo?.manifestEditUrl || '#';
  bindFilters();
  renderFilteredAdmin();
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
  document.getElementById('login-message').textContent = '';
  await renderAdmin();
}

function lockAdmin() {
  sessionStorage.removeItem(SESSION_KEY);
  document.getElementById('admin-panel').hidden = true;
  document.getElementById('login-panel').hidden = false;
  document.getElementById('admin-password').value = '';
}

window.unlockAdmin = unlockAdmin;
window.lockAdmin = lockAdmin;

document.addEventListener('DOMContentLoaded', async () => {
  wireMobileNav();
  wireThemeToggle();
  if (sessionStorage.getItem(SESSION_KEY) === 'true') await renderAdmin();
});
