#!/usr/bin/env node
// Calendar slot writer: replaces the queued, template-cloned Resources drafts with
// material written by the shared search-loop engine's writer, slot for slot.
//
// Owner ruling, 3 Nov 2026 (Hicks): keep the calendar exactly (same slots, release
// time, sections and URLs; the approved titles stay). Each post answers its own
// question in page shape: answer first, question headings, an FAQ with FAQPage
// schema, sources specific to the post, Monika Hicks, LCSW as the byline, the real
// publish date. Under 30% of its text may be shared with any live page.
//
// It replaces scripts/publishing/redraft_held.mjs (which only reworded copied
// passages of the clones, and could not change what the clones were).
//
// What it does: picks approved, unpublished /resources/ slots due within
// LOOKAHEAD_DAYS (or every one with --all) that the engine has not written yet,
// asks the engine (src/slot.mjs draftSlot, free model lanes only) for the material,
// feeds this repo's own duplicate check back into the engine's fix loop, renders
// the page with the site's own renderer, runs the publisher's safety analysis, and
// only then replaces the queued page. A rejected slot keeps its old page (which the
// release gate keeps holding) and is logged.
//
// It also links each live /questions/ page from one related calendar post (none is
// orphaned) and writes data/search-loop/reserved-titles.json, the calendar titles
// the question lane must not duplicate (engine `reserved_titles`).
//
// Never touches a published page: a slot must be unpublished in the manifest AND
// absent from the live sitemap.
//
// Usage: node scripts/publishing/write_calendar_slots.mjs [--all] [--max N] [--dry-run <dir>] [--reserved-only]
// Engine: SEARCH_LOOP_ENGINE_DIR (default .search-loop-engine), a checkout of seq23/search-loop >= v1.3.1.
// Named stops (exit 0; printed and annotated; the next run retries): ENGINE_MISSING,
// the engine's FREE_MODEL_KEY_MISSING / NO_FREE_MODEL, WRITER_TIME_BUDGET.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { renderResourceHtml } from '../autonomy/lib/render_resource.mjs';
import { analyzeResourceHtml } from '../autonomy/lib/self_heal.mjs';

const require = createRequire(import.meta.url);
const lib = require('../lib/search_metadata.js');

export const MAX_SHARED_WITH_ANY = 0.30;
export const LOOKAHEAD_DAYS = 10;
export const DEFAULT_MAX = 4;
export const WORDS = { insights: [800, 1200], articles: [1000, 1500], guides: [1500, 2200], 'white-papers': [1800, 2500] };
const KIND = { insights: 'insight', articles: 'article', guides: 'guide', 'white-papers': 'white paper' };
export const DRAFT_DIR = 'data/editorial/engine_drafts';
const LOG_PATH = 'data/editorial/engine_writer_log.json';
export const RESERVED_PATH = 'data/search-loop/reserved-titles.json';

const STOP = new Set('a an and are as at be but by can do does for from how i if in into is it its of on or that the their them they this to what when where which who why with you your women woman'.split(' '));
const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|es|s)$/, '')));
export function overlap(a, b) {
  const x = words(a); const y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0; for (const w of x) if (y.has(w)) n += 1;
  return n / Math.min(x.size, y.size);
}

export const routeOf = (item) => item.publicPath || item.slug;
export function fileFor(root, route) {
  const clean = String(route).replace(/^\/+|\/+$/g, '');
  return clean.startsWith('questions/') ? path.join(root, clean, 'index.html') : path.join(root, 'pages', clean, 'index.html');
}

function passagesOf(html) {
  const p = lib.pagePassages(html);
  if (p.length) return p;
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  return [lib.stripTags(main)];
}
export function runsOf(passages) {
  const all = new Set();
  for (const p of passages) for (const r of lib.shinglesOf(p)) all.add(r);
  return all;
}

/** Every live page: route -> { runs, title, h2s, hrefs, html }. */
export function readLive(root, manifest) {
  const sitemap = fs.existsSync(path.join(root, 'sitemap.xml')) ? fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8') : '';
  const routes = new Set([...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]));
  for (const item of manifest) if (item.status === 'published') routes.add(routeOf(item));
  const live = new Map();
  for (const route of routes) {
    const file = fileFor(root, route);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    live.set(route, {
      route, html,
      runs: runsOf(passagesOf(html)),
      title: lib.stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ''),
      h2s: [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => lib.stripTags(m[1]).trim()).filter(Boolean),
      hrefs: [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]).filter((u) => !/hicksconsulting\.org|clientsecure\.me/.test(u)),
      internal: new Set([...html.matchAll(/href="(\/[^"#?]*)"/gi)].map((m) => m[1])),
    });
  }
  return live;
}

