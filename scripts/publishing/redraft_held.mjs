// Redraft lane for scheduled Resources posts whose body copies pages already live.
//
// Why it exists. From 9 Oct 2026 the daily calendar lost slots to
// SEARCH_METADATA_UNRESOLVED holds: the queued drafts were cut from one template,
// so 70-97% of each body's 8-word runs already sat on live pages and no distinct
// description could be found. The hold is right (publishing copies hurts the
// whole domain), but nothing ever redrafted them, so a held slot stayed held
// forever. Owner ruling 3 Nov 2026: Resources posts publish automatically on
// schedule; every quality gate stays.
//
// What it does, each Content Publish run, BEFORE the release step:
//   - picks approved, unpublished /resources/ items due now or within LOOKAHEAD
//     days whose passages still share text with live pages (most overdue first);
//   - asks a FREE model through scripts/llm/free_router.mjs (the only model path in
//     this repo: $0/$0 models, provider.max_price 0, cost read back and refused if
//     non-zero, no paid fallback) to reword only the copied passages;
//   - keeps the rewrite only if every reworded passage shares no 8-word run with
//     any live page, the page as a whole falls under MAX_SHARED, the wording rules
//     hold, and the publisher's own safety analysis still passes. Otherwise the
//     page is left byte-for-byte as it was and the reason is logged.
// The release step then judges the page with the same metadata, duplicate-text
// and claim gates as any other; a redraft is never forced through.
//
// Never touches a published page: an item must be unpublished in the manifest
// AND its route absent from the live sitemap, or it is refused.
//
// Named stops (exit 0, the next run retries, printed and annotated): the free
//   router's own (FREE_ROUTER_NO_KEY, OPENROUTER_KEY_DISABLED_OR_INVALID,
//   NO_FREE_MODEL_ANSWERED) and REDRAFT_FAILED.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { analyzeResourceHtml } from '../autonomy/lib/self_heal.mjs';

const require = createRequire(import.meta.url);
const lib = require('../lib/search_metadata.js');

export const LOOKAHEAD_DAYS = 7;
export const MAX_SHARED = 0.25;     // share of the page's passage runs that may still match live text
export const MIN_SHARED_TO_REDRAFT = 0.15;
export const DEFAULT_MAX_ITEMS = 4;
const LOG_PATH = 'data/autonomy/redrafts.json';
const LOG_KEEP = 300;

// Passages the publisher reads for a description (scripts/lib/search_metadata.js#pagePassages)
// and that hold plain text only, so a rewrite can never drop a link or markup.
const TARGETS = [
  { name: 'short-answer', re: /(<div class="short-answer">)([^<]*)(<\/div>)/gi },
  { name: 'hero-copy', re: /(<p class="hero-copy">)([^<]*)(<\/p>)/gi },
  { name: 'summary', re: /(<p class="recommendation-summary__answer">)([^<]*)(<\/p>)/gi },
];

const decode = (s) => lib.stripTags(s);
const encode = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function editablePassages(html) {
  const out = [];
  for (const t of TARGETS) for (const m of html.matchAll(t.re)) out.push({ start: m.index + m[1].length, end: m.index + m[1].length + m[2].length, text: decode(m[2]) });
  const bodyStart = html.search(/class="[^"]*article-body[^"]*"/i);
  if (bodyStart >= 0) {
    for (const m of html.slice(bodyStart).matchAll(/<p>([^<]+)<\/p>/gi)) {
      const start = bodyStart + m.index + 3;
      out.push({ start, end: start + m[1].length, text: decode(m[1]) });
    }
  }
  return out.filter((p) => p.text).sort((a, b) => a.start - b.start);
}

function runsOf(passages) {
  const all = new Set();
  for (const p of passages) for (const r of lib.shinglesOf(p)) all.add(r);
  return all;
}

function sharedShare(passages, liveRuns) {
  const runs = runsOf(passages);
  if (!runs.size) return 0;
  let shared = 0;
  for (const r of runs) if (liveRuns.has(r)) shared += 1;
  return shared / runs.size;
}

