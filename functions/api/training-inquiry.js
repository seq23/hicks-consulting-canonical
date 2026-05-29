const LOCKED_FIELDS = ["firstName", "lastName", "company", "email", "services", "eventDate", "honorarium", "referral", "eventDetails"];
const REQUIRED_FIELDS = ["firstName", "lastName", "company", "email", "services", "eventDate", "honorarium", "eventDetails"];

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

export async function onRequestPost({ request, env }) {
  const webhookUrl = env.TRAINING_INQUIRY_WEBHOOK_URL;
  const sharedSecret = env.TRAINING_INQUIRY_SECRET;

  if (!webhookUrl || !sharedSecret) {
    return jsonResponse({ ok: false, error: 'Training inquiry endpoint is not configured.' }, 503);
  }

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

  const missing = REQUIRED_FIELDS.filter((field) => !payload[field]);
  if (missing.length) {
    return jsonResponse({ ok: false, error: `Missing required fields: ${missing.join(', ')}` }, 400);
  }

  if (!isValidEmail(payload.email)) {
    return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
  }

  const submissionId = crypto.randomUUID();
  const forwardPayload = {
    secret: sharedSecret,
    inquiryType: 'training',
    submissionId,
    submittedAt: new Date().toISOString(),
    sourcePage: clean(incoming.sourcePage || '/organizational-training-inquiry/'),
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

  if (!upstream.ok) {
    return jsonResponse({ ok: false, error: 'Submission could not be recorded.' }, 502);
  }

  return jsonResponse({ ok: true, submissionId });
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
}
