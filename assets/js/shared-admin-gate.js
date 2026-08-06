(() => {
  'use strict';
  const PASSWORD_HASH = 'c7ef3319e6cf6aab9035156df95f18dfec2ba2178f733940eda688758805708b';
  const AUTH_HASH_KEY = 'hc_admin_password_hash_v1';
  const SESSION_KEY = 'hc_admin_unlocked';

  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function getStoredHash() {
    try { return localStorage.getItem(AUTH_HASH_KEY) || sessionStorage.getItem(AUTH_HASH_KEY) || ''; }
    catch { return ''; }
  }

  function remember(hash) {
    try { localStorage.setItem(AUTH_HASH_KEY, hash); }
    catch { try { sessionStorage.setItem(AUTH_HASH_KEY, hash); } catch {} }
    try { sessionStorage.setItem(SESSION_KEY, 'true'); } catch {}
  }

  function lock() {
    try { localStorage.removeItem(AUTH_HASH_KEY); } catch {}
    try { sessionStorage.removeItem(AUTH_HASH_KEY); } catch {}
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }

  async function unlock(password) {
    const hash = await sha256(password);
    if (hash !== PASSWORD_HASH) return false;
    remember(hash);
    return true;
  }

  function isUnlocked() { return getStoredHash() === PASSWORD_HASH; }
  function authHeaders(extra = {}) {
    const hash = getStoredHash();
    return { ...extra, ...(hash === PASSWORD_HASH ? { 'x-admin-password-hash': hash } : {}) };
  }

  window.HicksAdminGate = { PASSWORD_HASH, AUTH_HASH_KEY, SESSION_KEY, sha256, unlock, lock, isUnlocked, getStoredHash, authHeaders };
})();