/** Headings and sources that already repeat across live Resources pages: the engine is told to avoid them. */
export function avoidList(live) {
  const count = (list) => { const m = new Map(); for (const x of list) m.set(x, (m.get(x) || 0) + 1); return m; };
  const res = [...live.values()].filter((p) => p.route.startsWith('/resources/'));
  const heads = count(res.flatMap((p) => [...new Set(p.h2s)]));
  const srcs = count(res.flatMap((p) => [...new Set(p.hrefs)]));
  return {
    headings: [...heads].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 40),
    sources: [...srcs].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 20),
  };
}

/** Share of the page's 8-word runs found on each live page; the largest, and where. */
export function sharedWithLive(html, live, selfRoute) {
  const runs = runsOf(passagesOf(html));
  let max = 0; let where = null; const hits = new Map();
  if (!runs.size) return { max: 1, where: 'no text', phrases: [] };
  for (const p of live.values()) {
    if (p.route === selfRoute) continue;
    let n = 0;
    for (const r of runs) if (p.runs.has(r)) { n += 1; if (hits.size < 40) hits.set(r, p.route); }
    const share = n / runs.size;
    if (share > max) { max = share; where = p.route; }
  }
  return { max, where, phrases: [...hits.keys()] };
}

export const CALLOUT = 'Reading is not therapy. If you are in crisis or thinking about harming yourself, call or text 988, the Suicide and Crisis Lifeline, at any time.';

export function toSiteDraft(item, d, links) {
  return {
    title: d.h1 || item.title,
    titleLead: d.title_lead || null,
    callout: CALLOUT,
    description: d.meta_description,
    shortAnswer: d.direct_answer,
    sections: d.sections.map((s) => ({ heading: s.heading, body: s.paragraphs.join('\n\n'), bullets: s.bullets || [] })),
    faq: d.faq,
    sources: (d.facts || []).filter((f) => f.verified).map((f) => ({ url: f.source_url, title: f.source_name ? `${f.source_name}: ${f.claim}` : f.claim })),
    internalLinks: links,
    relatedHeading: 'Related reading and sources',
  };
}

/** /questions/ pages to link from this slot: the best match, and an orphan if one is waiting. */
export function questionLinks(item, live, linkedQuestions) {
  const qs = [...live.values()].filter((p) => p.route.startsWith('/questions/') && p.route !== '/questions/');
  const scored = qs.map((p) => ({ p, s: overlap(item.title, p.title) })).sort((a, b) => b.s - a.s);
  const out = scored.filter((x) => x.s >= 0.34).slice(0, 2).map((x) => x.p);
  const orphan = scored.find((x) => !linkedQuestions.has(x.p.route) && !out.includes(x.p));
  if (orphan && out.length < 2) out.push(orphan.p);
  for (const p of out) linkedQuestions.add(p.route);
  return out.map((p) => ({ href: p.route, title: p.title }));
}

/** Question pages already linked from a Resources page that is live or written by this lane. */
export function linkedQuestionsOf(root, live, manifest) {
  const linked = new Set();
  for (const p of live.values()) if (p.route.startsWith('/resources/')) for (const h of p.internal) if (h.startsWith('/questions/') && h !== '/questions/') linked.add(h);
  for (const item of manifest) {
    if (!item.engineDraft || item.status === 'published') continue;
    const f = fileFor(root, routeOf(item));
    if (!fs.existsSync(f)) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/href="(\/questions\/[^"#?]+)"/g)) linked.add(m[1]);
  }
  return linked;
}

/** Sibling slots share an approved base title ("Base: Angle"); each gets its own angle and search question. */
export const GENERIC_ANGLES = new Set(['what this looks like in real life', 'why women minimize it', 'how it shows up in work and relationships', 'a gentler truth to consider', 'next-step reflection']);
export const baseOf = (title) => (String(title).includes(':') ? String(title).split(':')[0].trim() : null);
export function siblingsOf(item, manifest) {
  const base = baseOf(item.title);
  if (!base) return { base: null, siblings: [] };
  const siblings = manifest.filter((x) => x !== item && x.status !== 'revoked' && baseOf(x.title) === base).map((x) => x.title);
  return { base, siblings };
}

