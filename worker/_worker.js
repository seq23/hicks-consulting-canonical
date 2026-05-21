const SHARED_FIELDS = [
  'firstName',
  'lastName',
  'company',
  'email',
  'services',
  'eventDate',
  'honorarium',
  'referral',
  'eventDetails'
];

const REQUIRED_FIELDS = [
  'firstName',
  'lastName',
  'company',
  'email',
  'services',
  'eventDate',
  'honorarium',
  'eventDetails'
];

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

async function handleInquiry(request, env, inquiryType) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }

  const webhookUrl = env.TRAINING_INQUIRY_WEBHOOK_URL;
  const sharedSecret = env.TRAINING_INQUIRY_SECRET || env.INQUIRY_SHARED_SECRET;

  if (!webhookUrl || !sharedSecret) {
    return jsonResponse({ ok: false, error: 'Inquiry endpoint is not configured.' }, 503);
  }

  let incoming;
  try {
    incoming = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  const payload = {};
  for (const field of SHARED_FIELDS) {
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
  const sourcePage = inquiryType === 'groups' ? '/groups/' : '/organizational-training-inquiry/';
  const forwardPayload = {
    secret: sharedSecret,
    inquiryType,
    submissionId,
    submittedAt: new Date().toISOString(),
    sourcePage: clean(incoming.sourcePage || sourcePage),
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
    const upstreamText = await upstream.text().catch(() => '');
    return jsonResponse({
      ok: false,
      error: 'Submission could not be recorded.',
      upstreamStatus: upstream.status,
      upstreamMessage: upstreamText.slice(0, 240)
    }, 502);
  }

  return jsonResponse({ ok: true, submissionId });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/training-inquiry') {
      return handleInquiry(request, env, 'training');
    }

    if (url.pathname === '/api/groups-inquiry') {
      return handleInquiry(request, env, 'groups');
    }

    return env.ASSETS.fetch(request);
  }
};
