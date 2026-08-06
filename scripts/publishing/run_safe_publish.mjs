import { createRequire } from 'node:module';
import { readJson, writeJsonAtomic, nowIso, routeToSourceFile } from '../autonomy/lib/io.mjs';
import { analyzeResourceHtml, repairResourceHtml } from '../autonomy/lib/self_heal.mjs';
import { enqueuePublicationNotification } from '../autonomy/lib/notification.mjs';
const require = createRequire(import.meta.url);
const { processManifest } = require('./process_manifest.js');

const clock = process.env.PUBLISH_CLOCK ? new Date(process.env.PUBLISH_CLOCK) : new Date();
const manifest = readJson('data/admin/content_manifest.json');
const exceptions = readJson('data/autonomy/exceptions.json', { schemaVersion: '1.0.0', items: [] });
const due = manifest.filter((item) => item.status === 'approved' && item.validationPassed === true && item.scheduledAt && new Date(item.scheduledAt) <= clock);
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
  changed: result.changed
};
writeJsonAtomic(`data/autonomy/receipts/${receipt.receiptId}.json`, receipt);
if (published.length) enqueuePublicationNotification(receipt, clock);
console.log(JSON.stringify({ ok: true, ...receipt }, null, 2));
