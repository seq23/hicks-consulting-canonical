#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';

const RUN = process.env.CONTINUITY_RUN_DATE || new Date().toISOString().slice(0, 10);
const HORIZON = Number(process.env.CONTINUITY_HORIZON_DAYS || 120);
const DRY = process.argv.includes('--dry-run');
const DAY_MS = 86400000;

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return fallback; }
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function atUtc(date) { return new Date(`${date}T00:00:00Z`); }
function addDays(date, n) { return new Date(atUtc(date).getTime() + n * DAY_MS); }
function maxDate(values, fallback) { return values.filter(Boolean).sort().at(-1) || fallback; }
function canonicalId(type, date, query) {
  return `continuity-${type}-${date}-${crypto.createHash('sha256').update(`${type}|${date}|${query}`).digest('hex').slice(0, 12)}`;
}
function sectionsFor(type) {
  if (type === 'whitepaper') return ['Executive summary','Context and evidence','Core question','Audience analysis','Framework','Implementation guidance','Risks and limitations','Recommended next steps'];
  if (type === 'guide') return ['Short answer','Who this is for','What to understand first','Decision framework','Practical steps','Common mistakes','When to seek support','Next step'];
  return ['Short answer','Who this is for','Why this matters','Practical examples','Decision criteria','Common mistakes','Next step'];
}
function titleFor(type, query, topic) {
  const clean = String(query || topic || 'Support topic').replace(/\?$/, '');
  if (type === 'article') return `${clean}: a practical guide to what matters most`;
  if (type === 'guide') return `${topic || clean}: a deeper guide for reflection and next steps`;
  if (type === 'whitepaper') return `${topic || clean}: a practical quarterly reference`;
  return `${clean}: what to understand and what to do next`;
}
function contentDir(type) {
  return type === 'article' ? 'articles' : type === 'guide' ? 'guides' : type === 'whitepaper' ? 'white-papers' : 'insights';
}

const manifest = readJson('data/admin/content_manifest.json', []);
const backlog = readJson('data/authority_scale/candidate_backlog.json', { candidates: [] });
const briefs = readJson('data/intake/content_brief_candidates.json', { candidates: [] });
const queue = readJson('data/social/publish_queue.json', { items: [] });
const policy = readJson('config/content_generation_policy.json', { contentTypes: {}, humanizationChecklist: [] });
const config = readJson('data/system/config.json', {});

const existingItems = [...(briefs.candidates || []), ...(queue.items || [])];
const existingIds = new Set(existingItems.map(x => x?.id).filter(Boolean));
const continuityPlannedDates = existingItems
  .filter(x => x?.continuity_generated === true || String(x?.id || '').startsWith('continuity-'))
  .map(x => String(x.proposedScheduledAt || '').slice(0, 10))
  .filter(Boolean);
const manifestDates = manifest.map(x => String(x.scheduledAt || '').slice(0, 10)).filter(Boolean);
const baselineEnd = maxDate(manifestDates, RUN);
const coverageEnd = maxDate([...manifestDates, ...continuityPlannedDates], baselineEnd);
const targetEnd = isoDate(new Date(atUtc(RUN).getTime() + HORIZON * DAY_MS));
const slots = [];

for (let d = addDays(coverageEnd, 1); isoDate(d) <= targetEnd; d = new Date(d.getTime() + DAY_MS)) {
  const date = isoDate(d);
  const dow = d.getUTCDay();
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  if (dow >= 1 && dow <= 5) slots.push({ date, type: 'insight', cadence: 'daily' });
  if (dow === 2) slots.push({ date, type: 'article', cadence: 'weekly' });
  if (day === 15) slots.push({ date, type: 'guide', cadence: 'monthly' });
  if (day === 20 && [3, 6, 9, 12].includes(month)) slots.push({ date, type: 'whitepaper', cadence: 'quarterly' });
}

