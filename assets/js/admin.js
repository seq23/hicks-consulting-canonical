
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
const ADMIN_AUTH_HASH_KEY = 'hc_admin_password_hash_v1';
const DECIDER_KEY = 'hc_admin_decider_name_v1';
let ADMIN_ITEMS = [];
let ADMIN_CONFIG = {};
let APPROVAL_RECORD = { approvals: [] };
let DECLINE_RECORD = { declines: [] };
let SITE_STATE = {};
let GENERATED_CANDIDATES = [];
let PUBLISH_QUEUE_ITEMS = [];

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAdminAuthHash() {
  try { return localStorage.getItem(ADMIN_AUTH_HASH_KEY) || sessionStorage.getItem(ADMIN_AUTH_HASH_KEY) || ''; }
  catch (error) { return ''; }
}
function setAdminAuthHash(hash) {
  try { localStorage.setItem(ADMIN_AUTH_HASH_KEY, hash); }
  catch (error) { try { sessionStorage.setItem(ADMIN_AUTH_HASH_KEY, hash); } catch (innerError) {} }
}
function clearAdminAuthHash() {
  try { localStorage.removeItem(ADMIN_AUTH_HASH_KEY); } catch (error) {}
  try { sessionStorage.removeItem(ADMIN_AUTH_HASH_KEY); } catch (error) {}
}
function authHeaders(extra) {
  const hash = getAdminAuthHash();
  return { ...(extra || {}), ...(hash ? { 'x-admin-password-hash': hash } : {}) };
}

function deciderName() {
  const field = document.getElementById('decider-name');
  const typed = field ? field.value.trim() : '';
  if (typed) return typed;
  try { return localStorage.getItem(DECIDER_KEY) || ''; } catch (error) { return ''; }
}
function rememberDecider(name) {
  try { localStorage.setItem(DECIDER_KEY, name); } catch (error) {}
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
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

/* ------------------------------------------------------------------ *
 * What will actually go out.
 *
 * status:'approved' in the content list means a MACHINE finished checking a
 * piece. It has never meant a person agreed to publish it. Release requires a
 * second, separate fact: a record naming who approved that specific item.
 *
 * The old panel counted the status string, so it displayed "0 Waiting for
 * approval" while 112 pieces sat unpublishable behind a decision nobody knew
 * they had to make. Two of them quietly missed their dates in August and it took
 * three days and the site owner to notice.
 *
 * So nothing here reads a status on its own. Every count and every list below
 * answers one question: will this actually go out?
 * ------------------------------------------------------------------ */

// Read the approval record at the moment we compute, and accept a standing
// approval covering a date range as well as a per-item one. The standing shape
// is being added separately, so this probes for it rather than assuming it.
function approvalFor(item) {
  const record = APPROVAL_RECORD || {};
  const perItem = (record.approvals || []).find((entry) => entry && entry.id === item.id && String(entry.approvedBy || '').trim());
  if (perItem) return perItem;
  // `standing_approvals` is the shape the publisher actually writes and reads
  // (scripts/publishing/process_manifest.js). It is listed FIRST because it is
  // the real one; the camelCase spellings are tolerated leftovers. Getting this
  // key wrong is not cosmetic -- it silently pushed 111 already-approved items
  // back into 'waiting for your OK', asking Monika to re-approve her own June
  // decision while the publisher released them anyway.
  const standingLists = [record.standing_approvals, record.standingApprovals, record.standing, record.ranges, record.dateRangeApprovals];
  for (const list of standingLists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || !String(entry.approvedBy || entry.by || '').trim()) continue;
      const from = entry.from || entry.startsAt || entry.effectiveFrom || null;
      const until = entry.scheduledThrough || entry.through || entry.until || entry.expiresAt || entry.to || null;
      const when = item.scheduledAt ? new Date(item.scheduledAt) : null;
      if (!when || Number.isNaN(when.getTime())) continue;
      if (from && when < new Date(from)) continue;
      // Inclusive of the whole final day, matching the publisher exactly. A
      // date-only 'through' parses as midnight, which would drop anything
      // scheduled during 31 December -- the page would show it as needing her
      // OK while the publisher released it that morning.
      if (until) {
        const end = /^\d{4}-\d{2}-\d{2}$/.test(String(until))
          ? new Date(`${until}T23:59:59.999Z`)
          : new Date(until);
        if (when > end) continue;
      }
      return entry;
    }
  }
  return null;
}

