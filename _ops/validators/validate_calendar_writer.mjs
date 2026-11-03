// Guard for scripts/publishing/write_calendar_slots.mjs (owner ruling 3 Nov 2026: every queued
// calendar post is written by the shared search-loop engine's writer, slot for slot, at under 30%
// shared with any live page). Replaces the redraft-lane guard (redraft_held.mjs is retired).
//
// Runs the real writer on a fixture built from real pages - a live insight, a queued sibling that
// copies it (daily-017-4 / daily-024-4), an approved record whose route is already live
// (daily-017-5) and a live /questions/ page - with a stub engine whose drafts go through the
// writer's own check, and proves:
//   1. a draft that copies a live page is refused and the queued page is left byte-for-byte;
//   2. a distinct draft is written in page shape: answer first, the 988 note in its own callout,
//      question headings, a visible FAQ and one FAQPage block, Monika Hicks, LCSW as the byline
//      with Person schema, under 30% shared with every live page, the route unchanged and the
//      manifest marked engine-written; and the live question page is linked from it;
//   3. a published page, and an approved record whose route is already live, are never touched;
//   4. at release the date shown is the release day, not the (overdue) slot date.
// Hard-fails if the fixture examines no item (rule 0).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSlots, MAX_SHARED_WITH_ANY, sharedWithLive, readLive, CALLOUT } from '../../scripts/publishing/write_calendar_slots.mjs';
import { createRequire } from 'node:module';
import { renderResourceHtml } from '../../scripts/autonomy/lib/render_resource.mjs';

const lib = createRequire(import.meta.url)('../../scripts/lib/search_metadata.js');
const ROOT = process.cwd();
const errors = [];
const fail = (msg) => errors.push(msg);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/admin/content_manifest.json'), 'utf8'));
const byId = (id) => manifest.find((x) => x.id === id);
const LIVE = byId('daily-017-4'); const COPY = byId('daily-024-4'); const TWIN = byId('daily-017-5');
const QROUTE = '/questions/find-a-black-therapist/';
const fatal = (m) => { console.log('VALIDATION_FINDING check=calendar-writer'); console.error(`HARD FAIL  calendar-writer: ${m}`); process.exit(1); };
if (!LIVE || !COPY || !TWIN) fatal('fixture items daily-017-4 / daily-017-5 / daily-024-4 are missing from the manifest');
if (!fs.existsSync(path.join(ROOT, 'questions/find-a-black-therapist/index.html'))) fatal(`fixture question page ${QROUTE} is missing`);
const route = (item) => item.publicPath || item.slug;
const src = (item) => path.join(ROOT, 'pages', route(item).replace(/^\/+|\/+$/g, ''), 'index.html');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-writer-'));
  const put = (rel, html) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
  const page = (item) => path.join('pages', route(item).replace(/^\/+|\/+$/g, ''), 'index.html');
  const liveHtml = fs.readFileSync(src(LIVE), 'utf8'); const copyHtml = fs.readFileSync(src(COPY), 'utf8');
  put(page(LIVE), liveHtml); put(page(COPY), copyHtml); put(page(TWIN), copyHtml.split(route(COPY)).join(route(TWIN)));
  put('questions/find-a-black-therapist/index.html', fs.readFileSync(path.join(ROOT, 'questions/find-a-black-therapist/index.html'), 'utf8'));
  const due = '2026-10-20T13:00:00.000Z';
  put('data/admin/content_manifest.json', JSON.stringify([{ ...LIVE, status: 'published' }, { ...COPY, status: 'approved', validationPassed: true, scheduledAt: due }, { ...TWIN, status: 'approved', validationPassed: true, scheduledAt: due }]));
  put('sitemap.xml', `<urlset>${[route(LIVE), route(TWIN), QROUTE].map((r) => `<url><loc>https://www.hicksconsulting.org${r}</loc></url>`).join('')}</urlset>`);
  const read = (item) => fs.readFileSync(path.join(dir, page(item)), 'utf8');
  return { dir, liveHtml, copyHtml, read };
}

