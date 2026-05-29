const TRAINING_FIELDS = [
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

const TRAINING_REQUIRED_FIELDS = [
  'firstName',
  'lastName',
  'company',
  'email',
  'services',
  'eventDate',
  'honorarium',
  'eventDetails'
];

const LEAD_MAGNET_FIELDS = [
  'firstName',
  'email',
  'leadMagnet',
  'stressContext',
  'consent',
  'sourcePage',
  'submittedAtClient'
];

const LEAD_MAGNET_REQUIRED_FIELDS = [
  'firstName',
  'email',
  'consent'
];

const LEAD_MAGNET_DOWNLOAD_PATH = '/assets/downloads/stress-management-made-simple.pdf';

const GROUPS_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'groupInterest',
  'supportNeed',
  'availability',
  'message'
];

const GROUPS_REQUIRED_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'groupInterest',
  'supportNeed'
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

async function readWebhookResult(upstream) {
  const raw = await upstream.text().catch(() => '');
  if (!raw) return { raw, parsed: null };
  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch (error) {
    return { raw, parsed: null };
  }
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

  const fields = inquiryType === 'groups' ? GROUPS_FIELDS : TRAINING_FIELDS;
  const requiredFields = inquiryType === 'groups' ? GROUPS_REQUIRED_FIELDS : TRAINING_REQUIRED_FIELDS;

  const payload = {};
  for (const field of fields) {
    payload[field] = clean(incoming[field]);
  }

  const missing = requiredFields.filter((field) => !payload[field]);
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

async function handleLeadMagnet(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }

  let incoming;
  try {
    incoming = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  const payload = {};
  for (const field of LEAD_MAGNET_FIELDS) {
    payload[field] = clean(incoming[field]);
  }
  payload.leadMagnet = payload.leadMagnet || 'stress-management-made-simple';

  const missing = LEAD_MAGNET_REQUIRED_FIELDS.filter((field) => !payload[field]);
  if (missing.length) {
    return jsonResponse({ ok: false, error: `Missing required fields: ${missing.join(', ')}` }, 400);
  }

  if (!isValidEmail(payload.email)) {
    return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
  }

  if (payload.consent !== 'yes') {
    return jsonResponse({ ok: false, error: 'Consent is required before sending this download.' }, 400);
  }

  const submissionId = crypto.randomUUID();
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

  return jsonResponse({ ok: true, submissionId, downloadPath: LEAD_MAGNET_DOWNLOAD_PATH });
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

    if (url.pathname === '/api/lead-magnet') {
      return handleLeadMagnet(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
