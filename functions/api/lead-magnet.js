const FORM_TYPE = 'lead-magnet';

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

function getFormDatabaseConfig(env, formType) {
  if (formType === 'lead-magnet') {
    return {
      webhookUrl: env.LEAD_MAGNET_WEBHOOK_URL || env.FORM_DATABASE_WEBHOOK_URL || env.TRAINING_INQUIRY_WEBHOOK_URL,
      sharedSecret: env.LEAD_MAGNET_SHARED_SECRET || env.FORM_DATABASE_SHARED_SECRET || env.TRAINING_INQUIRY_SECRET || env.INQUIRY_SHARED_SECRET
    };
  }

  return {
    webhookUrl: env.FORM_DATABASE_WEBHOOK_URL || env.TRAINING_INQUIRY_WEBHOOK_URL || env.LEAD_MAGNET_WEBHOOK_URL,
    sharedSecret: env.FORM_DATABASE_SHARED_SECRET || env.TRAINING_INQUIRY_SECRET || env.INQUIRY_SHARED_SECRET || env.LEAD_MAGNET_SHARED_SECRET
  };
}

function normalizeForwardFields(formType, fields) {
  const forwardFields = { ...fields };

  if (formType === 'groups') {
    forwardFields.preferredAvailability = fields.availability || fields.preferredAvailability || '';
    forwardFields.referral = fields.referral || '';
    forwardFields.message = [
      fields.supportNeed ? `Support need: ${fields.supportNeed}` : '',
      fields.availability ? `Availability: ${fields.availability}` : '',
      fields.phone ? `Phone: ${fields.phone}` : '',
      fields.message ? `Additional message: ${fields.message}` : ''
    ].filter(Boolean).join('\n\n');
  }

  if (formType === 'lead-magnet') {
    forwardFields.leadMagnet = fields.leadMagnet || 'stress-management-made-simple';
  }

  return forwardFields;
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

async function postJsonToWebhook(webhookUrl, body) {
  const first = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    redirect: 'manual'
  });

  if (![301, 302, 303, 307, 308].includes(first.status)) return first;

  const location = first.headers.get('location');
  if (!location) return first;

  const redirectedUrl = new URL(location, webhookUrl).toString();

  return fetch(redirectedUrl, {
    method: 'GET'
  });
}

async function sendFormDatabaseSubmission({ env, request, formType, fields }) {
  if (fields && fields.diagnostic === 'cloudflare-runtime') {
    const { webhookUrl, sharedSecret } = getFormDatabaseConfig(env, formType);
    return {
      ok: true,
      submissionId: 'diagnostic-only',
      queued: false,
      diagnostic: {
        runtimeReached: true,
        file: 'functions/api/lead-magnet.js',
        formType,
        hasWebhookUrl: Boolean(webhookUrl),
        webhookHost: webhookUrl ? new URL(webhookUrl).host : null,
        hasSharedSecret: Boolean(sharedSecret)
      }
    };
  }
  const form = FORM_DATABASE_FORMS[formType];
  const { webhookUrl, sharedSecret } = getFormDatabaseConfig(env, formType);

  if (!webhookUrl || !sharedSecret) {
    return { ok: false, status: 503, body: { ok: false, error: 'Form database endpoint is not configured.' } };
  }

  const submissionId = createSubmissionId();
  const forwardFields = normalizeForwardFields(formType, fields);
  const forwardPayload = {
    secret: sharedSecret,
    inquiryType: formType,
    formType,
    leadMagnet: forwardFields.leadMagnet || form.defaultLeadMagnet || '',
    submissionId,
    submittedAt: new Date().toISOString(),
    sourcePage: clean(fields.sourcePage || form.sourcePage),
    userAgent: clean(request.headers.get('user-agent') || ''),
    fields: forwardFields
  };

  let upstream;
  let webhookResult;
  try {
    upstream = await postJsonToWebhook(webhookUrl, JSON.stringify(forwardPayload));
    webhookResult = await readWebhookResult(upstream);
  } catch (error) {
    console.warn('FORM_DATABASE_DISPATCH_ERROR', JSON.stringify({
      formType,
      submissionId,
      message: error && error.message ? String(error.message).slice(0, 240) : 'Unknown dispatch error.'
    }));
    return { ok: false, status: 502, body: { ok: false, error: 'The form database could not be reached. Please try again.' } };
  }

  if (!upstream.ok || !webhookResult.parsed || webhookResult.parsed.ok !== true) {
    console.warn('FORM_DATABASE_DISPATCH_FAILED', JSON.stringify({
      formType,
      submissionId,
      upstreamStatus: upstream.status,
      upstreamMessage: webhookResult.raw.slice(0, 240)
    }));
    return { ok: false, status: 502, body: { ok: false, error: 'The form database did not confirm receipt. Please try again.' } };
  }

  return { ok: true, submissionId, queued: false };
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
  if (incoming && incoming.diagnostic === 'cloudflare-runtime') {
    const { webhookUrl, sharedSecret } = getFormDatabaseConfig(env, formType);
    return jsonResponse({
      ok: true,
      diagnostic: {
        runtimeReached: true,
        file: 'functions/api/lead-magnet.js',
        formType,
        hasWebhookUrl: Boolean(webhookUrl),
        webhookHost: webhookUrl ? new URL(webhookUrl).host : null,
        hasSharedSecret: Boolean(sharedSecret)
      }
    });
  }

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

  const result = await sendFormDatabaseSubmission({ env, request, formType, fields });
  if (!result.ok) return jsonResponse(result.body, result.status);

  const body = { ok: true, submissionId: result.submissionId, queued: result.queued === true };
  if (form.downloadPath) body.downloadPath = form.downloadPath;
  return jsonResponse(body);
}

export async function onRequestPost({ request, env }) {
  try {
    return await handleFormDatabaseSubmission({ request, env, formType: FORM_TYPE });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: 'Function runtime error.',
      message: error && error.message ? String(error.message).slice(0, 240) : 'Unknown runtime error.'
    }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
}
