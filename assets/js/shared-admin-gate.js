(() => {
  'use strict';
  // One sign-in for /admin, /agency and /admin/digitalproducts. The typed password
  // goes to the server once (POST /api/admin/login, HTTPS); the server checks it
  // against a Cloudflare secret and returns a signed session token, which every
  // admin call sends as x-admin-session. No password or hash lives in this file.
  const SESSION_TOKEN_KEY = 'hc_admin_session_v2';
  const LEGACY_HASH_KEY = 'hc_admin_password_hash_v1';
  const SESSION_KEY = 'hc_admin_unlocked';
  const SESSION_HEADER = 'x-admin-session';

  function storageGet(key) {
    try { return localStorage.getItem(key) || sessionStorage.getItem(key) || ''; }
    catch { return ''; }
  }

  function tokenExpiry(token) {
    const parts = String(token || '').split('.');
    return parts.length === 4 ? Number(parts[1]) * 1000 : 0;
  }

  function getToken() {
    const token = storageGet(SESSION_TOKEN_KEY);
    return tokenExpiry(token) > Date.now() ? token : '';
  }

  function remember(token) {
    try { localStorage.setItem(SESSION_TOKEN_KEY, token); }
    catch { try { sessionStorage.setItem(SESSION_TOKEN_KEY, token); } catch {} }
    try { sessionStorage.setItem(SESSION_KEY, 'true'); } catch {}
  }

  function lock() {
    for (const key of [SESSION_TOKEN_KEY, LEGACY_HASH_KEY]) {
      try { localStorage.removeItem(key); } catch {}
      try { sessionStorage.removeItem(key); } catch {}
    }
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }

  // Resolves { ok: true } or { ok: false, message } with a message the login
  // form can show as it is.
  async function signIn(password) {
    let response;
    let body = {};
    try {
      response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: String(password || '').trim() }),
        cache: 'no-store',
        credentials: 'same-origin'
      });
      body = await response.json().catch(() => ({}));
    } catch {
      return { ok: false, message: 'Could not reach the site. Check your connection and try again.' };
    }
    if (response.ok && body.ok && body.token) {
      remember(body.token);
      return { ok: true };
    }
    return { ok: false, message: body.error || 'Password did not match.' };
  }

  async function unlock(password) {
    return (await signIn(password)).ok;
  }

  // An old stored hash is useless now; drop it so nothing keeps sending it.
  try { localStorage.removeItem(LEGACY_HASH_KEY); sessionStorage.removeItem(LEGACY_HASH_KEY); } catch {}

  function isUnlocked() { return Boolean(getToken()); }
  function authHeaders(extra = {}) {
    const token = getToken();
    return { ...extra, ...(token ? { [SESSION_HEADER]: token } : {}) };
  }

  window.HicksAdminGate = { SESSION_KEY, SESSION_HEADER, signIn, unlock, lock, isUnlocked, getToken, authHeaders };
})();
