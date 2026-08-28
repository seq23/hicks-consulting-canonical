(() => {
  'use strict';

  const gate = window.HicksAdminGate;
  let report = null;
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
  const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
  const num = (value) => new Intl.NumberFormat().format(Number(value) || 0);
  const date = (value) => value ? new Date(value).toLocaleString() : 'Not yet refreshed';

  function normalizeStatus(value, fallback = 'NOT REPORTED') {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
    const labels = {
      ok: 'HEALTHY',
      healthy: 'HEALTHY',
      connected: 'CONNECTED',
      success: 'SUCCESS',
      warning: 'ATTENTION',
      not_connected: 'CONNECTION REQUIRED',
      disconnected: 'CONNECTION REQUIRED',
      integrated_unproven: 'CONNECTION REQUIRED',
      not_run: 'NOT RUN',
      unavailable: 'NOT AVAILABLE',
      failed: 'FAILED',
      error: 'ERROR',
      paused: 'PAUSED',
      full_safe_autonomy: 'FULL SAFE AUTONOMY'
    };
    return labels[key] || raw.replaceAll('_', ' ').toUpperCase();
  }

  function statusClass(value) {
    const label = normalizeStatus(value);
    if (/HEALTHY|CONNECTED|SUCCESS|FULL SAFE AUTONOMY|PASS/.test(label)) return 'good';
    if (/FAILED|ERROR|ATTENTION|EMERGENCY/.test(label)) return 'warn';
    return 'neutral';
  }

  function renderScores() {
    const scores = Array.isArray(report?.scores) ? report.scores : [];
    $('score-grid').innerHTML = scores.length ? scores.map((item) => `
      <article class="agency-score-card ${item.targetMet ? 'target-met' : 'target-missed'}">
        <div class="agency-score-top"><span class="agency-grade">${escapeHtml(item.grade)}</span><strong>${escapeHtml(item.label)}</strong></div>
        <div class="agency-score-number">${num(item.score)}<span>/100</span></div>
        <div class="agency-progress"><span style="width:${Number(item.score) || 0}%"></span></div>
        <p>${escapeHtml(item.summary)}</p>
        <small>${item.targetMet ? 'B+ target met' : `Needs ${Math.max(0, Number(item.target || 87) - Number(item.score || 0))} point(s) to reach B+`}</small>
      </article>`).join('') : '<p class="muted">Scorecard has not been generated yet.</p>';
  }

  function providerCopy(provider, item) {
    if (String(item?.status || '').toLowerCase() === 'not_connected') {
      return provider === 'gsc'
        ? 'Connection required. Follow the Google Search Console steps below, add encrypted credentials, and run the connection workflow.'
        : 'Connection required. Follow the Bing Webmaster Tools steps below, add the encrypted API key, and run the connection workflow.';
    }
    return item?.message || 'No provider message has been recorded yet.';
  }

  function healthCard(provider, label) {
    const item = report?.health?.[provider] || {};
    const display = normalizeStatus(item.status, provider === 'live' ? 'NOT RUN' : 'CONNECTION REQUIRED');
    return `<div class="agency-health-row"><div><span class="agency-status ${statusClass(display)}">${escapeHtml(display)}</span><strong>${escapeHtml(label)}</strong><p>${escapeHtml(providerCopy(provider, item))}</p></div><small>Checked: ${escapeHtml(date(item.checkedAt))}</small></div>`;
  }

  function updateConnectionPanel() {
    const gsc = report?.health?.gsc || {};
    const bing = report?.health?.bing || {};
    const gscConnected = /connected|ok|healthy/i.test(String(gsc.status || ''));
    const bingConnected = /connected|ok|healthy/i.test(String(bing.status || ''));
    if ($('gsc-connection-status')) {
      $('gsc-connection-status').textContent = gscConnected ? 'Connected' : 'Connection required';
      $('gsc-connection-status').className = `agency-status ${gscConnected ? 'good' : 'neutral'}`;
    }
    if ($('gsc-connection-message')) $('gsc-connection-message').textContent = gscConnected
      ? `Last successful refresh: ${date(gsc.checkedAt)}`
      : 'Complete the setup steps below. The dashboard will not invent search performance while the provider is disconnected.';
    if ($('bing-connection-status')) {
      $('bing-connection-status').textContent = bingConnected ? 'Connected' : 'Connection required';
      $('bing-connection-status').className = `agency-status ${bingConnected ? 'good' : 'neutral'}`;
    }
    if ($('bing-connection-message')) $('bing-connection-message').textContent = bingConnected
      ? `Last successful refresh: ${date(bing.checkedAt)}`
      : 'Complete the setup steps below. The dashboard will not invent search performance while the provider is disconnected.';
  }

  function renderHealth() {
    $('search-health').innerHTML = healthCard('gsc', 'Google Search Console') + healthCard('bing', 'Bing Webmaster Tools');
    const live = report?.health?.live || {};
    const checks = Array.isArray(live.checks) ? `<div class="agency-live-checks">${live.checks.map((check) => `<div><span class="agency-dot ${check.ok ? 'good' : 'warn'}"></span><code>${escapeHtml(check.route)}</code><span>${escapeHtml(check.status || 'NO RESPONSE')}</span><small>${escapeHtml(check.ms ?? '—')}ms</small></div>`).join('')}</div>` : '';
    $('live-health').innerHTML = healthCard('live', 'Monitored routes') + checks;
    updateConnectionPanel();
  }

  function renderPerformance() {
    const gsc = report?.health?.gsc || {};
    const metrics = gsc.metrics || {};
    const delta = (current, previous) => previous ? `${(((current - previous) / previous) * 100).toFixed(1)}%` : '—';
    const cards = [
      ['Google clicks', num(metrics.clicks), delta(metrics.clicks, metrics.previousClicks)],
      ['Google impressions', num(metrics.impressions), delta(metrics.impressions, metrics.previousImpressions)],
      ['Google CTR', pct(metrics.ctr), delta(metrics.ctr, metrics.previousCtr)],
      ['Average position', metrics.position ? Number(metrics.position).toFixed(1) : '—', metrics.previousPosition ? `prior ${Number(metrics.previousPosition).toFixed(1)}` : '—']
    ];
    $('performance-metrics').innerHTML = cards.map(([label, value, change]) => `<div class="agency-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(change)}</small></div>`).join('');
    const rows = [
      ...(gsc.topQueries || []).slice(0, 10).map((row) => ({ label: `Query: ${(row.keys || [])[0] || ''}`, ...row })),
      ...(gsc.topPages || []).slice(0, 10).map((row) => ({ label: `Page: ${(row.keys || [])[0] || ''}`, ...row }))
    ];
    $('performance-table').innerHTML = rows.length
      ? rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${num(row.clicks)}</td><td>${num(row.impressions)}</td><td>${pct(row.ctr)}</td><td>${Number(row.position || 0).toFixed(1)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">Connection required. Complete the GSC setup below to populate real query and page performance.</td></tr>';
  }

  function renderAutonomy() {
    const autonomy = report?.autonomy || {};
    const state = autonomy.state || {};
    const velocity = autonomy.velocityContract || {};
    const cadence = velocity.editorialReleaseVelocity || {};
    const stateLabel = state.emergencyStop ? 'EMERGENCY STOP' : state.paused ? 'PAUSED' : normalizeStatus(state.runtimeMode, 'FULL SAFE AUTONOMY');
    const lastCycle = state.lastCycleStatus ? normalizeStatus(state.lastCycleStatus, 'NOT RUN') : 'NOT RUN';
    const draftingProvider = state.draftingProvider || {};
    const draftingStatus = draftingProvider.configured ? 'CONFIGURED' : normalizeStatus(draftingProvider.status, 'NOT CONFIGURED');
    const lastDraft = draftingProvider.lastSuccessfulDraftAt ? date(draftingProvider.lastSuccessfulDraftAt) : 'No successful autonomous draft recorded';
    $('autonomy-health').innerHTML = `<div class="agency-health-row"><div><span class="agency-status ${statusClass(stateLabel)}">${escapeHtml(stateLabel)}</span><strong>${escapeHtml(lastCycle)}</strong><p>Routine approval is off. Exceptions skip, record, and continue unless system integrity is at risk.</p></div></div><div class="agency-health-row"><div><span class="agency-status ${statusClass(draftingStatus)}">${escapeHtml(draftingStatus)}</span><strong>Autonomous drafting provider</strong><p>${escapeHtml(lastDraft)}${draftingProvider.lastProviderGate ? ` · ${escapeHtml(normalizeStatus(draftingProvider.lastProviderGate))}` : ''}</p></div><small>LLM drafting state is runtime-derived; NOT CONFIGURED is not treated as success.</small></div><div class="agency-health-row"><div><strong>Immutable existing cadence</strong><p>${escapeHtml(Object.values(cadence).map((item) => item.description).filter(Boolean).join(' · ') || 'Cadence contract not loaded')}</p></div><small>${escapeHtml(velocity.authority || 'Repo-defined cadence')}</small></div>`;
    const heal = autonomy.selfHeal || {};
    const healStatus = normalizeStatus(heal.status, 'NOT RUN');
    $('self-heal-health').innerHTML = `<div class="agency-health-row"><div><span class="agency-status ${statusClass(healStatus)}">${escapeHtml(healStatus)}</span><strong>Last run: ${escapeHtml(date(heal.lastRunAt))}</strong><p>${num((heal.repairs || []).length)} repair(s) · ${num((heal.skips || []).length)} skip(s). Accepted content changes only through scoped, validated, reversible revisions.</p></div></div>`;
  }

  function healthBadge(status) {
    const label = normalizeStatus(status, 'NOT REPORTED');
    return `<span class="agency-status ${statusClass(label)}">${escapeHtml(label)}</span>`;
  }

  function renderSearchIntelligence() {
    const intel = report?.searchIntelligence || {};
    const queries = intel.targetQueries?.queries || intel.targetQueries?.items || [];
    const observations = intel.queryObservations || {};
    const actionQueue = intel.searchActions?.items || [];
    const repairs = intel.searchRepairs || {};
    const providerHealth = intel.providerHealth?.providers || {};
    const observationByQuery = new Map((observations.observations || []).map((item) => [String(item.query || '').toLowerCase(), item]));
    const actionByQuery = new Map(actionQueue.map((item) => [String(item.query || '').toLowerCase(), item]));
    $('target-query-table').innerHTML = queries.length ? queries.map((item) => {
      const obs = observationByQuery.get(String(item.query || '').toLowerCase());
      const action = actionByQuery.get(String(item.query || '').toLowerCase());
      const evidence = action ? `${action.status} · GSC ${num(action.evidence?.gscImpressions)} impressions · avg ${Number(action.evidence?.gscAveragePosition || 0).toFixed(1)} · grounded ${obs?.status !== 'ok' ? 'provider did not answer' : obs.siteSurfaced ? 'surfaced' : 'not surfaced'}` : 'Awaiting live query cycle';
      return `<tr><td><strong>${escapeHtml(item.query)}</strong></td><td><a href="${escapeHtml(item.primaryPage || item.route || '#')}">${escapeHtml(item.primaryPage || item.route || 'Unassigned')}</a></td><td>${escapeHtml(item.intent || item.cluster || '—')}</td><td>${escapeHtml(evidence)}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="muted">No governed target-query registry found.</td></tr>';
    const provider = providerHealth.openrouter_web_search || {};
    const repairRows = repairs.lastRunRepairs || [];
    $('free-win-panel').innerHTML = `<p>${healthBadge(provider.state || observations.providerState || 'NOT_CONFIGURED')} Live query provider</p><p class="muted small">${escapeHtml(intel.truthBoundary || observations.truthBoundary || '')}</p><p><strong>${num(actionQueue.filter(x => x.status === 'OBSERVED').length)}</strong> observed · <strong>${num(actionQueue.filter(x => x.status === 'MISSING').length)}</strong> missing · <strong>${num(repairRows.length)}</strong> bounded repair(s) last cycle.</p>${repairRows.length ? '<ul>' + repairRows.slice(0,12).map(r => `<li><code>${escapeHtml(r.route)}</code> — ${escapeHtml((r.queries||[]).join(' · '))} — awaiting external retest</li>`).join('') + '</ul>' : '<p class="muted">No bounded repair was needed in the last recorded cycle.</p>'}`;
    const observed = observations.observations || [];
    $('competitor-panel').innerHTML = `<p>${healthBadge(observations.providerState || 'NOT_CONFIGURED')} Grounded competitor observations</p>${observed.length ? '<ul>' + observed.slice(0,10).map(item => `<li><strong>${escapeHtml(item.query)}</strong> — Hicks ${item.status !== 'ok' ? 'unproven (provider did not answer)' : item.siteSurfaced ? 'surfaced' : 'not surfaced'}; ${num((item.competitors||[]).length)} competitor page(s) inspected. ${escapeHtml((item.diagnosis||[]).join(', '))}</li>`).join('') + '</ul>' : '<p class="muted">No grounded query observations are recorded yet. The scheduled workflow will populate these after the OpenRouter secret is configured.</p>'}`;
  }

  function renderTips() {
    $('aeo-tips').innerHTML = (report?.tips?.aeo || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join('');
    $('geo-tips').innerHTML = (report?.tips?.geo || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join('');
  }

  function filteredWarnings() {
    const severity = $('warning-severity').value;
    const query = $('warning-search').value.trim().toLowerCase();
    return (report?.priorities || []).filter((warning) => (severity === 'all' || warning.severity === severity) && (!query || `${warning.route} ${warning.message} ${warning.tip} ${warning.code}`.toLowerCase().includes(query)));
  }

  function renderWarnings() {
    const counts = report?.warningCounts || { high: 0, medium: 0, low: 0 };
    $('warning-summary').innerHTML = `<span class="agency-status ${counts.high ? 'warn' : 'good'}">${num(counts.high)} high</span><span class="agency-status ${counts.medium ? 'neutral' : 'good'}">${num(counts.medium)} medium</span><span class="agency-status good">${num(counts.low)} low</span>`;
    const rows = filteredWarnings();
    $('warning-table').innerHTML = rows.length ? rows.map((warning) => `<tr><td><span class="agency-status ${warning.severity === 'high' ? 'warn' : warning.severity === 'medium' ? 'neutral' : 'good'}">${escapeHtml(warning.severity)}</span></td><td><a href="${escapeHtml(warning.route)}" target="_blank" rel="noopener noreferrer">${escapeHtml(warning.route)}</a>${warning.relatedRoute ? `<br/><small>Related: ${escapeHtml(warning.relatedRoute)}</small>` : ''}</td><td><strong>${escapeHtml(warning.code)}</strong><br/>${escapeHtml(warning.message)}</td><td>${escapeHtml(warning.tip)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No findings match the current filters.</td></tr>';
  }

  function renderSimilarity() {
    const live = (report?.duplicatePairs?.live || []).map((item) => ({ scope: 'Live', ...item }));
    const forward = (report?.duplicatePairs?.forward || []).map((item) => ({ scope: 'Forward', ...item }));
    const rows = [...live, ...forward].sort((left, right) => right.similarity - left.similarity).slice(0, 60);
    $('similarity-table').innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.scope)}</td><td><a href="${escapeHtml(row.a)}">${escapeHtml(row.a)}</a></td><td><a href="${escapeHtml(row.b)}">${escapeHtml(row.b)}</a></td><td>${Math.round(row.similarity * 100)}%</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No page pair crossed the similarity advisory threshold.</td></tr>';
  }

  function render() {
    $('agency-policy').innerHTML = `<strong>Warning-only policy</strong><p>${escapeHtml(report?.policy?.message || 'Findings inform improvement; the site remains the authority for what must work.')}</p>`;
    $('generated-at').textContent = `Report generated ${date(report?.generatedAt)}`;
    renderScores();
    renderHealth();
    renderPerformance();
    renderAutonomy();
    renderSearchIntelligence();
    renderTips();
    renderWarnings();
    renderSimilarity();
  }

  async function load() {
    $('generated-at').textContent = 'Loading agency report…';
    try {
      const response = await fetch(`/data/agency/dashboard.json?ts=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(`Dashboard report returned ${response.status}`);
      report = await response.json();
      render();
    } catch (error) {
      $('generated-at').textContent = 'Dashboard data unavailable';
      $('agency-policy').innerHTML = `<strong>Report warning</strong><p>${escapeHtml(error.message)}</p>`;
    }
  }

  function showAgency() {
    $('agency-login-panel').hidden = true;
    $('agency-panel').hidden = false;
    load();
    window.HicksAdminOperations?.loadStatus?.();
  }

  function showLogin(message = '') {
    $('agency-panel').hidden = true;
    $('agency-login-panel').hidden = false;
    $('agency-login-message').textContent = message;
  }

  async function unlockAgency(event) {
    event.preventDefault();
    $('agency-login-message').textContent = 'Checking password…';
    const ok = await gate.unlock($('agency-password').value);
    if (!ok) {
      showLogin('Password did not match.');
      return;
    }
    $('agency-password').value = '';
    $('agency-login-message').textContent = '';
    showAgency();
  }

  function lockAgency() {
    gate.lock();
    showLogin('');
  }

  async function runSearchConnectionWorkflow() {
    const receipt = $('search-connection-receipt');
    if (!window.HicksAdminOperations?.runAction) {
      receipt.innerHTML = '<strong>Connection workflow unavailable</strong><p class="muted small">Open /admin and complete the optional GitHub connection steps, then reload this page.</p>';
      return;
    }
    const result = await window.HicksAdminOperations.runAction('refresh-search', receipt);
    if (result?.ok) {
      receipt.insertAdjacentHTML('beforeend', '<p class="muted small">The workflow was dispatched. Refresh this dashboard after GitHub Actions completes to see the provider result.</p>');
    }
  }

  $('warning-severity')?.addEventListener('change', renderWarnings);
  $('warning-search')?.addEventListener('input', renderWarnings);
  $('refresh-dashboard')?.addEventListener('click', load);
  $('test-search-connections')?.addEventListener('click', runSearchConnectionWorkflow);
  $('agency-login-form')?.addEventListener('submit', unlockAgency);
  $('agency-lock-button')?.addEventListener('click', lockAgency);

  if (gate?.isUnlocked()) showAgency();
  else showLogin('');
})();