function declineFor(item) {
  return ((DECLINE_RECORD || {}).declines || []).find((entry) => entry && entry.id === item.id) || null;
}

// Her four groups. One item is in exactly one of them.
function groupFor(item) {
  if (item.status === 'published') return 'published';
  if (item.status === 'revoked') return 'declined';
  if (declineFor(item)) return 'declined';
  if (item.validationPassed !== true) return 'draft';
  if (item.status !== 'approved') return 'draft';
  return approvalFor(item) ? 'scheduled' : 'ready';
}

function typeLabel(item) {
  const value = item.contentType || '';
  const labels = { insights: 'Insight', articles: 'Article', guides: 'Guide', 'white-papers': 'White paper' };
  return labels[value] || 'Piece';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "Monday, 31 August" - a date a person reads, not a timestamp.
function friendlyDate(value, withWeekday = true) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  const year = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
  return withWeekday ? `${WEEKDAYS[date.getDay()]}, ${day}${year}` : `${day}${year}`;
}

function isPast(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date <= new Date();
}

function sortKeyDate(item) {
  return item.publishedAt || item.revokedAt || item.scheduledAt || '';
}

/* Read it.
 *
 * The old page printed "Preview: not generated" and that was read as previews
 * being broken. They are not: every piece awaiting a decision has a preview
 * built at /preview + its route. The rows showing that message were the revoked
 * May items, which are the one group that legitimately has no preview, and they
 * happened to sort to the top - so the whole list looked broken.
 *
 * Either way she could not read a good part of her own library, which is the
 * whole job. So this never gives up: a live piece opens on the site, anything
 * else opens its preview, and site_build.js now builds a preview for every
 * piece including the ones that came down. There is no "no preview" state left.
 */
function readItLink(item) {
  const route = item.publicPath || item.slug || '';
  if (!route) return '';
  const href = item.status === 'published' ? route : (item.previewPath || `/preview${route}`);
  return href;
}

function whenLine(item, group) {
  if (group === 'published') {
    const when = friendlyDate(item.publishedAt, false);
    return when ? `On your website since ${when}` : 'On your website now';
  }
  if (group === 'declined') {
    const decline = declineFor(item);
    const when = friendlyDate(decline ? decline.declinedAt : item.revokedAt, false);
    if (decline) return `You said no on ${when}. Reason: ${decline.reason}`;
    if (item.revokedReason) return `Taken off the site on ${when}. Reason: ${item.revokedReason}`;
    // 54 pieces came down in one go on 6 August 2026, in a commit titled
    // "consolidate duplicate insights for search indexing". Nobody rejected her
    // writing and the list carries no reason field, so say the honest thing
    // instead of leaving her to read "revoked" and worry.
    return `Removed on ${when || '6 August'} during a duplicate cleanup. No action needed.`;
  }
  const when = friendlyDate(item.scheduledAt);
  if (!when) return 'No date set yet';
  if (group === 'ready') {
    return isPast(item.scheduledAt)
      ? `Was due ${when} and is still waiting for you`
      : `Goes out on ${when}, once you approve it`;
  }
  if (group === 'scheduled') {
    const who = approvalFor(item);
    return `Goes out on ${when}. Approved by ${who && (who.approvedBy || who.by) ? (who.approvedBy || who.by) : 'you'}.`;
  }
  return `Planned for ${when}`;
}

function editLink(item) {
  const base = ADMIN_CONFIG.repo?.manifestEditUrl || '';
  return base || '#';
}

