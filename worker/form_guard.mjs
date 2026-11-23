// Bot and flood guard for the three public forms (training, groups, lead magnet).
//
// Order inside a submission:
//   1. Honeypot: a filled `website` field gets the normal success answer and
//      nothing is sent (the bot learns nothing).
//   2. Turnstile: a valid token delivers. A token Cloudflare calls forged
//      (`invalid-input-response`) is refused. A missing token, an expired or
//      reused token, an unconfigured secret or a siteverify outage is
//      "unchecked": the inquiry still delivers, but under the caps below, so a
//      real person whose browser blocks the widget is never turned away.
//   3. Caps, kept in the project's existing KV binding (DIGITAL_PRODUCTS_KV,
//      keys under `form-guard:`): at most 5 submissions per IP in any rolling
//      hour (every submission), and at most 20 unchecked submissions per
//      Central day across the site. If the store cannot be read or written an
//      unchecked submission is refused (we cannot prove it is under the cap);
//      a Turnstile-verified one still delivers.
//
// KV has no atomic increment, so a same-second parallel burst can slip a few
// over a cap; sequential floods (what form bots send) are held exactly.

export const HONEYPOT_FIELD = 'website';
export const TOKEN_FIELD = 'turnstileToken';
export const PER_IP_HOURLY_LIMIT = 5;
export const UNCHECKED_DAILY_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 4000;

export function honeypotFilled(incoming) {
  const value = incoming && incoming[HONEYPOT_FIELD];
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function clientIp(request) {
  return String(request.headers.get('cf-connecting-ip') || '').trim() || 'unknown';
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function centralDay(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

// Returns 'verified' | 'forged' | 'unchecked:<reason>'.
export async function verifyTurnstile({ token, ip, env, fetchImpl = fetch }) {
  const response = typeof token === 'string' ? token.trim() : '';
  if (!response) return 'unchecked:missing-token';
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return 'unchecked:not-configured';
  if (response.length > 2048) return 'forged';
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', response);
  if (ip && ip !== 'unknown') body.append('remoteip', ip);
  let result;
  try {
    const upstream = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS) });
    if (!upstream.ok) return `unchecked:siteverify-${upstream.status}`;
    result = await upstream.json();
  } catch (error) {
    return 'unchecked:siteverify-unreachable';
  }
  if (result && result.success === true) return 'verified';
  const codes = Array.isArray(result && result['error-codes']) ? result['error-codes'] : [];
  if (codes.includes('invalid-input-response')) return 'forged';
  return `unchecked:${codes.join(',') || 'no-verdict'}`;
}

async function takePerIpSlot(kv, ip, now) {
  const key = `form-guard:ip:${await sha256Hex(ip)}`;
  let stamps = [];
  const raw = await kv.get(key);
  if (raw) {
    try { stamps = JSON.parse(raw); } catch (error) { stamps = []; }
  }
  stamps = (Array.isArray(stamps) ? stamps : []).filter((t) => Number.isFinite(t) && t > now - HOUR_MS && t <= now);
  if (stamps.length >= PER_IP_HOURLY_LIMIT) return false;
  stamps.push(now);
  await kv.put(key, JSON.stringify(stamps), { expirationTtl: 3600 });
  return true;
}

async function takeDailySlot(kv, now) {
  const key = `form-guard:unchecked:${centralDay(now)}`;
  const count = Number.parseInt((await kv.get(key)) || '0', 10) || 0;
  if (count >= UNCHECKED_DAILY_LIMIT) return false;
  await kv.put(key, String(count + 1), { expirationTtl: 2 * 24 * 3600 });
  return true;
}

// Decide what happens to a validated submission.
// Returns { deliver: true } or { deliver: false, status, error }.
export async function guardSubmission({ request, env, incoming, formType, now = Date.now(), fetchImpl = fetch }) {
  const ip = clientIp(request);
  const verdict = await verifyTurnstile({ token: incoming && incoming[TOKEN_FIELD], ip, env, fetchImpl });
  if (verdict === 'forged') {
    console.warn('FORM_GUARD_REFUSED', JSON.stringify({ formType, reason: 'forged-token' }));
    return { deliver: false, status: 403, error: 'The security check failed. Please reload the page and try again.' };
  }
  const verified = verdict === 'verified';
  const kv = env.DIGITAL_PRODUCTS_KV;
  try {
    if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') throw new Error('KV binding missing');
    if (!(await takePerIpSlot(kv, ip, now))) {
      console.warn('FORM_GUARD_CAPPED', JSON.stringify({ formType, cap: 'per-ip-hour', verdict }));
      return { deliver: false, status: 429, error: 'Too many submissions from this connection. Please try again later.' };
    }
    if (!verified && !(await takeDailySlot(kv, now))) {
      console.warn('FORM_GUARD_CAPPED', JSON.stringify({ formType, cap: 'unchecked-day', verdict }));
      return { deliver: false, status: 429, error: 'Too many submissions today. Please try again tomorrow.' };
    }
  } catch (error) {
    console.warn('FORM_GUARD_STORE_UNAVAILABLE', JSON.stringify({ formType, verdict, message: String(error && error.message || error).slice(0, 160) }));
    if (!verified) return { deliver: false, status: 503, error: 'The form could not be checked just now. Please try again.' };
  }
  if (!verified) console.log('FORM_GUARD_UNCHECKED', JSON.stringify({ formType, verdict }));
  return { deliver: true };
}
