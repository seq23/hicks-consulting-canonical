// Guard for scripts/publishing/redraft_held.mjs (owner ruling 3 Nov 2026:
// Resources posts publish automatically; every quality gate stays).
//
// Runs the real lane on a fixture built from two real pages - a live insight and
// the queued sibling that copies it (daily-017-4 / daily-024-4, the first slot the
// copy hold took, 15 Oct 2026) - with a stubbed model, and proves:
//   1. a rewrite that still copies live text is refused and the page is left
//      byte-for-byte as it was;
//   2. a rewrite that breaks the wording rules (first person) is refused;
//   3. a distinct, clean rewrite is written, and afterwards none of its passages
//      shares an 8-word run with the live page;
//   4. a published page, and an unpublished record whose route is already live,
//      are never touched in any case.
// Hard-fails if the fixture examines no item (rule 0).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { redraftHeld } from '../../scripts/publishing/redraft_held.mjs';

const require = createRequire(import.meta.url);
const lib = require('../../scripts/lib/search_metadata.js');
const ROOT = process.cwd();
const errors = [];
const fail = (msg) => errors.push(msg);

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/admin/content_manifest.json'), 'utf8'));
const byId = (id) => manifest.find((x) => x.id === id);
const LIVE = byId('daily-017-4');
const COPY = byId('daily-024-4');
const TWIN = byId('daily-017-5');
if (!LIVE || !COPY || !TWIN) {
  console.log('VALIDATION_FINDING check=redraft-lane');
  console.error('HARD FAIL  redraft-lane: fixture source items daily-017-4 / daily-017-5 / daily-024-4 are missing from the manifest');
  process.exit(1);
}
const route = (item) => item.publicPath || item.slug;
const src = (item) => path.join(ROOT, 'pages', route(item).replace(/^\/+|\/+$/g, ''), 'index.html');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-redraft-'));
  const put = (item, html) => {
    const f = path.join(dir, 'pages', route(item).replace(/^\/+|\/+$/g, ''), 'index.html');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, html);
  };
  const liveHtml = fs.readFileSync(src(LIVE), 'utf8');
  const copyHtml = fs.readFileSync(src(COPY), 'utf8');
  put(LIVE, liveHtml);
  put(COPY, copyHtml);
  // TWIN: an approved record whose route is already in the live sitemap. Its
  // page carries the copied body too, so only the "route is live" rule stops it.
  put(TWIN, copyHtml.split(route(COPY)).join(route(TWIN)));
  fs.mkdirSync(path.join(dir, 'data/admin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data/autonomy'), { recursive: true });
  const due = '2026-11-02T13:00:00.000Z';
  fs.writeFileSync(path.join(dir, 'data/admin/content_manifest.json'), JSON.stringify([
    { ...LIVE, status: 'published' },
    { ...COPY, status: 'approved', validationPassed: true, scheduledAt: due },
    { ...TWIN, status: 'approved', validationPassed: true, scheduledAt: due },
  ]));
  fs.writeFileSync(path.join(dir, 'sitemap.xml'), `<urlset><url><loc>https://www.hicksconsulting.org${route(LIVE)}</loc></url><url><loc>https://www.hicksconsulting.org${route(TWIN)}</loc></url></urlset>`);
  return { dir, liveHtml, copyHtml, file: (item) => path.join(dir, 'pages', route(item).replace(/^\/+|\/+$/g, ''), 'index.html') };
}

const letters = (n) => { let s = ''; n += 1; while (n > 0) { s = String.fromCharCode(97 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
let counter = 1000;
const distinctPassage = () => `Quiet ${Array.from({ length: 18 }, () => `vo${letters(counter++)}q`).join(' ')} matters here.`;
const ask = (messages) => JSON.parse(messages[1].content).passages;

async function run(stub) {
  const fx = fixture();
  try {
    const out = await redraftHeld({ root: fx.dir, now: new Date('2026-11-03T13:17:00Z'), isApproved: () => true, chat: async (m) => ({ ok: true, model: 'stub', answer: JSON.stringify({ passages: stub(ask(m), fx) }) }) });
    const after = { live: fs.readFileSync(fx.file(LIVE), 'utf8'), copy: fs.readFileSync(fx.file(COPY), 'utf8'), twin: fs.readFileSync(fx.file(TWIN), 'utf8') };
    return { out, fx, after };
  } finally {
    setTimeout(() => fs.rmSync(fx.dir, { recursive: true, force: true }), 0);
  }
}

const outcomeOf = (out, item) => (out.results.find((r) => r.id === item.id) || {}).outcome;
let examined = 0;

// 1. A "rewrite" that hands back live text.
{
  const liveText = lib.pagePassages(fs.readFileSync(src(LIVE), 'utf8'));
  const { out, fx, after } = await run((ps) => ps.map((_, i) => liveText[i % liveText.length]));
  examined += out.examined;
  if (outcomeOf(out, COPY) !== 'REJECTED_STILL_COPIED') fail(`copied rewrite was not refused (outcome ${outcomeOf(out, COPY)})`);
  if (after.copy !== fx.copyHtml) fail('a refused rewrite changed the queued page');
  if (after.live !== fx.liveHtml) fail('the published page changed');
}
// 2. A rewrite in the therapist's voice.
{
  const { out, fx, after } = await run((ps) => ps.map(() => `In my practice I see ${distinctPassage()}`));
  examined += out.examined;
  if (!String(outcomeOf(out, COPY)).startsWith('REJECTED_WORDING')) fail(`first-person rewrite was not refused (outcome ${outcomeOf(out, COPY)})`);
  if (after.copy !== fx.copyHtml) fail('a refused wording changed the queued page');
}
// 3. A distinct, clean rewrite.
{
  const { out, fx, after } = await run((ps) => ps.map(() => distinctPassage()));
  examined += out.examined;
  if (outcomeOf(out, COPY) !== 'REDRAFTED') fail(`a distinct rewrite with a usable description was not kept (outcome ${outcomeOf(out, COPY)})`);
  if (after.copy === fx.copyHtml) fail('REDRAFTED but the queued page is unchanged');
  const liveRuns = new Set(lib.pagePassages(after.live).flatMap((p) => [...lib.shinglesOf(p)]));
  const reworded = lib.pagePassages(after.copy).filter((p) => p.startsWith('Quiet '));
  if (!reworded.length) fail('no reworded passage reached the page');
  for (const p of reworded) if ([...lib.shinglesOf(p)].some((r) => liveRuns.has(r))) fail('a kept passage still shares an 8-word run with the live page');
  if (after.live !== fx.liveHtml) fail('the published page changed');
  if (after.twin !== fx.copyHtml.split(route(COPY)).join(route(TWIN))) fail('an approved record whose route is already live was rewritten');
  if (out.results.some((r) => r.id === LIVE.id || r.id === TWIN.id)) fail('a live route was considered for a redraft');
}

if (!examined) fail('examined-no-items -- the lane picked nothing from the fixture, so this check proves nothing');

if (errors.length) {
  console.log('VALIDATION_FINDING check=redraft-lane');
  console.error(`HARD FAIL  redraft-lane (${errors.length})`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`Redraft lane OK (${examined} fixture item(s) examined across 3 runs: copied and first-person rewrites refused with the page untouched, a distinct rewrite kept with no 8-word run shared with the live page, published and already-live routes never touched).`);
