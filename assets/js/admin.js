const ADMIN_PASSWORD_HASH = 'c7ef3319e6cf6aab9035156df95f18dfec2ba2178f733940eda688758805708b';
const SESSION_KEY = 'hc_admin_unlocked';
let ADMIN_ITEMS = [];
let ADMIN_CONFIG = {};

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
  const labels = { 'insights': 'Insight', 'articles': 'Article', 'guides': 'Guide', 'white-papers': 'White Paper' };
  return labels[value] || String(item.type || '').replaceAll('-', ' ');
}

function statusInstruction(item) {
  if (item.status === 'ready_for_approval') return `Change status for ${item.id} from ready_for_approval to approved in the manifest.`;
  if (item.status === 'approved') return `Approved items auto-publish when publishAt is reached. Edit only if you need to delay or revoke.`;
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
    sort: document.getElementById('sort-filter')?.value || 'publishAt-asc'
  };
}

function filterItems(items) {
  const filters = getFilters();
  let out = items.filter(item => item.validationPassed === true && ['ready_for_approval','approved','published','revoked'].includes(item.status));
  if (filters.status !== 'all') out = out.filter(item => item.status === filters.status);
  if (filters.type !== 'all') out = out.filter(item => (item.contentType || '') === filters.type);
  if (filters.from) out = out.filter(item => !item.publishAt || formatDate(item.publishAt) >= filters.from);
  if (filters.to) out = out.filter(item => !item.publishAt || formatDate(item.publishAt) <= filters.to);
  if (filters.q) {
    out = out.filter(item => [item.id, item.title, item.slug, item.publicPath, item.previewPath, item.status, item.contentType, item.type]
      .some(value => String(value || '').toLowerCase().includes(filters.q)));
  }
  const [field, direction] = filters.sort.split('-');
  out.sort((a, b) => {
    let av = field === 'type' ? typeLabel(a) : (a[field] || '');
    let bv = field === 'type' ? typeLabel(b) : (b[field] || '');
    if (field === 'publishAt') { av = av || '9999-12-31'; bv = bv || '9999-12-31'; }
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
      <td>${escapeHtml(formatDate(item.publishAt))}</td>
      <td>${item.validationPassed ? 'Passed' : 'No'}</td>
      <td>${item.requiresFooter ? 'Yes' : 'No'}</td>
      <td class="small">${escapeHtml(statusInstruction(item))}</td>
      <td>${actionLinks(item, config)}</td>
    </tr>
  `).join('');
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
  const [manifest, config] = await Promise.all([
    fetchJson('/data/admin/content_manifest.json'),
    fetchJson('/data/system/config.json')
  ]);
  if (!manifest || !config) {
    document.getElementById('admin-message').textContent = 'Admin data failed to load.';
    return;
  }
  ADMIN_ITEMS = manifest;
  ADMIN_CONFIG = config;
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
  if (sessionStorage.getItem(SESSION_KEY) === 'true') await renderAdmin();
});
