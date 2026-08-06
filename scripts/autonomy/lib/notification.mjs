import { readJson, writeJsonAtomic, nowIso } from './io.mjs';

export function buildPublicationEmail(receipt) {
  const published = receipt.published || [];
  const rows = published.map((item) => [
    `<h2>${item.title}</h2>`,
    `<p><strong>Live URL:</strong> <a href="${item.url}">${item.url}</a></p>`,
    `<p><strong>Why it was selected:</strong> ${item.selectionReason || 'It filled an existing approved editorial slot and passed the autonomous safety and quality gates.'}</p>`,
    `<p><strong>Target query or cluster:</strong> ${item.query || item.cluster || 'Editorial calendar topic'}</p>`,
    `<p><strong>Safe Harbor decision:</strong> ${item.decision || 'EXISTING_VALIDATED_EDITORIAL_ITEM'}</p>`,
    `<p><strong>What the system checked:</strong> source and claim safety, duplication, metadata, internal links, build integrity, and publishing-state integrity.</p>`,
    item.sources?.length ? `<p><strong>Sources carried by the page:</strong> ${item.sources.map((source) => typeof source === 'string' ? source : source.title || source.url).join('; ')}</p>` : '<p><strong>Sources carried by the page:</strong> No external source was required or recorded for this resource.</p>',
    item.internalLinks?.length ? `<p><strong>Internal links added:</strong> ${item.internalLinks.join(', ')}</p>` : '<p><strong>Internal links added:</strong> Existing page navigation and related-resource links were preserved.</p>',
    item.repairs?.length ? `<p><strong>Automatic repairs:</strong> ${item.repairs.map((repair) => repair.code || repair).join(', ')}</p>` : '<p><strong>Automatic repairs:</strong> None required.</p>',
    `<p>Please double-check the page when convenient. Reply with any personal context, examples, nuance, corrections, or additions you want considered. No reply is required for the page to remain live.</p>`
  ].join('\n')).join('<hr/>');
  return {
    subject: published.length === 1 ? `Hicks Consulting published: ${published[0].title}` : `Hicks Consulting published ${published.length} resources`,
    html: `<p>The autonomous publishing system completed a safe publication run.</p>${rows}<hr/><p><strong>Run receipt:</strong> ${receipt.receiptId}</p><p>This email is an explanation and optional review request, not an approval gate.</p>`
  };
}

export function enqueuePublicationNotification(receipt, clock = new Date()) {
  const queue = readJson('data/autonomy/notification_queue.json', { schemaVersion: '1.0.0', items: [] });
  const email = buildPublicationEmail(receipt);
  queue.items.push({ id: `notification-${receipt.receiptId}`, receiptId: receipt.receiptId, state: 'PENDING', attempts: 0, createdAt: nowIso(clock), email });
  writeJsonAtomic('data/autonomy/notification_queue.json', queue);
}

async function sendResend(item, env) {
  const response = await fetch(env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.PUBLICATION_NOTIFICATION_FROM, to: [env.PUBLICATION_NOTIFICATION_TO], subject: item.email.subject, html: item.email.html }),
    signal: AbortSignal.timeout(Number(env.EMAIL_TIMEOUT_MS || 20000))
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${text.slice(0, 600)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function sendWebhook(item, env) {
  const response = await fetch(env.EMAIL_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...(env.EMAIL_WEBHOOK_SECRET ? { authorization: `Bearer ${env.EMAIL_WEBHOOK_SECRET}` } : {}) }, body: JSON.stringify({ to: env.PUBLICATION_NOTIFICATION_TO, ...item.email, receiptId: item.receiptId }), signal: AbortSignal.timeout(Number(env.EMAIL_TIMEOUT_MS || 20000)) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Email webhook returned ${response.status}: ${text.slice(0, 600)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

export async function deliverPendingNotifications(env = process.env, clock = new Date()) {
  const queue = readJson('data/autonomy/notification_queue.json', { schemaVersion: '1.0.0', items: [] });
  const configured = Boolean(env.PUBLICATION_NOTIFICATION_TO && ((env.RESEND_API_KEY && env.PUBLICATION_NOTIFICATION_FROM) || env.EMAIL_WEBHOOK_URL));
  const results = [];
  for (const item of queue.items.filter((entry) => ['PENDING', 'PROVIDER_GATED', 'FAILED_RETRYABLE'].includes(entry.state))) {
    if (!configured) {
      item.state = 'PROVIDER_GATED';
      item.lastError = 'Email provider is not configured.';
      results.push({ id: item.id, state: item.state });
      continue;
    }
    item.attempts = Number(item.attempts || 0) + 1;
    item.lastAttemptAt = nowIso(clock);
    try {
      const providerResult = env.RESEND_API_KEY ? await sendResend(item, env) : await sendWebhook(item, env);
      item.state = 'SENT';
      item.sentAt = nowIso(clock);
      item.providerReceipt = providerResult;
    } catch (error) {
      item.state = item.attempts >= Number(env.EMAIL_MAX_ATTEMPTS || 5) ? 'FAILED_FINAL' : 'FAILED_RETRYABLE';
      item.lastError = error.message;
    }
    results.push({ id: item.id, state: item.state });
  }
  writeJsonAtomic('data/autonomy/notification_queue.json', queue);
  return results;
}
