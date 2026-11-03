import fs from 'node:fs';
import { createRequire } from 'node:module';
import { readJson, writeJsonAtomic, nowIso, routeToSourceFile } from '../autonomy/lib/io.mjs';
import { analyzeResourceHtml, repairResourceHtml } from '../autonomy/lib/self_heal.mjs';
import { enqueuePublicationNotification } from '../autonomy/lib/notification.mjs';
import { writeResource } from '../autonomy/lib/render_resource.mjs';
const require = createRequire(import.meta.url);
const { processManifest, loadApprovedIds } = require('./process_manifest.js');
const { applySearchMetadata } = require('../search/apply_search_metadata.js');
const { MANIFEST_STATUSES } = require('./manifest_statuses.js');

const clock = process.env.PUBLISH_CLOCK ? new Date(process.env.PUBLISH_CLOCK) : new Date();

// Pause and Stop have to mean it.
//
// data/autonomy/state.json carried `paused` and `emergencyStop` since the
// autonomy work, but only scripts/autonomy/run_cycle.mjs ever read them. The
// drafting lane stopped and the release lane did not, so pausing would have left
// the daily Content Publish cron still putting pages on a live client site - a
// button that reports it stopped everything while the one thing a client most
// wants stopped keeps running. Now the client-facing control on /admin/ is real
// on every lane it claims to cover.
//
// Held, not failed: exit 0 and say why. A paused system reporting a red CI
// failure would train everyone to ignore the red.
const autonomyState = readJson('data/autonomy/state.json', { paused: false, emergencyStop: false });
if (autonomyState.paused || autonomyState.emergencyStop) {
  const status = autonomyState.emergencyStop ? 'EMERGENCY_STOPPED' : 'PAUSED';
  const who = autonomyState.emergencyStop ? autonomyState.stoppedBy : autonomyState.pausedBy;
  console.log(JSON.stringify({ ok: true, status, published: [], processed: 0, stoppedBy: who || null }, null, 2));
  console.log(`\nNOTHING PUBLISHED - the site is ${status === 'PAUSED' ? 'paused' : 'stopped'}${who ? ` by ${who}` : ''}. This is a successful run, not a fault. Content already live is unaffected.`);
  process.exit(0);
}

const manifest = readJson('data/admin/content_manifest.json');
const exceptions = readJson('data/autonomy/exceptions.json', { schemaVersion: '1.0.0', items: [] });
// Only human-approved items are touched at all. Repairing and rewriting the source
// HTML of content nobody has agreed to publish churns the client's tree for pages
// that may never ship, and it was the same loop that fed the auto-publisher.
const approvedIds = loadApprovedIds();
const dueAll = manifest.filter((item) => item.status === 'approved' && item.validationPassed === true && item.scheduledAt && new Date(item.scheduledAt) <= clock);
const due = dueAll.filter((item) => approvedIds.has(item.id));
const awaitingApproval = dueAll.filter((item) => !approvedIds.has(item.id));
const repairsById = new Map();
// Held items keep their manifest record exactly as it is (status stays
// `approved`, see scripts/publishing/manifest_statuses.js); the hold is named
// here, in exceptions.json and in the receipt, and is re-evaluated every run.
const held = new Map();
const restamped = new Map(); // engine-written pages re-dated for release; restored if they end up held
const recordException = (entry) => {
  if (!exceptions.items.some((e) => e.candidateId === entry.candidateId && e.decision === entry.decision)) exceptions.items.push(entry);
};
for (const item of due) {
  if (!String(item.slug || '').startsWith('/resources/')) continue;
  const sourceFile = routeToSourceFile(item.slug);
  // Engine-written posts (scripts/publishing/write_calendar_slots.mjs) show the day they actually
  // go live, never the slot date of an overdue slot: re-render from the stored draft with today's date.
  if (item.engineDraft?.draftFile && fs.existsSync(item.engineDraft.draftFile)) {
    const stored = JSON.parse(fs.readFileSync(item.engineDraft.draftFile, 'utf8'));
    if (fs.existsSync(sourceFile)) restamped.set(item.id, { file: sourceFile, original: fs.readFileSync(sourceFile, 'utf8') });
    writeResource({ draft: stored.draft, route: item.slug, contentType: item.contentType, scheduledAt: item.scheduledAt, publishedAt: clock });
  }
  let analysis = analyzeResourceHtml(sourceFile);
  if (!analysis.blocked && analysis.findings.some((finding) => finding.severity === 'repairable')) {
    const repairs = repairResourceHtml(sourceFile, analysis, { canonical: `https://www.hicksconsulting.org${item.slug}`, date: String(item.scheduledAt).slice(0, 10), title: item.title });
    repairsById.set(item.id, repairs);
    analysis = analyzeResourceHtml(sourceFile);
  }
  if (!analysis.safe) {
    held.set(item.id, analysis.findings);
    recordException({ id: `exception-publish-${item.id}-${clock.valueOf()}`, candidateId: item.autonomy?.candidateId || item.id, decision: 'SKIPPED_PROHIBITED_ACTION', findings: analysis.findings, createdAt: nowIso(clock), blocksOtherWork: false, clientActionRequired: analysis.findings.some((finding) => finding.code === 'PROHIBITED_CLAIM') });
    console.log(`NAMED STOP: UNSAFE_CONTENT ${item.id} - held off the public site; its record stays approved and other approved content continues.`);
  }
}
const before = new Map(manifest.map((item) => [item.id, item.status]));
let result = processManifest(manifest, clock, { hold: held.keys() });
// Legacy queued HTML predates the current renderer. Normalize the prospective
// public corpus before persisting release state; do not touch unapproved pages.
// Pages already live are judged against the live site only; the pages this run
// would release are judged after them, so a queued page can be held but can
// never make a published page "unresolvable" (scripts/search/apply_search_metadata.js).
const releasing = result.manifest.filter((item) => item.status === 'published' && before.get(item.id) !== 'published').map((item) => item.publicPath || item.slug);
const metadata = result.publishedCount
  ? applySearchMetadata({ manifest: result.manifest, allowUnresolved: true, releasing })
  : { unresolved: [] };
