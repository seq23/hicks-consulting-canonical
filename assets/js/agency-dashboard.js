(() => {
  'use strict';
  let report = null;
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
  const num = (value) => new Intl.NumberFormat().format(Number(value) || 0);
  const date = (value) => value ? new Date(value).toLocaleString() : 'Not yet refreshed';
  const statusClass = (status) => status === 'ok' ? 'good' : status === 'warning' ? 'warn' : 'neutral';
  function renderScores() {
    $('score-grid').innerHTML = report.scores.map((item) => `
      <article class="agency-score-card ${item.targetMet ? 'target-met' : 'target-missed'}">
        <div class="agency-score-top"><span class="agency-grade">${escapeHtml(item.grade)}</span><strong>${escapeHtml(item.label)}</strong></div>
        <div class="agency-score-number">${item.score}<span>/100</span></div>
        <div class="agency-progress"><span style="width:${item.score}%"></span></div>
        <p>${escapeHtml(item.summary)}</p>
        <small>${item.targetMet ? 'B+ target met' : `Needs ${Math.max(0, item.target - item.score)} point(s) to reach B+`}</small>
      </article>`).join('');
  }
  function healthCard(provider, label) {
    const item = report.health[provider] || {};
    return `<div class="agency-health-row"><div><span class="agency-status ${statusClass(item.status)}">${escapeHtml(item.status || 'unknown')}</span><strong>${escapeHtml(label)}</strong><p>${escapeHtml(item.message || 'No status message.')}</p></div><small>Checked: ${escapeHtml(date(item.checkedAt))}</small></div>`;
  }
  function renderHealth() {
    $('search-health').innerHTML = healthCard('gsc','Google Search Console') + healthCard('bing','Bing Webmaster Tools');
    const live = report.health.live || {};
    let checks = '';
    if (Array.isArray(live.checks)) checks = `<div class="agency-live-checks">${live.checks.map((c) => `<div><span class="agency-dot ${c.ok ? 'good' : 'warn'}"></span><code>${escapeHtml(c.route)}</code><span>${escapeHtml(c.status || 'ERR')}</span><small>${escapeHtml(c.ms)}ms</small></div>`).join('')}</div>`;
    $('live-health').innerHTML = healthCard('live','Monitored routes') + checks;
  }
  function renderPerformance() {
    const g = report.health.gsc || {};
    const m = g.metrics || {};
    const delta = (a,b) => b ? `${(((a-b)/b)*100).toFixed(1)}%` : '—';
    const cards = [
      ['Google clicks',num(m.clicks),delta(m.clicks,m.previousClicks)],
      ['Google impressions',num(m.impressions),delta(m.impressions,m.previousImpressions)],
      ['Google CTR',pct(m.ctr),delta(m.ctr,m.previousCtr)],
      ['Average position',m.position ? Number(m.position).toFixed(1) : '—',m.previousPosition ? `prior ${Number(m.previousPosition).toFixed(1)}` : '—']
    ];
    $('performance-metrics').innerHTML = cards.map(([l,v,d]) => `<div class="agency-metric"><span>${escapeHtml(l)}</span><strong>${escapeHtml(v)}</strong><small>${escapeHtml(d)}</small></div>`).join('');
    const rows = [...(g.topQueries || []).slice(0,10).map((r) => ({label:`Query: ${(r.keys||[])[0]||''}`,...r})), ...(g.topPages || []).slice(0,10).map((r) => ({label:`Page: ${(r.keys||[])[0]||''}`,...r}))];
    $('performance-table').innerHTML = rows.length ? rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${num(r.clicks)}</td><td>${num(r.impressions)}</td><td>${pct(r.ctr)}</td><td>${Number(r.position||0).toFixed(1)}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">Connect the GSC API workflow to populate query and page performance.</td></tr>';
  }
  function renderTips() {
    $('aeo-tips').innerHTML = (report.tips.aeo || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
    $('geo-tips').innerHTML = (report.tips.geo || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  }
  function filteredWarnings() {
    const severity = $('warning-severity').value;
    const query = $('warning-search').value.trim().toLowerCase();
    return (report.priorities || []).filter((w) => (severity === 'all' || w.severity === severity) && (!query || `${w.route} ${w.message} ${w.tip} ${w.code}`.toLowerCase().includes(query)));
  }
  function renderWarnings() {
    const c = report.warningCounts || {};
    $('warning-summary').innerHTML = `<span class="agency-status warn">${num(c.high)} high</span><span class="agency-status neutral">${num(c.medium)} medium</span><span class="agency-status good">${num(c.low)} low</span>`;
    const rows = filteredWarnings();
    $('warning-table').innerHTML = rows.length ? rows.map((w) => `<tr><td><span class="agency-status ${w.severity === 'high' ? 'warn' : w.severity === 'medium' ? 'neutral' : 'good'}">${escapeHtml(w.severity)}</span></td><td><a href="${escapeHtml(w.route)}" target="_blank" rel="noopener noreferrer">${escapeHtml(w.route)}</a>${w.relatedRoute ? `<br/><small>Related: ${escapeHtml(w.relatedRoute)}</small>` : ''}</td><td><strong>${escapeHtml(w.code)}</strong><br/>${escapeHtml(w.message)}</td><td>${escapeHtml(w.tip)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No findings match the current filters.</td></tr>';
  }
  function renderSimilarity() {
    const live = (report.duplicatePairs?.live || []).map((x) => ({scope:'Live',...x}));
    const forward = (report.duplicatePairs?.forward || []).map((x) => ({scope:'Forward',...x}));
    const rows = [...live,...forward].sort((a,b) => b.similarity-a.similarity).slice(0,60);
    $('similarity-table').innerHTML = rows.length ? rows.map((r) => `<tr><td>${escapeHtml(r.scope)}</td><td><a href="${escapeHtml(r.a)}">${escapeHtml(r.a)}</a></td><td><a href="${escapeHtml(r.b)}">${escapeHtml(r.b)}</a></td><td>${Math.round(r.similarity*100)}%</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No high-similarity pairs crossed the advisory threshold.</td></tr>';
  }
  function render() {
    $('agency-policy').innerHTML = `<strong>Warning-only policy</strong><p>${escapeHtml(report.policy.message)}</p>`;
    $('generated-at').textContent = `Report generated ${date(report.generatedAt)}`;
    renderScores(); renderHealth(); renderPerformance(); renderTips(); renderWarnings(); renderSimilarity();
  }
  async function load() {
    $('generated-at').textContent = 'Loading agency report…';
    try {
      const res = await fetch(`/data/agency/dashboard.json?ts=${Date.now()}`, {cache:'no-store'});
      if (!res.ok) throw new Error(`Dashboard report returned ${res.status}`);
      report = await res.json(); render();
    } catch (err) {
      $('generated-at').textContent = 'Dashboard data unavailable';
      $('agency-policy').innerHTML = `<strong>Report warning</strong><p>${escapeHtml(err.message)}</p>`;
    }
  }
  $('warning-severity')?.addEventListener('change', renderWarnings);
  $('warning-search')?.addEventListener('input', renderWarnings);
  $('refresh-dashboard')?.addEventListener('click', load);
  load();
})();
