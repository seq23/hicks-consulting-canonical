(() => {
  'use strict';
  const gate = window.HicksAdminGate;
  // Canonical lifecycle examples rendered by this cockpit: SCHEDULED and SKIPPED_UNSUPPORTED_CLAIM.
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  const fmt = (value) => value ? new Date(value).toLocaleString() : '—';
  const badge = (status) => `<span class="agency-status ${/healthy|connected|success|published|scheduled|safe|active/i.test(status) ? 'good' : /failed|blocked|error|emergency|disconnected/i.test(status) ? 'warn' : 'neutral'}">${esc(status || 'unknown')}</span>`;

  async function api(path, options = {}) {
    const headers = gate.authHeaders({ ...(options.headers || {}) });
    if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
    const body = await response.json().catch(() => ({ ok:false, error:`HTTP ${response.status}` }));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function velocityText(contract = {}) {
    const cadence = contract.cadence || contract.lockedCadence || {};
    const values = [];
    const map = [['insights','weekday reflections'],['articles','substantial article'],['guides','pillar/guide'],['white-papers','flagship guide/white paper']];
    for (const [key,label] of map) {
      const value = cadence[key] || cadence[key.replace('-', '_')];
      if (value) values.push(`${esc(String(value))} ${label}`);
    }
    return values.length ? values.join(' · ') : 'Existing repository cadence remains authoritative and unchanged.';
  }

  function renderAutonomyQueue(queue = {}) {
    const items = Array.isArray(queue.items) ? queue.items : [];
    $('autonomy-queue-count').textContent = String(items.length);
    $('autonomy-queue-tbody').innerHTML = items.length ? items.slice().sort((a,b) => String(a.scheduledFor || a.updatedAt || '').localeCompare(String(b.scheduledFor || b.updatedAt || ''))).map((item) => `
      <tr>
        <td><strong>${esc(item.title || item.id)}</strong><div class="muted small">${esc(item.id || '')}</div></td>
        <td>${esc(item.contentType || item.type || '—')}</td>
        <td>${esc(item.targetQuery || item.query || item.cluster || '—')}</td>
        <td>${badge(item.status)}</td>
        <td>${esc(item.scheduledFor || item.publishAt || 'Backlog')}</td>
        <td>${esc(item.lastDecision || item.decision || item.status || 'DISCOVERED')}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted">No autonomous candidates are currently queued.</td></tr>';
  }

  function renderProviders(providers = {}) {
    const entries = Object.entries(providers.providers || providers.capabilities || providers).filter(([,v]) => v && typeof v === 'object');
    $('provider-health').innerHTML = entries.length ? entries.map(([name,value]) => `<div class="agency-health-row"><div>${badge(value.status || value.state || 'unknown')}<strong>${esc(name)}</strong><p>${esc(value.message || value.reason || value.description || '')}</p></div></div>`).join('') : '<p class="muted">No provider capability data found.</p>';
    const connected = entries.filter(([,v]) => /connected|healthy|configured/i.test(v.status || v.state || '')).length;
    $('provider-summary').textContent = `${connected} of ${entries.length} provider capabilities currently report connected/configured.`;
  }

  function renderSelfHeal(state = {}) {
    const rows = [
      ['Status', state.status || state.state || 'IDLE'],
      ['Last run', fmt(state.lastRunAt || state.updatedAt)],
      ['Repairs', state.repairsApplied ?? state.repaired ?? 0],
      ['Skipped protected', state.skippedProtected ?? 0],
      ['Rollback available', state.rollbackAvailable === false ? 'No' : 'Yes']
    ];
    $('self-heal-state').innerHTML = rows.map(([label,value]) => `<div class="agency-health-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function renderFreeWins(data = {}) {
    const items = Array.isArray(data.items) ? data.items : [];
    $('free-wins-list').innerHTML = items.length ? `<ol class="agency-tip-list">${items.slice(0,10).map((item) => `<li><strong>${esc(item.query || item.title || item.type || 'Opportunity')}</strong><br><span class="muted small">${esc(item.recommendation || item.action || item.reason || '')}</span></li>`).join('')}</ol>` : '<p class="muted">No observed free wins yet. Modeled opportunities are not presented as live performance.</p>';
  }

  function renderExceptions(data = {}) {
    const items = Array.isArray(data.items) ? data.items : [];
    $('exception-count').textContent = String(items.length);
    $('exception-list').innerHTML = items.length ? `<ol class="agency-tip-list">${items.slice(-10).reverse().map((item) => `<li>${badge(item.status || item.decision || 'exception')} <strong>${esc(item.title || item.id || item.route || 'Item')}</strong><br><span class="muted small">${esc(item.reason || item.message || '')}</span></li>`).join('')}</ol>` : '<p class="muted">No recorded autonomy exceptions.</p>';
  }

  function renderStatus(status) {
    const state = status.state || {};
    $('login-panel').hidden = true;
    $('admin-panel').hidden = false;
    $('system-state-label').innerHTML = `${badge(state.emergencyStop ? 'EMERGENCY STOP' : state.paused ? 'PAUSED' : state.mode || 'FULL_SAFE_AUTONOMY')} ${state.emergencyStop ? 'Automation is stopped.' : state.paused ? 'Automation is paused.' : 'Automation is active.'}`;
    $('manifest-total').textContent = String(status.manifest?.total || 0);
    $('notification-count').textContent = String(status.notifications?.items?.length || 0);
    $('velocity-summary').textContent = velocityText(status.velocity);
    renderAutonomyQueue(status.queue);
    renderProviders(status.providers);
    renderSelfHeal(status.selfHeal);
    renderFreeWins(status.freeWins);
    renderExceptions(status.exceptions);
  }

  async function loadGate() {
    if (!gate?.isUnlocked()) {
      $('login-panel').hidden = false;
      $('admin-panel').hidden = true;
      return;
    }
    try {
      renderStatus(await api('/api/admin/status'));
    } catch (error) {
      gate.lock();
      $('login-message').textContent = error.message;
      $('login-panel').hidden = false;
      $('admin-panel').hidden = true;
    }
  }

  async function login(event) {
    event.preventDefault();
    $('login-message').textContent = 'Checking password…';
    const ok = await gate.unlock($('admin-password').value);
    if (!ok) {
      $('login-message').textContent = 'Password did not match.';
      return;
    }
    $('admin-password').value = '';
    $('login-message').textContent = '';
    const next = new URLSearchParams(location.search).get('next');
    if (next === 'agency') { location.href = '/agency/'; return; }
    try { renderStatus(await api('/api/admin/status')); }
    catch (error) { $('login-message').textContent = error.message; }
  }

  async function runAction(button) {
    const action = button.dataset.adminAction;
    const destructive = ['emergency-stop','pause'].includes(action);
    if (destructive && !window.confirm(`${button.textContent.trim()}? This changes live automation state and will create a GitHub receipt.`)) return;
    const original = button.innerHTML;
    button.disabled = true; button.textContent = 'Running…';
    try {
      const result = await api('/api/admin/action', { method:'POST', body:JSON.stringify({ action }) });
      const receipt = result.receipt;
      $('action-receipt').innerHTML = `<strong>${esc(receipt.status)} — ${esc(receipt.action)}</strong><p class="small">Receipt ${esc(receipt.id)} · ${esc(fmt(receipt.completedAt))}</p><pre>${esc(JSON.stringify(receipt.result || {}, null, 2))}</pre>`;
      renderStatus(await api('/api/admin/status'));
    } catch (error) { $('action-receipt').innerHTML = `<strong>Action failed</strong><p>${esc(error.message)}</p>`; }
    finally { button.disabled = false; button.innerHTML = original; }
  }

  async function submitFeedback(event) {
    event.preventDefault();
    const message = $('feedback-message'); message.textContent = 'Submitting…';
    try {
      const result = await api('/api/admin/feedback', { method:'POST', body:JSON.stringify({ route:$('feedback-route').value, feedback:$('feedback-text').value }) });
      message.textContent = `Received as ${result.record.id}.`;
      event.target.reset();
    } catch (error) { message.textContent = error.message; }
  }

  function logout() {
    gate.lock();
    $('admin-panel').hidden = true;
    $('login-panel').hidden = false;
    $('admin-password').value = '';
  }

  $('admin-login-form')?.addEventListener('submit', login);
  $('logout-button')?.addEventListener('click', logout);
  $('feedback-form')?.addEventListener('submit', submitFeedback);
  document.querySelectorAll('[data-admin-action]').forEach((button) => button.addEventListener('click', () => runAction(button)));
  loadGate();
})();
