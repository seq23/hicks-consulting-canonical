const FORM_TYPE = 'groups';

const FORM_DATABASE_FORMS = {
  training: {
    sourcePage: '/organizational-training-inquiry/',
    fields: ['firstName', 'lastName', 'company', 'email', 'services', 'eventDate', 'honorarium', 'referral', 'eventDetails'],
    required: ['firstName', 'lastName', 'company', 'email', 'services', 'eventDate', 'honorarium', 'eventDetails']
  },
  groups: {
    sourcePage: '/groups/',
    fields: ['firstName', 'lastName', 'email', 'phone', 'groupInterest', 'supportNeed', 'availability', 'message'],
    required: ['firstName', 'lastName', 'email', 'groupInterest', 'supportNeed']
  },
  'lead-magnet': {
    sourcePage: '/stress-management-worksheet/',
    fields: ['firstName', 'email', 'leadMagnet', 'stressContext', 'consent', 'sourcePage', 'submittedAtClient'],
    required: ['firstName', 'email', 'consent'],
    defaultLeadMagnet: 'stress-management-made-simple',
    downloadPath: '/assets/downloads/stress-management-made-simple.pdf',
    requireConsent: true
  }
};

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
  return `form_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function getFormDatabaseConfig(env) {
  return {
    webhookUrl: env.FORM_DATABASE_WEBHOOK_URL || env.TRAINING_INQUIRY_WEBHOOK_URL || env.LEAD_MAGNET_WEBHOOK_URL,
    sharedSecret: env.FORM_DATABASE_SHARED_SECRET || env.TRAINING_INQUIRY_SECRET || env.INQUIRY_SHARED_SECRET || env.LEAD_MAGNET_SHARED_SECRET
  };
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

async function postJsonWithManualRedirect(webhookUrl, body) {
  const requestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    redirect: 'manual'
  };

  const first = await fetch(webhookUrl, requestInit);
  if (![301, 302, 303, 307, 308].includes(first.status)) return first;

  const location = first.headers.get('location');
  if (!location) return first;

  const redirectedUrl = new URL(location, webhookUrl).toString();
  return fetch(redirectedUrl, requestInit);
}

async function submitToFormDatabase({ env, request, formType, fields }) {
  const form = FORM_DATABASE_FORMS[formType];
  const { webhookUrl, sharedSecret } = getFormDatabaseConfig(env);

  if (!webhookUrl || !sharedSecret) {
    return { ok: false, status: 503, body: { ok: false, error: 'Form database endpoint is not configured.' } };
  }

  const submissionId = createSubmissionId();
  const forwardPayload = {
    secret: sharedSecret,
    inquiryType: formType,
    formType,
    leadMagnet: fields.leadMagnet || form.defaultLeadMagnet || '',
    submissionId,
    submittedAt: new Date().toISOString(),
    sourcePage: clean(fields.sourcePage || form.sourcePage),
    userAgent: clean(request.headers.get('user-agent') || ''),
    fields
  };

  let upstream;
  try {
    upstream = await postJsonWithManualRedirect(webhookUrl, JSON.stringify(forwardPayload));
  } catch (error) {
    return { ok: false, status: 502, body: { ok: false, error: 'Submission service unavailable.' } };
  }

  const webhookResult = await readWebhookResult(upstream);
  if (!upstream.ok || !webhookResult.parsed || webhookResult.parsed.ok !== true) {
    return {
      ok: false,
      status: 502,
      body: {
        ok: false,
        error: 'Submission could not be recorded.',
        upstreamStatus: upstream.status,
        upstreamMessage: webhookResult.raw.slice(0, 240)
      }
    };
  }

  return { ok: true, submissionId };
}

async function handleFormDatabaseSubmission({ request, env, formType }) {
  const form = FORM_DATABASE_FORMS[formType];
  if (!form) return jsonResponse({ ok: false, error: 'Unknown form type.' }, 404);

  let incoming;
  try {
    incoming = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  const fields = {};
  for (const field of form.fields) {
    fields[field] = clean(incoming[field]);
  }
  if (form.defaultLeadMagnet && !fields.leadMagnet) fields.leadMagnet = form.defaultLeadMagnet;

  const missing = form.required.filter((field) => !fields[field]);
  if (missing.length) {
    return jsonResponse({ ok: false, error: `Missing required fields: ${missing.join(', ')}` }, 400);
  }

  if (!isValidEmail(fields.email)) {
    return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
  }

  if (form.requireConsent && fields.consent !== 'yes') {
    return jsonResponse({ ok: false, error: 'Consent is required before sending this download.' }, 400);
  }

  const result = await submitToFormDatabase({ env, request, formType, fields });
  if (!result.ok) return jsonResponse(result.body, result.status);

  const body = { ok: true, submissionId: result.submissionId };
  if (form.downloadPath) body.downloadPath = form.downloadPath;
  return jsonResponse(body);
}

export async function onRequestPost({ request, env }) {
  return handleFormDatabaseSubmission({ request, env, formType: FORM_TYPE });
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
}
