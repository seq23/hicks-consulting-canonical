const PROHIBITED_PATTERNS = [
  { code: 'GUARANTEE', regex: /\b(guarantee(?:d|s)?|will cure|will heal|always works|permanent cure)\b/i },
  { code: 'DIAGNOSE_READER', regex: /\b(you have|you are suffering from|this means you have)\s+(anxiety|depression|ptsd|trauma|a disorder)\b/i },
  { code: 'BEST_RANKING', regex: /\b(best|top[- ]rated|number one|#1)\s+(therapist|therapy|provider|practice)\b/i },
  { code: 'CRISIS_PROMISE', regex: /\b(immediate crisis care|24\/7 crisis support from Hicks Consulting)\b/i },
  { code: 'MEDICAL_DIRECTIVE', regex: /\b(stop taking|start taking|change your medication|follow this medical advice|this is medical advice)\b/i }
];

const PROTECTED_FACT_PATTERNS = [
  { code: 'FEE_FACT', regex: /\b(\$\d+|costs? \d+|fee is|session price)\b/i },
  { code: 'INSURANCE_FACT', regex: /\b(accepts? insurance|in[- ]network|out[- ]of[- ]network|insurance plan)\b/i },
  { code: 'PHYSICAL_OFFICE_FACT', regex: /\b(office located|located at|in-person office|Memphis office)\b/i },
  { code: 'AVAILABILITY_FACT', regex: /\b(currently accepting|same-day availability|appointments available|openings this week)\b/i },
  { code: 'TESTIMONIAL_FACT', regex: /\b(client said|testimonial|one client|my patient)\b/i },
  { code: 'UNSUPPORTED_MODALITY', regex: /\b(EMDR|DBT|CBT|somatic experiencing|brainspotting)\b/i }
];

const NUMERIC_CLAIM = /\b\d+(?:\.\d+)?%\b|\b\d+\s+(?:people|adults|women|clients)\b/i;

export function plainTextFromDraft(draft) {
  const sections = Array.isArray(draft?.sections) ? draft.sections : [];
  return [draft?.title, draft?.description, draft?.shortAnswer, ...sections.flatMap((section) => [section?.heading, section?.body, ...(section?.bullets || [])]), draft?.disclaimer]
    .filter(Boolean)
    .join('\n');
}

function wordSet(text) {
  return new Set(String(text || '').toLowerCase().match(/[a-z0-9’'-]{3,}/g) || []);
}

export function jaccardSimilarity(a, b) {
  const left = wordSet(a);
  const right = wordSet(b);
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
}

export function validateDraft(draft, { existingDocuments = [], minimumWords = 560, duplicateThreshold = 0.82 } = {}) {
  const findings = [];
  if (!draft || typeof draft !== 'object') return { safe: false, decision: 'SYSTEM_BLOCKED', findings: [{ code: 'INVALID_DRAFT', severity: 'hard', message: 'Draft is not an object.' }] };
  for (const field of ['title', 'description', 'shortAnswer', 'sections']) {
    if (!draft[field] || (Array.isArray(draft[field]) && draft[field].length === 0)) findings.push({ code: `MISSING_${field.toUpperCase()}`, severity: 'repairable', message: `Draft is missing ${field}.` });
  }
  const text = plainTextFromDraft(draft);
  const words = text.match(/[a-z0-9’'-]+/gi) || [];
  if (words.length < minimumWords) findings.push({ code: 'THIN_CONTENT', severity: 'repairable', message: `Draft has ${words.length} words; minimum is ${minimumWords}.` });
  for (const pattern of PROHIBITED_PATTERNS) {
    if (pattern.regex.test(text)) findings.push({ code: pattern.code, severity: 'repairable', message: `Prohibited or unsafe phrasing matched ${pattern.code}.` });
  }
  for (const pattern of PROTECTED_FACT_PATTERNS) {
    if (pattern.regex.test(text)) findings.push({ code: pattern.code, severity: 'protected', message: `Protected fact requires client confirmation: ${pattern.code}.` });
  }
  if (NUMERIC_CLAIM.test(text) && (!Array.isArray(draft.sources) || draft.sources.length === 0)) {
    findings.push({ code: 'UNSOURCED_NUMERIC_CLAIM', severity: 'protected', message: 'Numeric or prevalence claim has no source.' });
  }
  const sourceUrls = Array.isArray(draft.sources) ? draft.sources.map((source) => typeof source === 'string' ? source : source?.url).filter(Boolean) : [];
  for (const url of sourceUrls) {
    if (!/^https:\/\//i.test(url)) findings.push({ code: 'INVALID_SOURCE_URL', severity: 'repairable', message: `Source URL is not HTTPS: ${url}` });
  }
  let duplicate = null;
  for (const document of existingDocuments) {
    const similarity = jaccardSimilarity(text, document.text || '');
    if (!duplicate || similarity > duplicate.similarity) duplicate = { route: document.route, similarity };
  }
  if (duplicate && duplicate.similarity >= duplicateThreshold) findings.push({ code: 'DUPLICATE_INTENT', severity: 'duplicate', message: `Draft similarity ${(duplicate.similarity * 100).toFixed(1)}% with ${duplicate.route}.`, relatedRoute: duplicate.route });

  let decision = 'SAFE_AUTOPUBLISH';
  if (findings.some((f) => f.severity === 'protected')) decision = 'SKIPPED_UNSUPPORTED_CLAIM';
  else if (findings.some((f) => f.severity === 'duplicate')) decision = 'SKIPPED_DUPLICATE_INTENT';
  else if (findings.length) decision = 'REPAIR_REQUIRED';
  return { safe: decision === 'SAFE_AUTOPUBLISH', decision, findings, wordCount: words.length, closestDuplicate: duplicate };
}

export function localRepairDraft(input, findings = []) {
  const draft = structuredClone(input || {});
  const textReplace = (value) => String(value || '')
    .replace(/\bguarantee(?:d|s)?\b/gi, 'support')
    .replace(/\bwill cure\b/gi, 'may help someone address')
    .replace(/\bwill heal\b/gi, 'may support healing')
    .replace(/\balways works\b/gi, 'can be useful for some people')
    .replace(/\bpermanent cure\b/gi, 'ongoing support')
    .replace(/\b(best|top[- ]rated|number one|#1)\s+(therapist|therapy|provider|practice)\b/gi, '$2 option')
    .replace(/\bthis means you have\b/gi, 'this may be worth discussing with a qualified professional because it can resemble');
  for (const field of ['title', 'description', 'shortAnswer', 'disclaimer']) if (draft[field]) draft[field] = textReplace(draft[field]);
  if (Array.isArray(draft.sections)) {
    draft.sections = draft.sections.map((section) => ({
      ...section,
      heading: textReplace(section.heading),
      body: textReplace(section.body),
      bullets: Array.isArray(section.bullets) ? section.bullets.map(textReplace) : section.bullets
    }));
  }
  if (!draft.disclaimer) draft.disclaimer = 'This educational resource does not provide diagnosis, crisis care, medical advice, or a guarantee of outcomes.';
  if (!Array.isArray(draft.internalLinks) || draft.internalLinks.length === 0) draft.internalLinks = ['/resources/', '/therapy/', '/about/'];
  if (!draft.description && draft.shortAnswer) draft.description = String(draft.shortAnswer).slice(0, 155);
  if (!draft.shortAnswer && Array.isArray(draft.sections) && draft.sections[0]?.body) draft.shortAnswer = String(draft.sections[0].body).slice(0, 240);
  draft.repairLog = [...(draft.repairLog || []), ...findings.filter((f) => f.severity === 'repairable').map((f) => ({ code: f.code, action: 'local_rewrite_or_default' }))];
  return draft;
}

export const SAFE_HARBOR_DECISIONS = [
  'SAFE_AUTOPUBLISH',
  'REWRITTEN_AND_AUTOPUBLISHED',
  'SKIPPED_PROTECTED_OWNER',
  'SKIPPED_UNSUPPORTED_CLAIM',
  'SKIPPED_PROHIBITED_ACTION',
  'SKIPPED_DUPLICATE_INTENT',
  'SELF_REPAIRED',
  'PUBLISHED',
  'DISTRIBUTED',
  'MEASURED',
  'SYSTEM_BLOCKED'
];
