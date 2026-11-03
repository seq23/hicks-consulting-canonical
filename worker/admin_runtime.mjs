
function adminKv(env, preferred) {
  return env[preferred] || env.DIGITAL_PRODUCTS_KV || null;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

function randomToken() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64urlDecodeText(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function constantTimeEqual(leftValue, rightValue) {
  const left = String(leftValue || '');
  const right = String(rightValue || '');
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/* ------------------------------------------------------------------ *
 * Admin authentication.
 *
 * The browser sends the typed password once, over HTTPS, to /api/admin/login.
 * The server checks it against the ADMIN_PASSWORD_HASH Cloudflare secret and
 * hands back a signed session token; every other admin call carries that token
 * in x-admin-session. Nothing the browser holds is ever compared directly
 * against the stored secret, and no hash of the password lives in this repo.
 *
 * ADMIN_PASSWORD_HASH formats:
 *   pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>   (iterations <= 100000, the Workers limit)
 *   <64 hex>  SHA-256 of the password
 * ADMIN_SESSION_SECRET signs session tokens. Rotating either secret signs everyone out.
 * Either secret missing is a NAMED STOP (503 ADMIN_AUTH_SECRET_MISSING): admin
 * stays closed, never open.
 * ------------------------------------------------------------------ */

export const ADMIN_SESSION_HEADER = 'x-admin-session';
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const ADMIN_LOCKOUT_MAX_FAILURES = 5;
const ADMIN_LOCKOUT_SECONDS = 15 * 60;
const ADMIN_PBKDF2_PREFIX = 'pbkdf2-sha256$';
const ADMIN_SIGN_IN_FAILED = 'Password did not match.';
const ADMIN_LOCKED_OUT = 'Too many attempts. Try again in 15 minutes.';
const memoryLockouts = new Map();

function base64ToBytes(value) {
  const binary = atob(String(value || '').replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function adminSecrets(env) {
  const passwordHash = String(env?.ADMIN_PASSWORD_HASH || '').trim();
  const sessionSecret = String(env?.ADMIN_SESSION_SECRET || '').trim();
  const validHash = /^[0-9a-f]{64}$/i.test(passwordHash) || passwordHash.startsWith(ADMIN_PBKDF2_PREFIX);
  if (!validHash || sessionSecret.length < 32) return null;
  return { passwordHash, sessionSecret };
}

function secretMissingResponse() {
  console.error('ADMIN_AUTH_SECRET_MISSING: set ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET as Cloudflare Pages secrets');
  return json({ ok: false, status: 'ADMIN_AUTH_SECRET_MISSING', error: 'Admin sign-in is not configured. Nothing was changed.' }, 503);
}

export async function verifyAdminPassword(password, storedHash) {
  const typed = String(password || '');
  if (!typed || !storedHash) return false;
  if (storedHash.startsWith(ADMIN_PBKDF2_PREFIX)) {
    const [, iterationsText, saltText, hashText] = storedHash.split('$');
    const iterations = Number(iterationsText);
    if (!Number.isInteger(iterations) || iterations < 10000 || !saltText || !hashText) return false;
    const expected = base64ToBytes(hashText);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(typed), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(saltText), iterations }, key, expected.length * 8);
    return constantTimeEqual(bytesToHex(bits), bytesToHex(expected));
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typed));
  return constantTimeEqual(bytesToHex(digest), storedHash.toLowerCase());
}

async function sessionSignature(secrets, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${secrets.sessionSecret}|${secrets.passwordHash}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return bytesToBase64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

async function issueSessionToken(secrets, nowMs = Date.now()) {
  const expiresAt = Math.floor(nowMs / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const payload = `v1.${expiresAt}.${randomToken()}`;
  return { token: `${payload}.${await sessionSignature(secrets, payload)}`, expiresAt };
}

async function verifySessionToken(secrets, token, nowMs = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= nowMs) return false;
  const expected = await sessionSignature(secrets, parts.slice(0, 3).join('.'));
  return constantTimeEqual(parts[3], expected);
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function readLockout(env, ip) {
  const kv = adminKv(env, 'ADMIN_AUTH_KV');
  const key = `admin:auth-lockout:${ip}`;
  let record = null;
  if (kv?.get) record = await kv.get(key, 'json').catch(() => null);
  else record = memoryLockouts.get(key) || null;
  return { kv, key, record: record && typeof record === 'object' ? record : { failures: 0, lockedUntil: 0 } };
}

async function writeLockout(state, record) {
  if (state.kv?.put) {
    await state.kv.put(state.key, JSON.stringify(record), { expirationTtl: ADMIN_LOCKOUT_SECONDS });
  } else {
    memoryLockouts.set(state.key, record);
  }
}

async function clearLockout(state) {
  if (state.kv?.delete) await state.kv.delete(state.key).catch(() => {});
  else memoryLockouts.delete(state.key);
}

async function handleAdminLogin(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const secrets = adminSecrets(env);
  if (!secrets) return secretMissingResponse();
  const state = await readLockout(env, clientIp(request));
  const now = Date.now();
  if (Number(state.record.lockedUntil || 0) > now) {
    return json({ ok: false, error: ADMIN_LOCKED_OUT }, 429, { 'retry-after': String(ADMIN_LOCKOUT_SECONDS) });
  }
  const incoming = await request.json().catch(() => ({}));
  const password = typeof incoming.password === 'string' ? incoming.password.slice(0, 1024) : '';
  if (await verifyAdminPassword(password, secrets.passwordHash)) {
    await clearLockout(state);
    return json({ ok: true, ...(await issueSessionToken(secrets, now)) });
  }
  const failures = Number(state.record.failures || 0) + 1;
  const locked = failures >= ADMIN_LOCKOUT_MAX_FAILURES;
  await writeLockout(state, { failures: locked ? 0 : failures, lockedUntil: locked ? now + ADMIN_LOCKOUT_SECONDS * 1000 : 0 });
  if (locked) return json({ ok: false, error: ADMIN_LOCKED_OUT }, 429, { 'retry-after': String(ADMIN_LOCKOUT_SECONDS) });
  return json({ ok: false, error: ADMIN_SIGN_IN_FAILED }, 401);
}

// The one gate every admin write goes through: /api/admin/*, /api/content/*,
// and /api/digital-products/* writes. Returns null when the caller is signed in,
// otherwise the response to send (401, or the 503 named stop).
export async function requireAdminSession(request, env) {
  const secrets = adminSecrets(env);
  if (!secrets) return secretMissingResponse();
  if (await verifySessionToken(secrets, request.headers.get(ADMIN_SESSION_HEADER))) return null;
  return json({ ok: false, error: 'Admin sign-in required.' }, 401);
}

async function readAssetJson(request, env, assetPath, fallback) {
  try {
    const url = new URL(assetPath, request.url);
    const response = env.ASSETS?.fetch
      ? await env.ASSETS.fetch(new Request(url.toString()))
      : await fetch(url.toString());
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

function githubConfiguration(env) {
  const configured = Boolean(env.GITHUB_ADMIN_TOKEN && env.GITHUB_REPOSITORY);
  return {
    configured,
    state: configured ? 'CONNECTED' : 'CONNECTION_REQUIRED',
    message: configured
      ? 'The optional GitHub operations connection is configured.'
      : 'Add the restricted GitHub token and repository value in Cloudflare, redeploy, then run the connection test.'
  };
}

async function githubRequest(env, requestPath, options = {}) {
  const configuration = githubConfiguration(env);
  if (!configuration.configured) {
    const error = new Error(configuration.message);
    error.code = 'GITHUB_SETUP_REQUIRED';
    throw error;
  }
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}${requestPath}`, {
    ...options,
    headers: {
      authorization: `Bearer ${env.GITHUB_ADMIN_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'hicks-consulting-admin',
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`GitHub returned ${response.status}: ${text.slice(0, 600)}`);
    error.code = 'GITHUB_CONNECTION_FAILED';
    throw error;
  }
  return body;
}

const WORKFLOW_BY_COMMAND = {
  'run-autonomy': 'autonomy-cycle.yml',
  'run-self-heal': 'autonomy-self-heal.yml',
  'refresh-search': 'agency-seo-monitor.yml',
  'publish-due': 'content-publish.yml',
  'run-distribution': 'indexnow-submit.yml'
};

async function testGithubConnection(env) {
  const configuration = githubConfiguration(env);
  if (!configuration.configured) {
    return {
      provider: 'github',
      state: 'CONNECTION_REQUIRED',
      message: configuration.message,
      setupPath: '/admin/#github-admin-setup'
    };
  }
  const result = await githubRequest(env, '/actions/workflows?per_page=1');
  return {
    provider: 'github',
    state: 'CONNECTED',
    message: 'GitHub operations connection verified.',
    repository: env.GITHUB_REPOSITORY,
    workflowCount: Number(result.total_count || 0)
  };
}

async function dispatchWorkflow(env, action, inputs = {}) {
  const workflow = WORKFLOW_BY_COMMAND[action];
  if (!workflow) {
    const error = new Error(`Unsupported admin action: ${action}`);
    error.code = 'UNSUPPORTED_ADMIN_ACTION';
    throw error;
  }
  await githubRequest(env, `/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: env.GITHUB_BRANCH || 'main', inputs })
  });
  return {
    provider: 'github',
    state: 'DISPATCHED',
    workflow,
    ref: env.GITHUB_BRANCH || 'main',
    dispatched: true
  };
}

async function mutateAutonomyState(env, action, by) {
  const filePath = 'data/autonomy/state.json';
  const branch = env.GITHUB_BRANCH || 'main';
  const current = await githubRequest(env, `/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
  const decoded = JSON.parse(base64urlDecodeText(String(current.content || '').replace(/\s+/g, '')));
  const at = new Date().toISOString();
  // Who threw the switch, and when. Same principle as the publication approval
  // record: a control this consequential should never be an anonymous state flip.
  const who = decidedBy(by) || 'Unrecorded';
  if (action === 'pause') { decoded.paused = true; decoded.pausedBy = who; decoded.pausedAt = at; }
  if (action === 'resume') { decoded.paused = false; decoded.emergencyStop = false; decoded.resumedBy = who; decoded.resumedAt = at; }
  if (action === 'emergency-stop') { decoded.emergencyStop = true; decoded.stoppedBy = who; decoded.stoppedAt = at; }
  if (action === 'clear-emergency-stop') { decoded.emergencyStop = false; decoded.resumedBy = who; decoded.resumedAt = at; }
  decoded.adminUpdatedAt = at;
  const content = btoa(unescape(encodeURIComponent(`${JSON.stringify(decoded, null, 2)}\n`)));
  const result = await githubRequest(env, `/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `admin: ${action} Hicks autonomy`,
      content,
      sha: current.sha,
      branch
    })
  });
  return {
    provider: 'github',
    state: 'UPDATED',
    action,
    commitSha: result.commit?.sha || null,
    autonomyState: decoded
  };
}

async function recordAdminReceipt(env, receipt) {
  const kv = adminKv(env, 'ADMIN_RECEIPTS_KV');
  if (kv?.put) {
    await kv.put(`admin:receipt:${receipt.id}`, JSON.stringify(receipt), {
      expirationTtl: 60 * 60 * 24 * 90
    });
  }
}

async function adminStatus(request, env) {
  const [state, queue, exceptions, manifest, dashboard, freeWins, competitors, notifications, velocity, providers, selfHeal] = await Promise.all([
    readAssetJson(request, env, '/data/autonomy/state.json', {}),
    readAssetJson(request, env, '/data/autonomy/queue.json', { items: [] }),
    readAssetJson(request, env, '/data/autonomy/exceptions.json', { items: [] }),
    readAssetJson(request, env, '/data/admin/content_manifest.json', []),
    readAssetJson(request, env, '/data/agency/dashboard.json', {}),
    readAssetJson(request, env, '/data/search/free_wins.json', { items: [] }),
    readAssetJson(request, env, '/data/search/competitor_observations.json', { observations: [] }),
    readAssetJson(request, env, '/data/autonomy/notification_queue.json', { items: [] }),
    readAssetJson(request, env, '/data/system/publishing_velocity_contract.json', {}),
    readAssetJson(request, env, '/data/system/provider_capabilities.json', {}),
    readAssetJson(request, env, '/data/autonomy/self_heal_state.json', {})
  ]);
  const counts = manifest.reduce((accumulator, item) => {
    accumulator[item.status] = (accumulator[item.status] || 0) + 1;
    return accumulator;
  }, {});
  return {
    state,
    queue,
    exceptions,
    manifest: { total: manifest.length, counts, recent: manifest.slice(-25) },
    dashboard,
    freeWins,
    competitors,
    notifications,
    velocity,
    providers,
    selfHeal,
    connections: {
      githubAdmin: githubConfiguration(env)
    }
  };
}


/* ------------------------------------------------------------------ *
 * Content decisions: approve, decline, and take down.
 *
 * scripts/admin/approve_publication.mjs is the CLI form of this gate and this is
 * the same gate with a button on it. It is deliberately NOT a new mechanism:
 *   - it writes the same record, to the same file, in the same shape, and
 *   - scripts/publishing/process_manifest.js keeps being the only thing that
 *     reads it, so nothing here can release a page on its own.
 *
 * Everything the CLI refuses, this refuses. One id per request, a named person
 * every time, no --all and no array, and the same rejection of automation names.
 * A convenience that let a scheduled job approve on Monika's behalf would undo
 * the entire reason the gate exists.
 * ------------------------------------------------------------------ */

const CONTENT_APPROVALS_PATH = 'data/admin/publication_approvals.json';
const CONTENT_DECLINES_PATH = 'data/admin/publication_declines.json';
const CONTENT_MANIFEST_PATH = 'data/admin/content_manifest.json';

// Same list approve_publication.mjs refuses. A machine must not be able to name
// itself as the person who decided.
const AUTOMATION_NAME = /^(ci|bot|automation|github-actions|system|auto)$/i;

function decidedBy(value) {
  const name = String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  if (AUTOMATION_NAME.test(name)) return '';
  return name.slice(0, 120);
}

function requireDecider(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return { ok: false, error: 'Who is approving? A name is required - this record is who decided, not a formality.' };
  if (AUTOMATION_NAME.test(raw)) return { ok: false, error: `"${raw}" names an automation, not a person. This gate exists precisely to stop a machine approving its own output.` };
  const name = decidedBy(raw);
  if (name.length < 2) return { ok: false, error: 'Please enter the name of the person making this decision.' };
  return { ok: true, name };
}

async function githubReadJson(env, filePath, fallback) {
  const branch = env.GITHUB_BRANCH || 'main';
  try {
    const current = await githubRequest(env, `/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
    const text = base64urlDecodeText(String(current.content || '').replace(/\s+/g, ''));
    return { doc: JSON.parse(text), sha: current.sha };
  } catch (error) {
    if (error.code === 'GITHUB_SETUP_REQUIRED') throw error;
    if (fallback !== undefined && /GitHub returned 404/.test(error.message || '')) return { doc: fallback, sha: null };
    throw error;
  }
}

async function githubWriteJson(env, filePath, doc, message, sha) {
  const branch = env.GITHUB_BRANCH || 'main';
  const content = btoa(unescape(encodeURIComponent(`${JSON.stringify(doc, null, 2)}\n`)));
  const body = { message, content, branch };
  if (sha) body.sha = sha;
  const result = await githubRequest(env, `/contents/${filePath}`, { method: 'PUT', body: JSON.stringify(body) });
  return result.commit?.sha || null;
}

async function contentApprove(request, env, incoming) {
  // One id. Not incoming.ids, not a filter, not "everything due" - the per-item
  // decision is the product, not an inconvenience to be batched away.
  const id = String(incoming.id || '').trim();
  if (!id) return json({ ok: false, error: 'Which piece? An item id is required.' }, 400);
  if (Array.isArray(incoming.id) || Array.isArray(incoming.ids)) return json({ ok: false, error: 'Approve one piece at a time. There is deliberately no bulk approval.' }, 400);
  const decider = requireDecider(incoming.by);
  if (!decider.ok) return json({ ok: false, error: decider.error }, 400);

  const manifest = await readAssetJson(request, env, `/${CONTENT_MANIFEST_PATH}`, null);
  if (!Array.isArray(manifest)) return json({ ok: false, error: 'The content list could not be read. Nothing was changed.' }, 503);
  const item = manifest.find((entry) => entry && entry.id === id);
  if (!item) return json({ ok: false, error: 'That piece is no longer in the content list.' }, 404);
  if (item.validationPassed !== true) return json({ ok: false, error: 'That piece has not finished its automated checks yet, so it cannot be approved.' }, 400);
  if (item.status === 'published') return json({ ok: false, error: 'That piece is already live, so approving it again would do nothing.' }, 400);

  const { doc, sha } = await githubReadJson(env, CONTENT_APPROVALS_PATH);
  if (!doc || !Array.isArray(doc.approvals)) return json({ ok: false, error: 'The approval record could not be read. Nothing was changed.' }, 503);
  const already = doc.approvals.find((entry) => entry && entry.id === id);
  if (already) return json({ ok: false, error: `That piece was already approved by ${already.approvedBy}.` }, 409);

  // Exactly the record scripts/admin/approve_publication.mjs writes, so
  // loadApprovedIds() in scripts/publishing/process_manifest.js reads it without
  // knowing or caring which of the two wrote it.
  const record = {
    id,
    route: item.slug,
    title: item.title,
    approvedBy: decider.name,
    approvedAt: new Date().toISOString(),
    note: String(incoming.note || '').trim() || null
  };
  doc.approvals.push(record);
  const commitSha = await githubWriteJson(env, CONTENT_APPROVALS_PATH, doc, `admin: ${decider.name} approved ${id} for release`, sha);
  return json({ ok: true, decision: 'approved', record, commitSha });
}

async function contentDecline(request, env, incoming) {
  const id = String(incoming.id || '').trim();
  if (!id) return json({ ok: false, error: 'Which piece? An item id is required.' }, 400);
  const decider = requireDecider(incoming.by);
  if (!decider.ok) return json({ ok: false, error: decider.error }, 400);
  const reason = String(incoming.reason || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 2000);
  if (!reason) return json({ ok: false, error: 'Please say why, in a sentence. The reason is the point of declining rather than ignoring.' }, 400);

  const manifest = await readAssetJson(request, env, `/${CONTENT_MANIFEST_PATH}`, null);
  if (!Array.isArray(manifest)) return json({ ok: false, error: 'The content list could not be read. Nothing was changed.' }, 503);
  const item = manifest.find((entry) => entry && entry.id === id);
  if (!item) return json({ ok: false, error: 'That piece is no longer in the content list.' }, 404);

  const approvals = await githubReadJson(env, CONTENT_APPROVALS_PATH);
  if (approvals.doc?.approvals?.some((entry) => entry && entry.id === id)) {
    return json({ ok: false, error: 'That piece has already been approved. Take it down instead of declining it.' }, 409);
  }

  const { doc, sha } = await githubReadJson(env, CONTENT_DECLINES_PATH, { schemaVersion: '1.0.0', note: 'Pieces a named person decided not to publish, and why. Nothing here is ever released: publication requires an entry in publication_approvals.json, and declining simply means one was never written.', declines: [] });
  if (!doc || !Array.isArray(doc.declines)) return json({ ok: false, error: 'The decline record could not be read. Nothing was changed.' }, 503);
  if (doc.declines.some((entry) => entry && entry.id === id)) return json({ ok: false, error: 'That piece was already declined.' }, 409);

  const record = {
    id,
    route: item.slug,
    title: item.title,
    declinedBy: decider.name,
    declinedAt: new Date().toISOString(),
    reason
  };
  doc.declines.push(record);
  const commitSha = await githubWriteJson(env, CONTENT_DECLINES_PATH, doc, `admin: ${decider.name} declined ${id}`, sha);
  return json({ ok: true, decision: 'declined', record, commitSha });
}

async function contentTakeDown(request, env, incoming) {
  const id = String(incoming.id || '').trim();
  if (!id) return json({ ok: false, error: 'Which piece? An item id is required.' }, 400);
  const decider = requireDecider(incoming.by);
  if (!decider.ok) return json({ ok: false, error: decider.error }, 400);
  const reason = String(incoming.reason || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 2000);
  // Nothing comes off the site without saying why. This used to write
  // `revokedReason: null` and accept it, which is how 54 items ended up in the
  // manifest marked 'revoked' with no reason for the admin page to show -- and
  // the page filled that silence with the word "Revoked", addressed to a client
  // who had decided nothing. Every removal, by a person or by a machine, carries
  // a reason or it does not happen.
  if (!reason) return json({ ok: false, error: 'Please say why this is coming off the site. Every piece that comes down keeps a note of the reason.' }, 400);

  const { doc: manifest, sha } = await githubReadJson(env, CONTENT_MANIFEST_PATH);
  if (!Array.isArray(manifest)) return json({ ok: false, error: 'The content list could not be read. Nothing was changed.' }, 503);
  const item = manifest.find((entry) => entry && entry.id === id);
  if (!item) return json({ ok: false, error: 'That piece is no longer in the content list.' }, 404);
  if (item.status !== 'published') return json({ ok: false, error: 'That piece is not live, so there is nothing to take down.' }, 400);

  const at = new Date().toISOString();
  const next = manifest.map((entry) => entry && entry.id === id
    ? { ...entry, status: 'revoked', revokedAt: at, revokedBy: decider.name, revokedReason: reason }
    : entry);
  const commitSha = await githubWriteJson(env, CONTENT_MANIFEST_PATH, next, `admin: ${decider.name} took ${id} off the site`, sha);
  return json({ ok: true, decision: 'taken_down', record: { id, route: item.slug, title: item.title, revokedBy: decider.name, revokedAt: at, reason }, commitSha });
}

const CONTENT_DECISIONS = {
  approve: contentApprove,
  decline: contentDecline,
  'take-down': contentTakeDown
};

// Auth is not re-implemented here. Both entry points into this - /api/admin/content/*
// below and /api/content/* in worker/_worker.js - pass through the same
// requireAdminSession check the digital-products endpoints use.
export async function handleContentDecision(request, env, decision) {
  const handler = CONTENT_DECISIONS[decision];
  if (!handler) return json({ ok: false, error: 'Unknown content action.' }, 404);
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const incoming = await request.json().catch(() => ({}));
  try {
    return await handler(request, env, incoming);
  } catch (error) {
    if (error.code === 'GITHUB_SETUP_REQUIRED') {
      return json({
        ok: false,
        status: 'SETUP_REQUIRED',
        provider: 'github',
        message: 'Saving your decision needs the site connection set up first. Nothing was changed.',
        setupPath: '/admin/#github-admin-setup'
      }, 409);
    }
    return json({ ok: false, error: `Your decision could not be saved, so nothing was changed. ${error.message || ''}`.trim() }, 502);
  }
}


function setupRequiredResponse(error, receipt) {
  return json({
    ok: false,
    status: 'SETUP_REQUIRED',
    provider: 'github',
    message: error.message,
    setupPath: '/admin/#github-admin-setup',
    receipt
  }, 409);
}

export async function handleAdminRequest(request, env, url) {
  if (!url.pathname.startsWith('/api/admin/')) return null;
  if (url.pathname === '/api/admin/login') return handleAdminLogin(request, env);
  const denied = await requireAdminSession(request, env);
  if (denied) return denied;

  if (url.pathname.startsWith('/api/admin/content/')) {
    return handleContentDecision(request, env, url.pathname.slice('/api/admin/content/'.length));
  }

  if (url.pathname === '/api/admin/status' && request.method === 'GET') {
    return json({ ok: true, ...(await adminStatus(request, env)) });
  }

  if (url.pathname === '/api/admin/action') {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
    const incoming = await request.json().catch(() => ({}));
    const action = String(incoming.action || '');
    const receipt = {
      id: `admin-${Date.now()}-${randomToken().slice(0, 8)}`,
      action,
      startedAt: new Date().toISOString(),
      status: 'STARTED'
    };
    try {
      if (action === 'test-github-admin') {
        receipt.result = await testGithubConnection(env);
      } else if (['pause', 'resume', 'emergency-stop', 'clear-emergency-stop'].includes(action)) {
        receipt.result = await mutateAutonomyState(env, action, incoming.by);
      } else {
        receipt.result = await dispatchWorkflow(env, action, incoming.inputs || {});
      }
      receipt.status = receipt.result?.state === 'CONNECTION_REQUIRED' ? 'SETUP_REQUIRED' : 'SUCCESS';
      receipt.completedAt = new Date().toISOString();
      await recordAdminReceipt(env, receipt);
      if (receipt.status === 'SETUP_REQUIRED') {
        return json({
          ok: false,
          status: 'SETUP_REQUIRED',
          provider: 'github',
          message: receipt.result.message,
          setupPath: receipt.result.setupPath,
          receipt
        }, 409);
      }
      return json({ ok: true, receipt });
    } catch (error) {
      receipt.completedAt = new Date().toISOString();
      if (error.code === 'GITHUB_SETUP_REQUIRED') {
        receipt.status = 'SETUP_REQUIRED';
        receipt.error = error.message;
        await recordAdminReceipt(env, receipt);
        return setupRequiredResponse(error, receipt);
      }
      receipt.status = 'FAILED';
      receipt.error = error.message;
      await recordAdminReceipt(env, receipt);
      return json({
        ok: false,
        status: 'FAILED',
        message: error.message,
        receipt
      }, 400);
    }
  }

  if (url.pathname === '/api/admin/feedback') {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
    const incoming = await request.json().catch(() => ({}));
    if (!incoming.route || !incoming.feedback) {
      return json({ ok: false, error: 'Route and feedback are required.' }, 400);
    }
    const feedbackKv = adminKv(env, 'ADMIN_FEEDBACK_KV');
    if (!feedbackKv?.put) {
      return json({
        ok: false,
        status: 'SETUP_REQUIRED',
        message: 'Feedback storage is not configured.'
      }, 409);
    }
    const id = `feedback-${Date.now()}-${randomToken().slice(0, 8)}`;
    const record = {
      id,
      route: String(incoming.route).slice(0, 300),
      feedback: String(incoming.feedback).slice(0, 8000),
      createdAt: new Date().toISOString(),
      status: 'RECEIVED'
    };
    await feedbackKv.put(`admin:${id}`, JSON.stringify(record), {
      expirationTtl: 60 * 60 * 24 * 365
    });
    return json({ ok: true, record });
  }

  return json({ ok: false, error: 'Admin endpoint not found.' }, 404);
}

export { json as adminJson, constantTimeEqual, requireDecider };