let counter = 1000;
const letters = (n) => { let s = ''; n += 1; while (n > 0) { s = String.fromCharCode(97 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
const fresh = (n) => Array.from({ length: n }, () => `vo${letters(counter++)}q`).join(' ');
const distinctDraft = () => ({
  h1: `${COPY.title.split(':')[0]}: The Quiet Signs at Work`, angle: 'The Quiet Signs at Work', title_lead: 'Good-Season Boundaries: Quiet Signs', question: 'what are the quiet signs at work?',
  meta_description: `Quiet signs like ${fresh(3)} matter at work and at home; noticing them early helps you choose support sooner, with less pressure.`,
  direct_answer: `The quiet signs are ${fresh(5)} and small shifts in how you work and rest. They show up early, in sleep, in tone, and in how you answer messages. ${fresh(20)}.`,
  sections: [1, 2, 3, 4].map((i) => ({ heading: `What does sign ${letters(counter++)} look like at work?`, paragraphs: [`Signal ${fresh(80)}.`, `Pattern ${fresh(70)}.`] })),
  faq: [1, 2, 3, 4].map(() => ({ q: `Is ${fresh(5)} normal?`, a: `Often ${fresh(45)}.` })),
  facts: [{ claim: 'The 988 Lifeline answers calls and texts at any time.', source_url: 'https://988lifeline.org/', source_name: '988 Lifeline', verified: true }],
});
const engineWith = (make) => ({ draftSlot: async (cfg, slot, { check }) => { const d = make(); const problems = await check(d); return problems.length ? { ok: false, stop: 'SLOT_DRAFT_REJECTED', reason: problems.join('; '), model: 'stub' } : { ok: true, draft: d, model: 'stub', words: 1000, attempts: 1 }; } });

async function run(make) {
  const fx = fixture();
  const out = await writeSlots({ root: fx.dir, engine: engineWith(make), cfg: {}, now: new Date('2026-11-03T13:00:00Z'), log: () => {} });
  const m = JSON.parse(fs.readFileSync(path.join(fx.dir, 'data/admin/content_manifest.json'), 'utf8'));
  return { out, fx, m, after: { live: fx.read(LIVE), copy: fx.read(COPY), twin: fx.read(TWIN) } };
}
const outcomeOf = (out, item) => (out.results.find((r) => r.id === item.id) || {}).outcome;
let examined = 0;

// 1. A draft that copies the live page.
{
  const liveText = lib.pagePassages(fs.readFileSync(src(LIVE), 'utf8')).join(' ');
  const { out, fx, after } = await run(() => { const d = distinctDraft(); d.sections = d.sections.map((s) => ({ ...s, paragraphs: [liveText] })); return d; });
  examined += out.examined;
  if (outcomeOf(out, COPY) !== 'SLOT_DRAFT_REJECTED') fail(`a draft copying a live page was not refused (outcome ${outcomeOf(out, COPY)})`);
  if (after.copy !== fx.copyHtml) fail('a refused draft changed the queued page');
  if (after.live !== fx.liveHtml) fail('the published page changed');
}
// 2-3. A distinct draft.
{
  const { out, fx, m, after } = await run(distinctDraft);
  examined += out.examined;
  if (outcomeOf(out, COPY) !== 'WRITTEN') fail(`a distinct draft was not written (outcome ${outcomeOf(out, COPY)}: ${(out.results.find((r) => r.id === COPY.id) || {}).reason})`);
  const html = after.copy;
  const answerAt = html.indexOf('class="short-answer"'); const calloutAt = html.indexOf('resource-callout');
  if (!(answerAt > 0 && calloutAt > answerAt) || !html.includes(CALLOUT.slice(0, 40))) fail('the 988 note is not in its own callout right after the answer');
  if (/988/.test((html.match(/class="short-answer">([^<]*)</) || [])[1] || '')) fail('the answer itself carries the crisis line');
  if (!/Author: Monika Hicks, LCSW/.test(html) || !/"author":\{"@type":"Person","name":"Monika Hicks, LCSW"/.test(html)) fail('no visible byline with Person schema');
  if ((html.match(/"@type":"FAQPage"/g) || []).length !== 1 || !/<h2>Frequently asked questions<\/h2>/.test(html)) fail('no visible FAQ with exactly one FAQPage block');
  if (!/<h2>What does sign [a-z]+ look like at work\?<\/h2>/.test(html)) fail('question headings did not reach the page');
  if (!html.includes(`href="${QROUTE}"`)) fail('the live question page is not linked from the written post');
  const shared = sharedWithLive(html, readLive(fx.dir, m), route(COPY));
  if (shared.max >= MAX_SHARED_WITH_ANY) fail(`written page shares ${shared.max} with ${shared.where}`);
  const rec = m.find((x) => x.id === COPY.id);
  if (!rec.engineDraft || route(rec) !== route(COPY) || rec.title !== distinctDraft().h1 || rec.approvedTitle !== COPY.title) fail('manifest not marked engine-written with the sibling angle (route unchanged, approved title kept)');
  if (after.live !== fx.liveHtml) fail('the published page changed');
  if (after.twin !== fx.copyHtml.split(route(COPY)).join(route(TWIN))) fail('an approved record whose route is already live was rewritten');
  if (out.results.some((r) => r.id === LIVE.id || r.id === TWIN.id)) fail('a live route was considered for writing');
  // 4. Release date.
  if (rec.engineDraft) {
  const stored = JSON.parse(fs.readFileSync(path.join(fx.dir, rec.engineDraft.draftFile), 'utf8'));
  const released = renderResourceHtml({ draft: stored.draft, route: route(COPY), contentType: rec.contentType, scheduledAt: rec.scheduledAt, publishedAt: new Date('2026-11-04T13:17:00Z') });
  if (!/<time datetime="2026-11-04">/.test(released) || /datePublished":"2026-10-20/.test(released)) fail('a release shows the overdue slot date instead of the release day');
  }
  fs.rmSync(fx.dir, { recursive: true, force: true });
}
if (!examined) fail('examined-no-items -- the writer picked nothing from the fixture, so this check proves nothing');
if (errors.length) { console.log('VALIDATION_FINDING check=calendar-writer'); console.error(`HARD FAIL  calendar-writer (${errors.length})`); for (const e of errors) console.error(`  ${e}`); process.exit(1); }
console.log(`Calendar writer OK (${examined} fixture item(s): a copied draft refused with the page untouched; a distinct draft written in page shape under ${MAX_SHARED_WITH_ANY * 100}% shared, byline, FAQPage, 988 callout, question link; live routes untouched; release shows the release day).`);