function itemCard(item, group) {
  const href = readItLink(item);
  const decide = group === 'ready'
    ? `<div class="hero-actions">
         <button class="button" data-decide="approve" data-id="${escapeHtml(item.id)}" type="button">Approve</button>
         <button class="button alt" data-decide="decline" data-id="${escapeHtml(item.id)}" type="button">Not this one</button>
       </div>
       <div class="soft-panel" hidden="" data-decline-box="${escapeHtml(item.id)}">
         <label for="why-${escapeHtml(item.id)}">Why not this one?</label>
         <textarea id="why-${escapeHtml(item.id)}" rows="3" style="width:100%;padding:.7rem;border:1px solid var(--border);border-radius:12px;" placeholder="A sentence is enough."></textarea>
         <div class="hero-actions"><button class="button" data-decline-send="${escapeHtml(item.id)}" type="button">Save my answer</button><button class="button ghost" data-decline-cancel="${escapeHtml(item.id)}" type="button">Never mind</button></div>
       </div>`
    : group === 'published'
      ? `<div class="hero-actions"><button class="button alt" data-decide="take-down" data-id="${escapeHtml(item.id)}" type="button">Take it off my site</button></div>`
      : '';
  return `<article class="soft-panel" data-item="${escapeHtml(item.id)}">
    <h3>${escapeHtml(item.title)}</h3>
    <p class="muted small">${escapeHtml(typeLabel(item))} &#183; ${escapeHtml(whenLine(item, group))}</p>
    <div class="hero-actions">
      <a class="button alt small-button" href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">Read it</a>
      <a class="button ghost small-button" href="${escapeHtml(editLink(item))}" rel="noopener noreferrer" target="_blank">Edit in GitHub</a>
    </div>
    ${decide}
    <p class="small" data-result="${escapeHtml(item.id)}"></p>
  </article>`;
}

