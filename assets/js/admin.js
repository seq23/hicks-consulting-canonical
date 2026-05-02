const ADMIN_PASSWORD_HASH = 'c7ef3319e6cf6aab9035156df95f18dfec2ba2178f733940eda688758805708b';
const SESSION_KEY = 'hc_admin_unlocked';

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

function statusInstruction(item) {
  if (item.status === 'ready_for_approval') return `Change status for ${item.id} from ready_for_approval to approved in the manifest.`;
  if (item.status === 'approved') return `Approved items auto-publish when publishAt is reached. Edit only if you need to delay or revoke.`;
  if (item.status === 'published') return `Change status for ${item.id} from published to revoked in the manifest.`;
  if (item.status === 'revoked') return `Change status for ${item.id} from revoked to approved when you want it to go live again.`;
  return '';
}

function actionLinks(item, config) {
  const edit = config.repo?.manifestEditUrl || '#';
  const view = item.slug || '#';
  return `
    <a class="button small-button" href="${edit}" target="_blank" rel="noopener noreferrer">Edit in GitHub</a>
    <a class="button alt small-button" href="${view}" target="_blank" rel="noopener noreferrer">Preview</a>
  `;
}

function renderRows(items, emptyText, config) {
  if (!items.length) {
    return `<tr><td colspan="9" class="muted">${escapeHtml(emptyText)}</td></tr>`;
  }
  return items.map(item => `
    <tr>
      <td>${escapeHtml(item.title)}<div class="muted small">${escapeHtml(item.slug)}</div></td>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(item.track)}</td>
      <td><span class="badge">${escapeHtml(item.status.replaceAll('_', ' '))}</span></td>
      <td>${escapeHtml(item.riskLevel)}</td>
      <td>${item.validationPassed ? 'Passed' : 'No'}</td>
      <td>${item.requiresFooter ? 'Yes' : 'No'}</td>
      <td class="small">${escapeHtml(statusInstruction(item))}</td>
      <td>${actionLinks(item, config)}</td>
    </tr>
  `).join('');
}

function splitSections(items) {
  const visible = items.filter(item => item.validationPassed === true && ['ready_for_approval','approved','published','revoked'].includes(item.status));
  return {
    readyForApproval: visible.filter(item => item.status === 'ready_for_approval'),
    approved: visible.filter(item => item.status === 'approved'),
    published: visible.filter(item => item.status === 'published'),
    revoked: visible.filter(item => item.status === 'revoked')
  };
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
  const sections = splitSections(manifest);
  document.getElementById('manifest-link').href = config.repo?.manifestViewUrl || '#';
  document.getElementById('manifest-edit-link').href = config.repo?.manifestEditUrl || '#';
  document.getElementById('ready-count').textContent = String(sections.readyForApproval.length);
  document.getElementById('approved-count').textContent = String(sections.approved.length);
  document.getElementById('published-count').textContent = String(sections.published.length);
  document.getElementById('revoked-count').textContent = String(sections.revoked.length);
  document.getElementById('ready-tbody').innerHTML = renderRows(sections.readyForApproval, 'No validation-passed items are waiting for approval.', config);
  document.getElementById('approved-tbody').innerHTML = renderRows(sections.approved, 'No approved items are waiting for scheduled publish.', config);
  document.getElementById('published-tbody').innerHTML = renderRows(sections.published, 'No content is currently live.', config);
  document.getElementById('revoked-tbody').innerHTML = renderRows(sections.revoked, 'No content has been revoked.', config);
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
