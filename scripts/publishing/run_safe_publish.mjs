import { createRequire } from 'node:module';
import { readJson, writeJsonAtomic, nowIso, routeToSourceFile } from '../autonomy/lib/io.mjs';
import { analyzeResourceHtml, repairResourceHtml } from '../autonomy/lib/self_heal.mjs';
import { enqueuePublicationNotification } from '../autonomy/lib/notification.mjs';
const require = createRequire(import.meta.url);
const { processManifest, loadApprovedIds } = require('./process_manifest.js');

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
for (const item of due) {
  if (!String(item.slug || '').startsWith('/resources/')) continue;
  const sourceFile = routeToSourceFile(item.slug);
  let analysis = analyzeResourceHtml(sourceFile);
  if (!analysis.blocked && analysis.findings.some((finding) => finding.severity === 'repairable')) {
    const repairs = repairResourceHtml(sourceFile, analysis, { canonical: `https://www.hicksconsulting.org${item.slug}`, date: String(item.scheduledAt).slice(0, 10), title: item.title });
    repairsById.set(item.id, repairs);
    analysis = analyzeResourceHtml(sourceFile);
  }
  if (!analysis.safe) {
    item.status = 'skipped_unsafe';
    item.validationPassed = false;
    item.skipReason = analysis.findings;
    exceptions.items.push({ id: `exception-publish-${item.id}-${Date.now()}`, candidateId: item.autonomy?.candidateId || item.id, decision: 'SKIPPED_PROHIBITED_ACTION', findings: analysis.findings, createdAt: nowIso(clock), blocksOtherWork: false, clientActionRequired: analysis.findings.some((finding) => finding.code === 'PROHIBITED_CLAIM') });
  }
}
const before = new Map(manifest.map((item) => [item.id, item.status]));
const result = processManifest(manifest, clock);
const published = result.manifest.filter((item) => before.get(item.id) !== 'published' && item.status === 'published');
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
  skipped: due.filter((item) => item.status === 'skipped_unsafe').map((item) => ({ id: item.id, findings: item.skipReason })),
  awaitingHumanApproval: awaitingApproval.map((item) => ({ id: item.id, route: item.slug, scheduledAt: item.scheduledAt })),
  changed: result.changed
};
writeJsonAtomic(`data/autonomy/receipts/${receipt.receiptId}.json`, receipt);
if (published.length) enqueuePublicationNotification(receipt, clock);
console.log(JSON.stringify({ ok: true, ...receipt }, null, 2));
if (!published.length) {
  // A successful run. Nothing was due and approved, which on a client site is the
  // normal resting state, not a fault.
  console.log(`\nNOTHING TO PUBLISH - this is a successful run. ${awaitingApproval.length} item(s) are due and validated but await a human decision.`);
  console.log('Approve with: node scripts/admin/approve_publication.mjs --id <id> --by "<person>"  (Admin Operations, workflow_dispatch only)');
}