// Wording rules for a licensed clinician's site (search-loop.config.json voice):
// educational only; never speak as the therapist; no numbers, outcomes or claims.
export function wordingProblem(text) {
  if (!text || text.length < 30) return 'too short';
  if (text.length > 700) return 'too long';
  if (/[<>]/.test(text)) return 'markup';
  if (/\d/.test(text)) return 'a number';
  if (/\b(I|I'm|I've|I'd|my|me|mine)\b/.test(text)) return 'first person';
  if (/guarantee|\bcures?\b|\bcured\b|diagnos|prescri|medication|will fix|proven to/i.test(text)) return 'a claim';
  return null;
}

function livePages(root, manifest) {
  const sitemap = fs.existsSync(path.join(root, 'sitemap.xml')) ? fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8') : '';
  const routes = new Set([...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]));
  for (const item of manifest) if (item.status === 'published') routes.add(item.publicPath || item.slug);
  return routes;
}

const pageFile = (root, route) => path.join(root, 'pages', String(route).replace(/^\/+|\/+$/g, ''), 'index.html');

export function loadLog(root) {
  const file = path.join(root, LOG_PATH);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schemaVersion: '1.0.0', note: 'Written by scripts/publishing/redraft_held.mjs. One line per redraft attempt on an unpublished Resources post.', items: [] };
}

function buildMessages(item, passages, voice) {
  return [
    { role: 'system', content: `You reword passages of an educational article for Hicks Consulting, a virtual therapy and coaching practice. Voice: ${voice} Write fresh wording that is specific to the article's title; do not reuse phrases from the input. Plain text only: no numbers, no statistics, no links, no first person (never I, me or my), no promises or outcomes, no diagnosis or medication. Keep each passage about the same length and meaning, and make the first passage one or two whole sentences of 120 to 160 characters. Answer with JSON only: {"passages": ["...", "..."]} with exactly as many entries as given, in the same order.` },
    { role: 'user', content: JSON.stringify({ title: item.title, passages: passages.map((p) => p.text) }) },
  ];
}

function parseAnswer(text, n) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const list = JSON.parse(m[0]).passages;
    return Array.isArray(list) && list.length === n && list.every((s) => typeof s === 'string') ? list.map((s) => s.replace(/\s+/g, ' ').trim()) : null;
  } catch { return null; }
}

/**
 * chat(messages) -> { ok, answer, model } | { ok:false, stop, reason }
 * isApproved(item) -> boolean (the publisher's own approval answer)
 */
export async function redraftHeld({ root = process.cwd(), chat, isApproved, now = new Date(), max = DEFAULT_MAX_ITEMS, voice = '', budgetMs = 6 * 60000 }) {
  const started = Date.now();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/admin/content_manifest.json'), 'utf8'));
  const live = livePages(root, manifest);
  const liveRuns = new Set();
  for (const route of live) {
    const file = pageFile(root, route);
    if (!fs.existsSync(file)) continue;
    for (const r of runsOf(lib.pagePassages(fs.readFileSync(file, 'utf8')))) liveRuns.add(r);
  }
  const horizon = now.valueOf() + LOOKAHEAD_DAYS * 86400000;
  const candidates = manifest
    .filter((item) => item.status === 'approved' && item.validationPassed === true && item.scheduledAt && Date.parse(item.scheduledAt) <= horizon)
    .filter((item) => String(item.publicPath || item.slug || '').startsWith('/resources/'))
    .filter((item) => !live.has(item.publicPath || item.slug))
    .filter((item) => isApproved(item))
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));

  const results = [];
  let stop = null;
  let examined = 0;
  for (const item of candidates) {
    if (results.filter((r) => r.outcome !== 'NOT_COPIED').length >= max) break;
    if (Date.now() - started > budgetMs) { stop = { ok: false, stop: 'REDRAFT_TIME_BUDGET', reason: `the lane's ${Math.round(budgetMs / 60000)}-minute budget is used; the rest wait for the next run.` }; break; }
    const route = item.publicPath || item.slug;
    const file = pageFile(root, route);
    if (!fs.existsSync(file)) continue;
    examined += 1;
    const original = fs.readFileSync(file, 'utf8');
    const passages = editablePassages(original);
    // Measured on the passages this lane may reword: the site-wide footer, bio and
    // hours text every page shares is not the article and is never rewritten.
    const before = sharedShare(passages.map((p) => p.text), liveRuns);
    if (before < MIN_SHARED_TO_REDRAFT) { results.push({ id: item.id, route, outcome: 'NOT_COPIED', before }); continue; }
    const copied = passages.filter((p) => [...lib.shinglesOf(p.text)].some((r) => liveRuns.has(r)));
    if (!copied.length) { results.push({ id: item.id, route, outcome: 'REJECTED_NOTHING_EDITABLE', before }); continue; }
    const answer = await chat(buildMessages(item, copied, voice));
    if (!answer.ok) { stop = answer; break; }
    const rewritten = parseAnswer(answer.answer, copied.length);
    const record = { id: item.id, route, before, model: answer.model };
    if (!rewritten) { results.push({ ...record, outcome: 'REJECTED_UNREADABLE_ANSWER' }); continue; }
    const ownRuns = new Set();
    let stillCopied = false;
    for (const text of rewritten) for (const r of lib.shinglesOf(text)) { if (liveRuns.has(r) || ownRuns.has(r)) stillCopied = true; ownRuns.add(r); }
    if (stillCopied) { results.push({ ...record, outcome: 'REJECTED_STILL_COPIED' }); continue; }
    const problem = rewritten.map(wordingProblem).find(Boolean);
    if (problem) { results.push({ ...record, outcome: `REJECTED_WORDING (${problem})` }); continue; }
    let next = original;
    [...copied].map((p, i) => ({ ...p, text: rewritten[i] })).sort((a, b) => b.start - a.start).forEach((p) => { next = next.slice(0, p.start) + encode(p.text) + next.slice(p.end); });
    const after = sharedShare(editablePassages(next).map((p) => p.text), liveRuns);
    if (after > MAX_SHARED) { results.push({ ...record, after, outcome: 'REJECTED_STILL_COPIED' }); continue; }
    // The release step needs a distinct 120-160 character description from these
    // passages; a rewrite it could not use would only move the hold.
    const fitted = lib.fitDescription(lib.pagePassages(next));
    if (!fitted || [...lib.shinglesOf(fitted)].some((r) => liveRuns.has(r))) { results.push({ ...record, after, outcome: 'REJECTED_NO_DESCRIPTION' }); continue; }
    fs.writeFileSync(file, next);
    const analysis = analyzeResourceHtml(file);
    if (!analysis.safe || analysis.blocked) {
      fs.writeFileSync(file, original);
      results.push({ ...record, after, outcome: 'REJECTED_UNSAFE', findings: analysis.findings.map((f) => f.code) });
      continue;
    }
    results.push({ ...record, after, outcome: 'REDRAFTED', passages: copied.length });
  }

  const at = now.toISOString();
  const log = loadLog(root);
  log.items.push(...results.filter((r) => r.outcome !== 'NOT_COPIED').map((r) => ({ ...r, at })));
  log.items = log.items.slice(-LOG_KEEP);
  fs.writeFileSync(path.join(root, LOG_PATH), `${JSON.stringify(log, null, 2)}\n`);
  return { examined, candidates: candidates.length, results, stop };
}

