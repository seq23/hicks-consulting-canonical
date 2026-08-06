(() => {
  'use strict';

  const AUTH_HASH_KEY = 'hc_admin_password_hash_v1';
  const $ = (id) => document.getElementById(id);

  function getAuthHash() {
    try {
      return localStorage.getItem(AUTH_HASH_KEY) || sessionStorage.getItem(AUTH_HASH_KEY) || '';
    } catch {
      return '';
    }
  }

  function headers(extra = {}) {
    const hash = getAuthHash();
    return {
      ...extra,
      ...(hash ? { 'x-admin-password-hash': hash } : {})
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[character]));
  }

  function setGithubStatus(state, message) {
    const badge = $('github-admin-status');
    const copy = $('github-admin-message');
    if (badge) {
      badge.textContent = state === 'CONNECTED' ? 'Connected' : 'Connection required';
      badge.className = `agency-status ${state === 'CONNECTED' ? 'good' : 'neutral'}`;
    }
    if (copy) copy.textContent = message || (state === 'CONNECTED'
      ? 'The optional GitHub operations connection is ready.'
      : 'Complete the four setup steps below, redeploy, and run the connection test.');
  }

  function setActionAvailability(configured) {
    document.querySelectorAll('[data-admin-action]').forEach((button) => {
      const action = button.getAttribute('data-admin-action');
      const isTest = action === 'test-github-admin';
      button.disabled = !configured && !isTest;
      if (!configured && !isTest) {
        button.title = 'Connect the optional GitHub operations provider first.';
      } else {
        button.removeAttribute('title');
      }
    });
  }

  function renderReceipt(element, payload, fallbackTitle = 'Operation result') {
    if (!element) return;
    const status = payload?.status || payload?.receipt?.status || (payload?.ok ? 'SUCCESS' : 'NOT COMPLETED');
    const isSetup = status === 'SETUP_REQUIRED';
    const title = isSetup ? 'Connection required' : payload?.ok ? 'Operation accepted' : fallbackTitle;
    const message = payload?.message || payload?.receipt?.result?.message || payload?.receipt?.error || 'No additional details were returned.';
    const details = [];
    const receipt = payload?.receipt || {};
    if (receipt.id) details.push(`Receipt: ${receipt.id}`);
    if (receipt.result?.workflow) details.push(`Workflow: ${receipt.result.workflow}`);
    if (receipt.result?.commitSha) details.push(`Commit: ${receipt.result.commitSha}`);
    if (receipt.result?.repository) details.push(`Repository: ${receipt.result.repository}`);
    element.innerHTML = `<strong>${escapeHtml(title)}</strong><p class="muted small">${escapeHtml(message)}</p>${details.length ? `<p class="muted small">${escapeHtml(details.join(' · '))}</p>` : ''}${isSetup ? '<p class="small"><a href="#github-admin-setup">Review the GitHub connection steps above.</a></p>' : ''}`;
  }

  async function loadStatus() {
    if (!getAuthHash()) return null;
    try {
      const response = await fetch('/api/admin/status', {
        headers: headers(),
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) return null;
      const body = await response.json();
      const connection = body.connections?.githubAdmin || { configured: false, state: 'CONNECTION_REQUIRED' };
      setGithubStatus(connection.state, connection.message);
      setActionAvailability(connection.configured === true);
      return body;
    } catch {
      setGithubStatus('CONNECTION_REQUIRED', 'The connection status could not be checked. Confirm the site is deployed, then use the setup steps below.');
      setActionAvailability(false);
      return null;
    }
  }

  async function runAction(action, receiptElement = $('action-receipt')) {
    if (!getAuthHash()) {
      renderReceipt(receiptElement, {
        status: 'SETUP_REQUIRED',
        message: 'Unlock the admin or agency page with the shared password before running an operation.'
      });
      return null;
    }
    if (receiptElement) {
      receiptElement.innerHTML = '<strong>Running operation…</strong><p class="muted small">The page is waiting for a provider receipt.</p>';
    }
    let response;
    let body;
    try {
      response = await fetch('/api/admin/action', {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        credentials: 'same-origin',
        body: JSON.stringify({ action })
      });
      body = await response.json().catch(() => ({ ok: false, message: `The operation returned HTTP ${response.status}.` }));
    } catch {
      body = {
        ok: false,
        status: 'NOT_COMPLETED',
        message: 'The operation endpoint could not be reached. Confirm the Cloudflare deployment is current and try again.'
      };
    }
    renderReceipt(receiptElement, body, 'Operation could not complete');
    if (body?.status === 'SETUP_REQUIRED') {
      setGithubStatus('CONNECTION_REQUIRED', body.message);
      setActionAvailability(false);
      document.querySelector('[data-admin-action="test-github-admin"]')?.removeAttribute('disabled');
    } else if (body?.ok && action === 'test-github-admin') {
      setGithubStatus('CONNECTED', body.receipt?.result?.message || 'GitHub operations connection verified.');
      setActionAvailability(true);
    }
    return body;
  }

  function bindButtons() {
    document.querySelectorAll('[data-admin-action]').forEach((button) => {
      if (button.dataset.adminOperationBound === 'true') return;
      button.dataset.adminOperationBound = 'true';
      button.addEventListener('click', () => runAction(button.getAttribute('data-admin-action')));
    });
  }

  function initialize() {
    bindButtons();
    loadStatus();
  }

  window.HicksAdminOperations = { runAction, loadStatus, getAuthHash };
  document.addEventListener('DOMContentLoaded', initialize);
  document.addEventListener('hicks-admin-unlocked', initialize);
  document.addEventListener('hicks-admin-locked', () => setActionAvailability(false));
})();
