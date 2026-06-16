const FINDING_MARKER = 'VALIDATION_FINDING';

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [messages])
    .map((message) => String(message || '').trim())
    .filter(Boolean);
}

function emitFinding(messages, { stream = 'error', summary = '' } = {}) {
  const normalized = normalizeMessages(messages);
  if (!normalized.length) return false;

  const checkId = process.env.VALIDATION_CHECK_ID || 'unregistered-check';
  const header = `${FINDING_MARKER} check=${checkId}${summary ? ` summary=${summary}` : ''}`;
  const writer = stream === 'warn' ? console.warn : console.error;
  writer(header);
  for (const message of normalized) writer(message);
  return true;
}

function fail(message) {
  emitFinding(message, { stream: 'error' });
  process.exit(1);
}

function warn(messages, summary = '') {
  return emitFinding(messages, { stream: 'warn', summary });
}

module.exports = {
  FINDING_MARKER,
  emitFinding,
  fail,
  warn
};
