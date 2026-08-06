import fs from 'node:fs';
import path from 'node:path';
import { ROOT, writeTextAtomic } from './io.mjs';

const HARD_PATTERNS = [
  /\bguarantee(?:d|s)? (?:healing|results|recovery|outcomes)\b/i,
  /\bwill cure\b/i,
  /\bthis means you have (?:anxiety|depression|ptsd|trauma)\b/i,
  /\b24\/7 crisis support from Hicks Consulting\b/i
];

export function analyzeResourceHtml(relativePath) {
  const full = path.resolve(ROOT, relativePath);
  if (!fs.existsSync(full)) return { safe: false, blocked: true, findings: [{ code: 'PAGE_MISSING', severity: 'hard' }], repairs: [] };
  const html = fs.readFileSync(full, 'utf8');
  const findings = [];
  const repairs = [];
  if (!/<title>[^<]{8,}<\/title>/i.test(html)) findings.push({ code: 'MISSING_TITLE', severity: 'repairable' });
  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{40,}["']/i.test(html) && !/<meta[^>]+content=["'][^"']{40,}["'][^>]+name=["']description["']/i.test(html)) findings.push({ code: 'MISSING_DESCRIPTION', severity: 'repairable' });
  if (!/<link[^>]+rel=["']canonical["']/i.test(html) && !/<link[^>]+href=["'][^"']+["'][^>]+rel=["']canonical["']/i.test(html)) findings.push({ code: 'MISSING_CANONICAL', severity: 'repairable' });
  if ((html.match(/<h1\b/gi) || []).length !== 1) findings.push({ code: 'H1_COUNT', severity: 'hard' });
  if (!/Monika Hicks, LCSW/i.test(html) || !/href=["']\/about\//i.test(html)) findings.push({ code: 'MISSING_AUTHOR_EVIDENCE', severity: 'repairable' });
  if (!/<time[^>]+datetime=/i.test(html)) findings.push({ code: 'MISSING_VISIBLE_DATE', severity: 'repairable' });
  if (!/educational|informational note/i.test(html)) findings.push({ code: 'MISSING_INFORMATIONAL_BOUNDARY', severity: 'repairable' });
  for (const regex of HARD_PATTERNS) if (regex.test(html)) findings.push({ code: 'PROHIBITED_CLAIM', severity: 'hard', match: regex.source });
  return { safe: !findings.some((finding) => finding.severity === 'hard'), blocked: findings.some((finding) => finding.severity === 'hard'), findings, repairs, html };
}

export function repairResourceHtml(relativePath, analysis, { canonical, date, title = 'Hicks Consulting Resource' } = {}) {
  let html = analysis.html;
  const repairs = [];
  const repairable = new Set((analysis.findings || []).filter((finding) => finding.severity === 'repairable').map((finding) => finding.code));
  if (repairable.has('MISSING_TITLE')) { html = html.replace(/<head>/i, `<head><title>${title} | Hicks Consulting</title>`); repairs.push({ code: 'MISSING_TITLE', action: 'inserted' }); }
  if (repairable.has('MISSING_DESCRIPTION')) { html = html.replace(/<head>/i, '<head><meta name="description" content="A Hicks Consulting educational resource for emotional wellness, practical reflection, and healthier patterns of support."/>'); repairs.push({ code: 'MISSING_DESCRIPTION', action: 'inserted' }); }
  if (repairable.has('MISSING_CANONICAL') && canonical) { html = html.replace(/<head>/i, `<head><link rel="canonical" href="${canonical}"/>`); repairs.push({ code: 'MISSING_CANONICAL', action: 'inserted' }); }
  if (repairable.has('MISSING_VISIBLE_DATE') && date) { html = html.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/i, `$1<p class="resource-author-credit">Author: Monika Hicks, LCSW · <a href="/about/">Read bio</a> · <time datetime="${date}">${date}</time></p>`); repairs.push({ code: 'MISSING_VISIBLE_DATE', action: 'inserted' }); }
  if (repairable.has('MISSING_AUTHOR_EVIDENCE')) { html = html.replace(/<\/main>/i, '<aside class="resource-author-box"><p class="eyebrow">About the author</p><h2><a href="/about/">Monika Hicks, LCSW</a></h2><p>Monika Hicks is a licensed clinical social worker and founder of Hicks Consulting.</p></aside></main>'); repairs.push({ code: 'MISSING_AUTHOR_EVIDENCE', action: 'inserted' }); }
  if (repairable.has('MISSING_INFORMATIONAL_BOUNDARY')) { html = html.replace(/<\/main>/i, '<div class="notice"><strong>Informational note:</strong> This resource is educational and does not replace therapy, diagnosis, crisis care, or individualized medical advice.</div></main>'); repairs.push({ code: 'MISSING_INFORMATIONAL_BOUNDARY', action: 'inserted' }); }
  if (repairs.length) writeTextAtomic(relativePath, html);
  return repairs;
}