/**
 * A sibling that took its own angle keeps every title rule whole: the legacy title ledger names the
 * new title in place of the approved one (it never grows), and the new title gets its whole-phrase
 * short form for <title> (data/search/title_short_forms.json), from the engine's title_lead.
 * The old title's own short form is dropped whenever no remaining title still carries it, even
 * when the new title needs no short form of its own: a short form left keyed to a title no page
 * carries is a STALE SHORT FORM hard fail (Content Publish, 5 Nov 2026, run 42043953958, when
 * daily-026-4 was retitled to a title that already fit). `titlesInUse` are the other manifest
 * titles after the change.
 */
export function recordTitleChange(root, from, to, lead, titlesInUse = []) {
  const ledgerFile = path.join(root, 'data/admin/legacy_title_grandfather.json');
  if (fs.existsSync(ledgerFile)) {
    const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    const i = (ledger.titles || []).indexOf(from);
    if (i >= 0) { ledger.titles[i] = to; fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + '\n'); }
  }
  const formsFile = path.join(root, 'data/search/title_short_forms.json');
  if (fs.existsSync(formsFile)) {
    const forms = JSON.parse(fs.readFileSync(formsFile, 'utf8'));
    const before = JSON.stringify(forms);
    const needsLead = lead && !lib.searchTitle(to);
    const stillUsed = [to, ...titlesInUse].some((t) => t === from || String(t).startsWith(`${from}: `));
    if (Object.prototype.hasOwnProperty.call(forms.titles, from) && !stillUsed) delete forms.titles[from];
    if (needsLead) forms.titles[to] = lead;
    if (JSON.stringify(forms) !== before) fs.writeFileSync(formsFile, JSON.stringify(forms, null, 2) + '\n');
  }
}

export function reservedTitles(manifest) {
  return manifest
    .filter((item) => item.status === 'approved' && String(routeOf(item)).startsWith('/resources/'))
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
    .map((item) => ({ route: routeOf(item), title: item.title, scheduledAt: item.scheduledAt }));
}