function renderReview() {
  const items = ADMIN_ITEMS.filter((item) => groupFor(item) === 'ready').sort((a, b) => String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')));
  const list = document.getElementById('review-list');
  const summary = document.getElementById('review-summary');
  const counts = {
    ready: items.length,
    scheduled: ADMIN_ITEMS.filter((item) => groupFor(item) === 'scheduled').length,
    published: ADMIN_ITEMS.filter((item) => groupFor(item) === 'published').length,
    declined: ADMIN_ITEMS.filter((item) => groupFor(item) === 'declined').length
  };
  // A bare 0 on a card cannot be told apart from a page that failed to load, so
  // every number is a sentence.
  if (summary) {
    summary.innerHTML = counts.ready
      ? `<strong>${counts.ready} ${counts.ready === 1 ? 'piece is' : 'pieces are'} waiting for your OK.</strong> Nothing here goes on your website until you approve it. `
        + `Elsewhere: ${counts.scheduled} approved and waiting for ${counts.scheduled === 1 ? 'its date' : 'their dates'}, ${counts.published} already live, ${counts.declined} not going out.`
      : `<strong>Nothing needs your OK right now.</strong> ${counts.scheduled} approved and waiting for ${counts.scheduled === 1 ? 'its date' : 'their dates'}, ${counts.published} already live, ${counts.declined} not going out.`;
  }
  if (list) list.innerHTML = items.length ? items.map((item) => itemCard(item, 'ready')).join('') : '';
}

function getFilters() {
  return {
    q: (document.getElementById('admin-search')?.value || '').trim().toLowerCase(),
    status: document.getElementById('status-filter')?.value || 'all',
    type: document.getElementById('type-filter')?.value || 'all',
    sort: document.getElementById('sort-filter')?.value || 'date-asc'
  };
}

// The browse view is a table, not a stack of cards.
//
// Cards are right for the review queue, where there are few items and each one
// needs a decision. For "everything" they are wrong: 233 cards is a scroll wall
// with no columns to scan and no way to compare two rows. This is the grid that
// was here before, kept deliberately -- title, kind, date, status, and the two
// links on every row including Edit in GitHub.
function statusChip(group) {
  const label = { ready: 'Waiting for your OK', published: 'Published', scheduled: 'Approved', declined: 'Revoked' }[group] || '';
  return `<span class="pill pill-${escapeHtml(group)}">${escapeHtml(label)}</span>`;
}

function itemRow(item, group) {
  const href = readItLink(item);
  const when = friendlyDate(sortKeyDate(item), false);
  const decide = group === 'ready'
    ? `<button class="button small-button" data-decide="approve" data-id="${escapeHtml(item.id)}" type="button">Approve</button>`
    : group === 'published'
      ? `<button class="button ghost small-button" data-decide="take-down" data-id="${escapeHtml(item.id)}" type="button">Take off</button>`
      : '';
  return `<tr data-item="${escapeHtml(item.id)}">
    <td>${escapeHtml(item.title)}<span class="small" data-result="${escapeHtml(item.id)}"></span></td>
    <td>${escapeHtml(typeLabel(item))}</td>
    <td class="nowrap">${escapeHtml(when)}</td>
    <td>${statusChip(group)}</td>
    <td class="nowrap">
      <a class="button alt small-button" href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${group === 'published' ? 'Read it' : 'Preview'}</a>
      <a class="button ghost small-button" href="${escapeHtml(editLink(item))}" rel="noopener noreferrer" target="_blank">Edit in GitHub</a>
      ${decide}
    </td>
  </tr>`;
}

function browseTable(rows) {
  if (!rows.length) return '';
  return `<div class="table-scroll"><table class="admin-table">
    <thead><tr><th>Title</th><th>Kind</th><th>Date</th><th>Status</th><th>Open it</th></tr></thead>
    <tbody>${rows.map((r) => itemRow(r.item, r.group)).join('')}</tbody>
  </table></div>`;
}

function renderBrowse() {
  const filters = getFilters();
  let out = ADMIN_ITEMS.map((item) => ({ item, group: groupFor(item) })).filter((row) => row.group !== 'draft');
  if (filters.status !== 'all') out = out.filter((row) => row.group === filters.status);
  if (filters.type !== 'all') out = out.filter((row) => (row.item.contentType || '') === filters.type);
  if (filters.q) out = out.filter((row) => String(row.item.title || '').toLowerCase().includes(filters.q));
  const [field, direction] = filters.sort.split('-');
  out.sort((a, b) => {
    const av = field === 'title' ? String(a.item.title || '') : sortKeyDate(a.item);
    const bv = field === 'title' ? String(b.item.title || '') : sortKeyDate(b.item);
    return direction === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
  });
  const labels = { ready: 'waiting for your OK', published: 'already published', scheduled: 'approved and not yet published', declined: 'revoked', all: 'in total' };
  const summary = document.getElementById('filter-summary');
  if (summary) {
    summary.textContent = out.length
      ? `Showing ${out.length} ${out.length === 1 ? 'piece' : 'pieces'} ${labels[filters.status] || ''}.`.replace(/\s+\./, '.')
      : 'Nothing matches what you asked for. Try "Everything".';
  }
  const list = document.getElementById('browse-list');
  if (!list) return;
  // Revoked used to be folded behind a disclosure because it was the biggest
  // and least actionable group. It is now something she picks on purpose from
  // the filter, so hiding it would be hiding exactly what she asked to see.
  list.innerHTML = browseTable(out);
}

function renderGeneratedCandidates() {
  const panel = document.getElementById('generated-content-panel');
  const tbody = document.getElementById('generated-candidates-tbody');
  if (!panel || !tbody) return;
  // Nothing to say means say nothing. An empty section with a scoreboard of
  // zeroes is noise on the page where she makes decisions.
  if (!GENERATED_CANDIDATES.length) { panel.hidden = true; tbody.innerHTML = ''; return; }
  panel.hidden = false;
  tbody.innerHTML = GENERATED_CANDIDATES.map((item) => {
    const status = item.autonomyStatus || item.status || 'DISCOVERED';
    const written = /DRAFTED|VALIDATED|SCHEDULED/i.test(String(status));
    return `<tr>
      <td>${escapeHtml(item.title || 'Untitled idea')}</td>
      <td>${escapeHtml(typeLabel(item))}</td>
      <td>${written ? 'Written and being checked. It will appear above for your OK.' : 'Not written yet. It will appear above for your OK once it is.'}</td>
    </tr>`;
  }).join('');
}

/* ---------------- Is my site running? ---------------- */

function renderSiteState() {
  const headline = document.getElementById('site-state-headline');
  const detail = document.getElementById('site-state-detail');
  const pause = document.querySelector('[data-site-control="pause"]');
  const resume = document.querySelector('[data-site-control="resume"]');
  const stop = document.querySelector('[data-site-control="stop"]');
  if (!headline || !detail) return;
  const stopped = SITE_STATE.emergencyStop === true;
  const paused = SITE_STATE.paused === true;
  if (stopped) {
    headline.textContent = 'Stopped by you';
    detail.textContent = `Stopped on ${friendlyDate(SITE_STATE.stoppedAt || SITE_STATE.adminUpdatedAt, false) || 'an earlier date'}. Nothing will run at all until you turn it back on. Everything already on your website is still there.`;
  } else if (paused) {
    headline.textContent = 'Paused by you';
    detail.textContent = `Paused on ${friendlyDate(SITE_STATE.pausedAt || SITE_STATE.adminUpdatedAt, false) || 'an earlier date'}. Nothing new will be written or published until you start again. Everything already on your website is still there.`;
  } else {
    headline.textContent = 'Everything is running normally';
    detail.textContent = `Last checked ${friendlyDate(SITE_STATE.lastCycleAt, false) || 'recently'}.`;
  }
  if (pause) pause.hidden = paused || stopped;
  if (stop) stop.hidden = stopped;
  if (resume) resume.hidden = !(paused || stopped);
}

async function sendSiteControl(action) {
  const result = document.getElementById('site-state-result');
  const name = deciderName();
  if (result) result.textContent = 'Saving.';
  const response = await fetch('/api/admin/action', {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ action, by: name })
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => null) : null;
  if (!response || !response.ok) {
    if (result) result.textContent = payload?.message || payload?.error || 'That could not be saved, so nothing changed. Nothing on your website was affected.';
    return;
  }
  SITE_STATE = payload?.receipt?.result?.autonomyState || SITE_STATE;
  renderSiteState();
  if (result) result.textContent = action === 'pause' ? 'Paused. Nothing new will go out.' : action === 'emergency-stop' ? 'Stopped. Nothing will run.' : 'Started again. Everything is running normally.';
}