if (metadata.unresolved.length) {
  const routes = new Set(metadata.unresolved);
  // A newly due legacy page with no safe metadata stays off the public site.
  // A broken already-published page remains a real blocker, never a quiet skip.
  if (manifest.some((item) => before.get(item.id) === 'published' && routes.has(item.publicPath || item.slug))) {
    throw new Error('Search metadata repair failed for an already-published page.');
  }
  for (const item of due) {
    if (!routes.has(item.publicPath || item.slug)) continue;
    const findings = [{ code: 'SEARCH_METADATA_UNRESOLVED', severity: 'hard', route: item.publicPath || item.slug }];
    held.set(item.id, findings);
    recordException({ id: `exception-metadata-${item.id}-${clock.valueOf()}`, candidateId: item.id, decision: 'SKIPPED_UNSAFE_SEARCH_METADATA', findings, createdAt: nowIso(clock), blocksOtherWork: false, clientActionRequired: false });
    console.log(`NAMED STOP: SEARCH_METADATA_UNRESOLVED ${item.id} - held off the public site; its record stays approved and other approved content continues.`);
  }
  result = processManifest(manifest, clock, { hold: held.keys() });
}
const published = result.manifest.filter((item) => before.get(item.id) !== 'published' && item.status === 'published');
// A held page is left exactly as it was: undo the release-day re-date on anything not released.
for (const [id, { file, original }] of restamped) if (!published.some((item) => item.id === id)) fs.writeFileSync(file, original);
const unknownStatus = result.manifest.filter((item) => !MANIFEST_STATUSES.includes(item.status));
if (unknownStatus.length) throw new Error(`Refusing to write manifest statuses outside scripts/publishing/manifest_statuses.js: ${unknownStatus.map((item) => `${item.id}=${item.status}`).join(', ')}`);
writeJsonAtomic('data/admin/content_manifest.json', result.manifest);
writeJsonAtomic('data/autonomy/exceptions.json', exceptions);
const receipt = {
  schemaVersion: '1.0.0',
  receiptId: `publish-${clock.toISOString().replace(/[:.]/g, '-')}`,
  publishedAt: nowIso(clock),
  published: published.map((item) => ({
    id: item.id,
    title: item.title,
    route: item.slug,
    url: `https://www.hicksconsulting.org${item.slug}`,
    query: item.autonomy?.query,
    cluster: item.autonomy?.clusterId,
    selectionReason: item.source === 'full_safe_autonomy' ? 'Selected by the query-intelligence and Safe Harbor pipeline for an existing cadence slot.' : 'Released from the existing client editorial calendar at its established date.',
    repairs: repairsById.get(item.id) || [],
    decision: item.autonomy?.decision || 'EXISTING_VALIDATED_EDITORIAL_ITEM',
    sources: item.autonomy?.sources || [],
    internalLinks: item.autonomy?.internalLinks || []
  })),
  skipped: [...held].map(([id, findings]) => ({ id, findings })),
  awaitingHumanApproval: awaitingApproval.map((item) => ({ id: item.id, route: item.slug, scheduledAt: item.scheduledAt })),
  changed: result.changed
};
writeJsonAtomic(`data/autonomy/receipts/${receipt.receiptId}.json`, receipt);
if (published.length) enqueuePublicationNotification(receipt, clock);
console.log(JSON.stringify({ ok: true, ...receipt }, null, 2));
// Rule zero: a held or waiting cadence slot must be visible on the run, not only
// in a receipt nobody opens. From 9 Oct to 3 Nov 2026 the daily calendar lost 8
// of 43 slots to SEARCH_METADATA_UNRESOLVED holds while every run ended green on
// "NOTHING TO PUBLISH ... await a human decision" - wrong on both counts: the
// held items were already approved, and no human decision can release them. A
// metadata hold means the queued body repeats text already live, so no distinct
// description exists; only a redraft clears it, and the drafting lane reports
// its own provider state in data/autonomy/state.json. Held, not failed (exit 0):
// the next run re-checks, but the stop is named on every run and in the job
// summary until it clears.
const dayMs = 24 * 60 * 60 * 1000;
const sinceOf = (rows) => rows.map((row) => row.scheduledAt).filter(Boolean).sort()[0] || null;
const ageDays = (iso) => (iso ? Math.max(0, Math.floor((clock.valueOf() - Date.parse(iso)) / dayMs)) : 0);
const heldRows = [...held.keys()].map((id) => manifest.find((item) => item.id === id)).filter(Boolean);
const stops = [];
if (heldRows.length) {
  const since = sinceOf(heldRows);
  const metadataHolds = [...held.values()].filter((findings) => findings.some((f) => f.code === 'SEARCH_METADATA_UNRESOLVED')).length;
  const drafting = autonomyState.draftingProvider?.status || 'UNKNOWN';
  stops.push(`NAMED STOP: HELD_DUE_ITEMS ${heldRows.length} approved, due item(s) held off the site, oldest scheduled ${String(since).slice(0, 10)} (${ageDays(since)} day(s)); ${metadataHolds} for SEARCH_METADATA_UNRESOLVED (the queued body repeats text already live, so it needs a redraft, not an approval; drafting provider: ${drafting}). Ids: ${heldRows.map((row) => row.id).join(', ')}.`);
}
if (awaitingApproval.length) {
  const since = sinceOf(awaitingApproval);
  stops.push(`NAMED STOP: AWAITING_APPROVAL ${awaitingApproval.length} due item(s) need a per-item human approval, oldest scheduled ${String(since).slice(0, 10)} (${ageDays(since)} day(s)). Ids: ${awaitingApproval.map((item) => item.id).join(', ')}. Approve with: node scripts/admin/approve_publication.mjs --id <id> --by "<person>" (Admin Operations, workflow_dispatch only).`);
}
for (const line of stops) {
  console.log(`\n${line}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Content Publish held work::${line.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [`### Content Publish ${receipt.receiptId}`, `- Published: ${published.length}`, `- Held (approved, due, not releasable): ${heldRows.length}`, `- Awaiting a per-item approval: ${awaitingApproval.length}`, ...stops.map((line) => `- ${line}`)].join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
if (!published.length) {
  // A successful run: on a client site nothing due is the normal resting state.
  // Anything due but not released is named above, never folded into this line.
  console.log(`\nNOTHING PUBLISHED - this is a successful run. Held: ${heldRows.length}. Awaiting a per-item approval: ${awaitingApproval.length}.`);
}
