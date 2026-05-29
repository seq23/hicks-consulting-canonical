const LOCKED_FIELDS = ["firstName", "email", "leadMagnet", "stressContext", "consent", "sourcePage", "submittedAtClient"];
const REQUIRED_FIELDS = ["firstName", "email", "consent"];
const DOWNLOAD_PATH = "/assets/downloads/stress-management-made-simple.pdf";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function clean(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function createSubmissionId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (error) {}

  return `lead_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

async function readWebhookResult(upstream) {
  const raw = await upstream.text().catch(() => '');
  if (!raw) return { raw, parsed: null };
  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch (error) {
    return { raw, parsed: null };
  }
}

export async function onRequestPost({ request, env }) {
  let incoming;
  try {
    incoming = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  const payload = {};
  for (const field of LOCKED_FIELDS) {
    payload[field] = clean(incoming[field]);
  }
  payload.leadMagnet = payload.leadMagnet || 'stress-management-made-simple';

  const missing = REQUIRED_FIELDS.filter((field) => !payload[field]);
  if (missing.length) {
    return jsonResponse({ ok: false, error: `Missing required fields: ${missing.join(', ')}` }, 400);
  }

  if (!isValidEmail(payload.email)) {
    return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
  }

  if (payload.consent !== 'yes') {
    return jsonResponse({ ok: false, error: 'Consent is required before sending this download.' }, 400);
  }

  const submissionId = createSubmissionId();
  const webhookUrl = env.LEAD_MAGNET_WEBHOOK_URL || env.TRAINING_INQUIRY_WEBHOOK_URL;
  const sharedSecret = env.LEAD_MAGNET_SHARED_SECRET || env.TRAINING_INQUIRY_SECRET || env.INQUIRY_SHARED_SECRET;

  if (!webhookUrl || !sharedSecret) {
    return jsonResponse({ ok: false, error: 'Lead magnet endpoint is not configured.' }, 503);
  }

  const forwardPayload = {
    secret: sharedSecret,
    inquiryType: 'lead-magnet',
    leadMagnet: payload.leadMagnet,
    submissionId,
    submittedAt: new Date().toISOString(),
    sourcePage: clean(payload.sourcePage || '/stress-management-worksheet/'),
    userAgent: clean(request.headers.get('user-agent') || ''),
    fields: payload
  };

  let upstream;
  try {
    upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forwardPayload)
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Submission service unavailable.' }, 502);
  }

  const webhookResult = await readWebhookResult(upstream);

  if (!upstream.ok || !webhookResult.parsed || webhookResult.parsed.ok !== true) {
    return jsonResponse({
      ok: false,
      error: 'Submission could not be recorded.',
      upstreamStatus: upstream.status,
      upstreamMessage: webhookResult.raw.slice(0, 240)
    }, 502);
  }

  return jsonResponse({ ok: true, submissionId, downloadPath: DOWNLOAD_PATH });
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
}