function bindSiteControls() {
  const confirmBox = document.getElementById('site-state-confirm');
  document.querySelectorAll('[data-site-control]').forEach((button) => {
    button.addEventListener('click', () => {
      const control = button.getAttribute('data-site-control');
      if (control === 'stop') { if (confirmBox) confirmBox.hidden = false; return; }
      sendSiteControl(control === 'pause' ? 'pause' : 'resume');
    });
  });
  const yes = document.getElementById('site-state-confirm-yes');
  const no = document.getElementById('site-state-confirm-no');
  if (yes) yes.addEventListener('click', () => { if (confirmBox) confirmBox.hidden = true; sendSiteControl('emergency-stop'); });
  if (no) no.addEventListener('click', () => { if (confirmBox) confirmBox.hidden = true; });
}

/* ---------------- Her decision ---------------- */

async function sendDecision(id, decision, body) {
  const result = document.querySelector(`[data-result="${CSS.escape(id)}"]`);
  const name = deciderName();
  if (!name) {
    if (result) result.textContent = 'Please type your name at the top of the page first. Every decision is saved with the name of the person who made it.';
    document.getElementById('decider-name')?.focus();
    return;
  }
  rememberDecider(name);
  if (result) result.textContent = 'Saving your answer.';
  const response = await fetch(`/api/admin/content/${decision}`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id, by: name, ...(body || {}) })
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => null) : null;
  if (!response || !response.ok) {
    if (result) result.textContent = payload?.message || payload?.error || 'That could not be saved, so nothing changed.';
    return;
  }
  if (decision === 'approve') {
    APPROVAL_RECORD.approvals = [...(APPROVAL_RECORD.approvals || []), payload.record];
    if (result) result.textContent = `Approved. It goes out on its date and needs nothing more from you.`;
  } else if (decision === 'decline') {
    DECLINE_RECORD.declines = [...(DECLINE_RECORD.declines || []), payload.record];
    if (result) result.textContent = 'Saved. This one will not go out, and your reason is kept with it.';
  } else {
    const item = ADMIN_ITEMS.find((entry) => entry.id === id);
    if (item) { item.status = 'revoked'; item.revokedAt = payload.record.revokedAt; item.revokedReason = payload.record.reason; }
    if (result) result.textContent = 'Taken off your website. It moves to "Not going out".';
  }
  window.setTimeout(() => { renderReview(); renderBrowse(); }, 1200);
}

