const ADMIN_PASSWORD_HASH = 'c7ef3319e6cf6aab9035156df95f18dfec2ba2178f733940eda688758805708b';

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

export function verifyAdminPasswordHash(request) {
  return constantTimeEqual(request.headers.get('x-admin-password-hash') || '', ADMIN_PASSWORD_HASH);
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

async function mutateAutonomyState(env, action) {
  const filePath = 'data/autonomy/state.json';
  const branch = env.GITHUB_BRANCH || 'main';
  const current = await githubRequest(env, `/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
  const decoded = JSON.parse(base64urlDecodeText(String(current.content || '').replace(/\s+/g, '')));
  if (action === 'pause') decoded.paused = true;
  if (action === 'resume') decoded.paused = false;
  if (action === 'emergency-stop') decoded.emergencyStop = true;
  if (action === 'clear-emergency-stop') decoded.emergencyStop = false;
  decoded.adminUpdatedAt = new Date().toISOString();
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

function requireGate(request) {
  return verifyAdminPasswordHash(request)
    ? null
    : json({ ok: false, error: 'Admin password did not match.' }, 401);
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
  const denied = requireGate(request);
  if (denied) return denied;

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
        receipt.result = await mutateAutonomyState(env, action);
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

export { ADMIN_PASSWORD_HASH, json as adminJson, constantTimeEqual };