function named(line) {
  console.log(`\n${line}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Calendar writer::${line.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
}

export async function writeSlots({ root = process.cwd(), engine, cfg, now = new Date(), all = false, max = DEFAULT_MAX, dryRunDir = null, chat, fetchImpl, budgetMs = 20 * 60000, log = console.log }) {
  const started = Date.now();
  const manifestPath = path.join(root, 'data/admin/content_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const live = readLive(root, manifest);
  const avoid = avoidList(live);
  const linkedQuestions = linkedQuestionsOf(root, live, manifest);
  // Every <title> already on a live or engine-written page: a new one must differ.
  const takenTitles = new Set([...live.values()].map((p) => lib.stripTags((p.html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').toLowerCase()).filter(Boolean));
  for (const x of manifest) if (x.engineDraft && fs.existsSync(fileFor(root, routeOf(x)))) takenTitles.add(lib.stripTags((fs.readFileSync(fileFor(root, routeOf(x)), 'utf8').match(/<title>([^<]*)<\/title>/i) || [])[1] || '').toLowerCase());
  const horizon = now.valueOf() + LOOKAHEAD_DAYS * 86400000;
  const slots = manifest
    .filter((item) => item.status === 'approved' && item.scheduledAt && (all || Date.parse(item.scheduledAt) <= horizon))
    .filter((item) => String(routeOf(item)).startsWith('/resources/') && !live.has(routeOf(item)))
    // Not yet written, or written but still held a day past its slot (the release gate refused it): rewrite, at most 3 times.
    .filter((item) => !item.engineDraft || (Date.parse(item.scheduledAt) < now.valueOf() - 86400000 && Date.parse(item.engineDraft.writtenAt) < now.valueOf() - 6 * 3600000 && (item.engineDraft.rewrites || 0) < 3))
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
    .slice(0, max);
  const results = [];
  let stop = null;
  for (const item of slots) {
    if (Date.now() - started > budgetMs) { stop = { stop: 'WRITER_TIME_BUDGET', reason: `the ${Math.round(budgetMs / 60000)}-minute budget is used; the rest wait for the next run` }; break; }
    const route = routeOf(item);
    const type = item.contentType || 'insights';
    const links = questionLinks(item, live, linkedQuestions);
    const related = [...live.values()].filter((p) => p.route.startsWith('/resources/') && overlap(item.title, p.title) >= 0.34).slice(0, 4).map((p) => p.title);
    let html = null; let shared = null;
    const sib = siblingsOf(item, manifest);
    const check = (d) => {
      // Sibling slots carry a calendar template suffix ("Next-Step Reflection"); each gets a specific angle instead.
      if (sib.base && GENERIC_ANGLES.has(String(d.angle || '').toLowerCase().trim())) return [`"${d.angle}" is the calendar's generic suffix; give this piece a specific angle of its own (for example "The Signs in Your Body" or "What to Do the Day It Happens"), different from every sibling`];
      try { html = renderResourceHtml({ draft: toSiteDraft(item, d, links), route, contentType: type, scheduledAt: item.scheduledAt }); } catch (e) { return [`the page could not be rendered: ${e.message}`]; }
      const tabTitle = lib.stripTags((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '');
      if (takenTitles.has(tabTitle.toLowerCase())) return [`the browser-tab title "${tabTitle}" is already another page's; give a different "title_lead"`];
      shared = sharedWithLive(html, live, route);
      // The release gate needs a whole-sentence description that repeats no live text (SEARCH_METADATA_UNRESOLVED otherwise).
      const fitted = lib.fitDescription(lib.pagePassages(html));
      if (!fitted) return ['no 120-160 character whole-sentence description can be drawn from the page; make "meta_description" and the opening answer whole sentences of that length'];
      const liveRuns = new Set(); for (const p of live.values()) if (p.route !== route) for (const r of p.runs) liveRuns.add(r);
      const copiedDesc = [...lib.shinglesOf(fitted)].filter((r) => liveRuns.has(r));
      if (copiedDesc.length) return [`the description "${fitted}" repeats wording already on the site (${copiedDesc.slice(0, 3).map((r) => `"${r}"`).join(', ')}); write it in new words`];
      if (shared.max >= MAX_SHARED_WITH_ANY) return [`${Math.round(shared.max * 100)}% of the text is already on ${shared.where}; it must be under ${MAX_SHARED_WITH_ANY * 100}% with every live page. Never reuse these phrases: ${shared.phrases.slice(0, 25).map((p) => `"${p}"`).join(', ')}`];
      return [];
    };
    // A generic calendar suffix is not an angle to stay close to: the engine sees the base alone.
    const suffix = sib.base ? String(item.title).slice(sib.base.length).replace(/^[:\s]+/, '').toLowerCase().trim() : '';
    const r = await engine.draftSlot(cfg, { title: sib.base && GENERIC_ANGLES.has(suffix) ? sib.base : item.title, ...(sib.base ? sib : {}), question: sib.base && GENERIC_ANGLES.has(suffix) ? sib.base : item.title, kind: KIND[type] || 'insight', words: WORDS[type] || WORDS.insights, avoid, related }, { check, ...(chat ? { chat } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
    if (!r.ok && ['FREE_MODEL_KEY_MISSING', 'FREE_MODEL_KEY_REFUSED', 'NO_FREE_MODEL', 'MODEL_TIME_BUDGET'].includes(r.stop)) { stop = r; break; }
    const record = { id: item.id, route, scheduledAt: item.scheduledAt, at: now.toISOString(), model: r.model || null };
    if (!r.ok) { results.push({ ...record, outcome: r.stop, reason: String(r.reason || '').slice(0, 300) }); log(`REJECTED ${item.id}: ${r.stop} ${String(r.reason || '').slice(0, 160)}`); continue; }
    const out = { ...record, outcome: 'WRITTEN', words: r.words, maxShared: Math.round(shared.max * 1000) / 1000, sharedWith: shared.where, questionLinks: links.map((l) => l.href), title: r.draft.h1 || item.title, approvedTitle: item.title, firstSentences: r.draft.direct_answer.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ') };
    if (dryRunDir) {
      fs.mkdirSync(dryRunDir, { recursive: true });
      fs.writeFileSync(path.join(dryRunDir, `${item.id}.html`), html);
      fs.writeFileSync(path.join(dryRunDir, `${item.id}.json`), JSON.stringify({ ...out, draft: r.draft }, null, 2));
      results.push(out); log(`DRY-RUN ${item.id}: ${r.words} words, ${Math.round(shared.max * 100)}% max shared (${shared.where})`);
      continue;
    }
    const file = fileFor(root, route);
    const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
    const analysis = analyzeResourceHtml(file);
    if (!analysis.safe || analysis.blocked) {
      if (original === null) fs.rmSync(file); else fs.writeFileSync(file, original);
      results.push({ ...out, outcome: 'REJECTED_UNSAFE', findings: analysis.findings.map((f) => f.code) });
      log(`REJECTED_UNSAFE ${item.id}: ${analysis.findings.map((f) => f.code).join(', ')}`);
      continue;
    }
    const draftFile = path.join(DRAFT_DIR, `${item.id}.json`);
    fs.mkdirSync(path.join(root, DRAFT_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, draftFile), JSON.stringify({ id: item.id, route, contentType: type, draft: toSiteDraft(item, r.draft, links), engine: r.draft }, null, 2) + '\n');
    if (r.draft.h1 && r.draft.h1 !== item.title) { recordTitleChange(root, item.title, r.draft.h1, r.draft.title_lead, manifest.filter((x) => x !== item && x.status !== 'revoked').map((x) => x.title)); item.approvedTitle ||= item.title; item.title = r.draft.h1; }
    takenTitles.add(lib.stripTags((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').toLowerCase());
    const rewrites = item.engineDraft ? (item.engineDraft.rewrites || 0) + 1 : 0;
    item.engineDraft = { rewrites, writtenAt: now.toISOString(), model: r.model, words: r.words, maxShared: out.maxShared, draftFile, question: r.draft.question || item.title };
    results.push(out);
    log(`WRITTEN ${item.id}: ${r.words} words, ${Math.round(shared.max * 100)}% max shared (${shared.where})`);
  }
  if (!dryRunDir) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const logFile = path.join(root, LOG_PATH);
    const prev = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : { schemaVersion: '1.0.0', note: 'Written by scripts/publishing/write_calendar_slots.mjs.', items: [] };
    prev.items = [...prev.items, ...results].slice(-300);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, JSON.stringify(prev, null, 2) + '\n');
  }
  return { examined: slots.length, results, stop };
}

export function writeReserved(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/admin/content_manifest.json'), 'utf8'));
  const list = reservedTitles(manifest);
  fs.mkdirSync(path.join(root, path.dirname(RESERVED_PATH)), { recursive: true });
  fs.writeFileSync(path.join(root, RESERVED_PATH), JSON.stringify(list, null, 2) + '\n');
  return list.length;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const root = process.cwd();
  const n = writeReserved(root);
  console.log(`reserved titles for the question lane: ${n} (${RESERVED_PATH})`);
  if (argv.includes('--reserved-only')) return;
  const dir = path.resolve(root, process.env.SEARCH_LOOP_ENGINE_DIR || '.search-loop-engine');
  if (!fs.existsSync(path.join(dir, 'src', 'slot.mjs'))) { named(`NAMED STOP: ENGINE_MISSING no search-loop engine >= v1.3.1 at ${dir} (src/slot.mjs); the queued pages stay as they are and the release gate keeps holding copies.`); return; }
  const engine = await import(pathToFileURL(path.join(dir, 'src', 'slot.mjs')).href);
  const { loadConfig } = await import(pathToFileURL(path.join(dir, 'src', 'config.mjs')).href);
  const { cfg, problems } = loadConfig('search-loop.config.json', root);
  if (problems.length) throw new Error(`search-loop.config.json: ${problems.join('; ')}`);
  const r = await writeSlots({ root, engine, cfg, all: argv.includes('--all'), max: Number(opt('--max')) || DEFAULT_MAX, dryRunDir: opt('--dry-run') });
  const written = r.results.filter((x) => x.outcome === 'WRITTEN').length;
  console.log(JSON.stringify({ examined: r.examined, written, rejected: r.results.length - written, stop: r.stop?.stop || null }, null, 2));
  if (r.stop) named(`NAMED STOP: ${r.stop.stop} ${String(r.stop.reason || '').slice(0, 300)} — written ${written}; the rest wait for the next run.`);
  if (!r.examined) console.log('Nothing to write: every slot in the window is already engine-written or published.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