// Approve everything still waiting, in one action.
//
// Monika approved this calendar once already, in June. Asking her to click 112
// times to say the same thing again is not a safeguard, it is a chore -- and a
// chore she will abandon halfway, leaving the site half-published. One button,
// one confirmation naming the exact count, then it is done.
async function approveAll() {
  const pending = ADMIN_ITEMS.filter((item) => groupFor(item) === 'ready');
  const status = document.getElementById('approve-all-status');
  const button = document.getElementById('approve-all');
  if (!pending.length) { if (status) status.textContent = 'Nothing is waiting for your OK.'; return; }
  const name = deciderName();
  if (!name) {
    if (status) status.textContent = 'Please type your name at the top of the page first.';
    document.getElementById('decider-name')?.focus();
    return;
  }
  const what = `${pending.length} ${pending.length === 1 ? 'piece' : 'pieces'}`;
  if (!window.confirm(`Approve ${what}? Each one still goes out on its own date, not all at once. You can take any of them off later.`)) return;
  if (button) button.disabled = true;
  rememberDecider(name);
  let done = 0;
  const failed = [];
  for (const item of pending) {
    if (status) status.textContent = `Approving ${done + 1} of ${pending.length}.`;
    const response = await fetch('/api/admin/content/approve', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ id: item.id, by: name })
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok) { failed.push(item.id); continue; }
    APPROVAL_RECORD.approvals = [...(APPROVAL_RECORD.approvals || []), payload.record];
    done += 1;
  }
  if (button) button.disabled = false;
  // Report what actually happened. A partial run that claims success is worse
  // than a visible failure, because the gap is invisible until a date passes.
  if (status) {
    status.textContent = failed.length
      ? `Approved ${done}. ${failed.length} could not be saved and are still waiting - try those again.`
      : `Approved all ${done}. Each goes out on its own date. Nothing more is needed from you.`;
  }
  renderReview();
  renderBrowse();
}

function bindDecisions() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-decide], [data-decline-send], [data-decline-cancel]');
    if (!button) return;
    const declineId = button.getAttribute('data-decline-send') || button.getAttribute('data-decline-cancel');
    if (declineId) {
      const box = document.querySelector(`[data-decline-box="${CSS.escape(declineId)}"]`);
      if (button.hasAttribute('data-decline-cancel')) { if (box) box.hidden = true; return; }
      const reason = box?.querySelector('textarea')?.value.trim() || '';
      if (!reason) { const result = document.querySelector(`[data-result="${CSS.escape(declineId)}"]`); if (result) result.textContent = 'Please say why, in a sentence.'; return; }
      if (box) box.hidden = true;
      sendDecision(declineId, 'decline', { reason });
      return;
    }
    const id = button.getAttribute('data-id');
    const decision = button.getAttribute('data-decide');
    if (!id || !decision) return;
    if (decision === 'decline') {
      const box = document.querySelector(`[data-decline-box="${CSS.escape(id)}"]`);
      if (box) { box.hidden = false; box.querySelector('textarea')?.focus(); }
      return;
    }
    if (decision === 'take-down' && !window.confirm('Take this off your website? People will no longer be able to read it.')) return;
    sendDecision(id, decision);
  });
}