function annotate(line) {
  console.log(line);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Resources redraft lane::${line.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
}

async function main() {
  const root = process.cwd();
  const state = fs.existsSync(path.join(root, 'data/autonomy/state.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'data/autonomy/state.json'), 'utf8')) : {};
  if (state.paused || state.emergencyStop) { console.log('Redraft lane: the site is paused or stopped; nothing redrafted.'); return; }
  const { freeChat } = await import('../llm/free_router.mjs');
  const require2 = createRequire(import.meta.url);
  const { loadApprovedIds } = require2('./process_manifest.js');
  const approved = loadApprovedIds();
  const cfgPath = path.join(root, 'search-loop.config.json');
  const voice = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')).voice || '' : '';
  const clock = process.env.PUBLISH_CLOCK ? new Date(process.env.PUBLISH_CLOCK) : new Date();
  // The repo's free router: $0/$0 models only, provider.max_price 0, cost read back.
  const chat = async (messages) => {
    const r = await freeChat({ messages, max_tokens: 2500, temperature: 0.5, purpose: 'redraft copied Resources passages' });
    return r.ok ? { ok: true, answer: r.content, model: r.model } : { ok: false, stop: r.stop, reason: r.receipt?.stop_detail || '' };
  };
  const max = Number(process.env.REDRAFT_MAX || DEFAULT_MAX_ITEMS);
  const out = await redraftHeld({ root, chat, isApproved: (item) => approved.has(item.id), now: clock, max, voice });
  for (const r of out.results.filter((x) => x.outcome !== 'NOT_COPIED')) console.log(`redraft ${r.id}: ${r.outcome}${r.model ? ` (${r.model})` : ''}; shared with live ${Math.round(r.before * 100)}%${r.after != null ? ` -> ${Math.round(r.after * 100)}%` : ''}`);
  if (out.stop) annotate(`NAMED STOP: ${out.stop.stop || 'NO_FREE_MODEL'} ${out.stop.reason || ''} Copied drafts stay held; the next run retries.`);
  const done = out.results.filter((r) => r.outcome === 'REDRAFTED').length;
  console.log(`Redraft lane: ${out.candidates} approved unpublished Resources item(s) due within ${LOOKAHEAD_DAYS} days, ${out.examined} examined, ${done} redrafted.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => { annotate(`NAMED STOP: REDRAFT_FAILED ${error.message}`); });
}