const candidates = backlog.candidates || [];
const conversionPath = config?.forms?.therapy || 'https://monika-hicks.clientsecure.me/';
const picked = [];
for (let i = 0; i < slots.length && candidates.length; i++) {
  const slot = slots[i];
  const c = candidates[(i * 17 + slot.date.charCodeAt(9)) % candidates.length];
  const id = canonicalId(slot.type, slot.date, c.query || c.topic || c.opportunity_id || String(i));
  if (existingIds.has(id)) continue;
  const typePolicy = policy.contentTypes?.[slot.type] || policy.contentTypes?.insight || { targetWords: 900, minimumWords: 720 };
  const sections = sectionsFor(slot.type);
  const title = titleFor(slot.type, c.query, c.topic);
  const proposedScheduledAt = `${slot.date}T13:00:00.000Z`;
  const llmPrompt = [
    `Create a humanized ${slot.type} draft for Hicks Consulting.`,
    `Title: ${title}`,
    `Topic: ${c.query || c.topic}.`,
    `Cadence: ${slot.cadence}. Proposed future slot: ${proposedScheduledAt}.`,
    `Minimum words: ${typePolicy.minimumWords}. Target words: ${typePolicy.targetWords}.`,
    'Use an answer-first opening, exact-intent headings, concrete examples, and a checklist or decision framework where useful.',
    'Write in a warm, grounded, specific voice. Do not diagnose, guarantee outcomes, or invent client stories.',
    `Include these sections: ${sections.join('; ')}.`,
    `Approved conversion path after value is delivered: ${conversionPath}.`,
    'This is an autonomous candidate. It must pass Safe Harbor, duplicate, source, cadence, build, and release validation before it can be scheduled.'
  ].join('\n');
  picked.push({
    id,
    clusterId: c.opportunity_id,
    clusterTitle: c.topic,
    contentType: slot.type,
    cadence: slot.cadence,
    title,
    suggestedRoute: `/resources/${contentDir(slot.type)}/${id}/`,
    proposedScheduledAt,
    targetWords: typePolicy.targetWords,
    minimumWords: typePolicy.minimumWords,
    sourceSignalCount: 1,
    score: c.priority_score,
    publishMode: 'full_safe_autonomy',
    autonomyStatus: 'DISCOVERED',
    llmGeneratedRequired: true,
    routineApprovalRequired: false,
    publicOnlyAfterApproval: false,
    continuity_generated: true,
    continuityAfter: '2027-01-01',
    continuityPolicy: 'rolling_120_day_candidate_runway_existing_cadence',
    humanizationChecklist: policy.humanizationChecklist || [],
    conversionPath,
    sections,
    llmPrompt
  });
  existingIds.add(id);
}

const report = {
  schema_version: '1.1',
  run_date: RUN,
  horizon_days: HORIZON,
  last_manifest_scheduled_date: baselineEnd,
  prior_coverage_end: coverageEnd,
  target_coverage_end: targetEnd,
  planned_slots_needed: slots.length,
  candidates_added: picked.length,
  dry_run: DRY,
  cadence_preserved: {
    daily: 'weekday insights',
    weekly: 'Tuesday article',
    monthly: '15th guide',
    quarterly: 'Mar/Jun/Sep/Dec 20th whitepaper'
  },
  publication_authority: 'FULL_SAFE_AUTONOMY_WITH_EXISTING_VELOCITY'
};

fs.mkdirSync('data/continuity', { recursive: true });
fs.writeFileSync('data/continuity/editorial_continuity_report.json', JSON.stringify(report, null, 2) + '\n');

if (!DRY && picked.length) {
  const briefMap = new Map((briefs.candidates || []).map(x => [x.id, x]));
  const queueMap = new Map((queue.items || []).map(x => [x.id, x]));
  for (const x of picked) {
    briefMap.set(x.id, x);
    queueMap.set(x.id, { ...x, queueType: 'content_brief', status: 'DISCOVERED', autonomyStatus: 'DISCOVERED' });
  }
  const generatedAt = `${RUN}T00:00:00.000Z`;
  const nextBriefs = { ...briefs, generatedAt, candidates: [...briefMap.values()] };
  const nextQueue = { ...queue, generatedAt, publishMode: 'full_safe_autonomy', items: [...queueMap.values()] };
  fs.writeFileSync('data/intake/content_brief_candidates.json', JSON.stringify(nextBriefs, null, 2) + '\n');
  fs.writeFileSync('data/social/publish_queue.json', JSON.stringify(nextQueue, null, 2) + '\n');
}

console.log(JSON.stringify(report, null, 2));