function bindApproveAll() {
  document.getElementById('approve-all')?.addEventListener('click', approveAll);
}

function bindFilters() {
  ['admin-search', 'status-filter', 'type-filter', 'sort-filter'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', renderBrowse);
    el.addEventListener('change', renderBrowse);
  });
  document.querySelectorAll('[data-status-shortcut]').forEach((button) => {
    button.addEventListener('click', () => {
      const select = document.getElementById('status-filter');
      if (select) select.value = button.getAttribute('data-status-shortcut') || 'all';
      renderBrowse();
    });
  });
  const name = document.getElementById('decider-name');
  if (name) {
    try { name.value = localStorage.getItem(DECIDER_KEY) || ''; } catch (error) {}
    name.addEventListener('change', () => rememberDecider(name.value.trim()));
  }
}

async function renderAdmin() {
  const [manifest, config, approvals, declines, state, briefPayload, publishQueue] = await Promise.all([
    fetchJson('/data/admin/content_manifest.json'),
    fetchJson('/data/system/config.json'),
    fetchJson('/data/admin/publication_approvals.json'),
    fetchJson('/data/admin/publication_declines.json'),
    fetchJson('/data/autonomy/state.json'),
    fetchJson('/data/intake/content_brief_candidates.json'),
    fetchJson('/data/social/publish_queue.json')
  ]);
  if (!Array.isArray(manifest)) {
    const summary = document.getElementById('review-summary');
    if (summary) summary.textContent = 'Your content could not be loaded just now. Please refresh the page.';
    return;
  }
  ADMIN_ITEMS = manifest;
  ADMIN_CONFIG = config || {};
  APPROVAL_RECORD = approvals && Array.isArray(approvals.approvals) ? approvals : { approvals: [] };
  DECLINE_RECORD = declines && Array.isArray(declines.declines) ? declines : { declines: [] };
  SITE_STATE = state || {};
  GENERATED_CANDIDATES = Array.isArray(briefPayload?.candidates) ? briefPayload.candidates : [];
  PUBLISH_QUEUE_ITEMS = Array.isArray(publishQueue?.items) ? publishQueue.items : [];
  bindFilters();
  renderSiteState();
  renderReview();
  renderBrowse();
  renderGeneratedCandidates();
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
  document.dispatchEvent(new CustomEvent('hicks-admin-unlocked'));
}

function lockAdmin() {
  sessionStorage.removeItem(SESSION_KEY);
  clearAdminAuthHash();
  document.getElementById('admin-panel').hidden = true;
  document.getElementById('login-panel').hidden = false;
  document.getElementById('admin-password').value = '';
  document.dispatchEvent(new CustomEvent('hicks-admin-locked'));
}

window.unlockAdmin = unlockAdmin;
window.lockAdmin = lockAdmin;

document.addEventListener('DOMContentLoaded', async () => {
  wireMobileNav();
  wireThemeToggle();
  bindDecisions();
  bindApproveAll();
  bindSiteControls();
  const storedHash = getAdminAuthHash();
  if (storedHash === ADMIN_PASSWORD_HASH || sessionStorage.getItem(SESSION_KEY) === 'true') {
    sessionStorage.setItem(SESSION_KEY, 'true');
    if (storedHash !== ADMIN_PASSWORD_HASH) setAdminAuthHash(ADMIN_PASSWORD_HASH);
    await renderAdmin();
    document.dispatchEvent(new CustomEvent('hicks-admin-unlocked'));
  } else {
    sessionStorage.removeItem(SESSION_KEY);
    clearAdminAuthHash();
  }
});
