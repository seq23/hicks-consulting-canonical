import { readJson, writeJsonAtomic, nowIso } from './lib/io.mjs';
import { normalizeContentType } from './lib/cadence.mjs';

const clock = new Date();
const source = readJson('data/social/publish_queue.json', { items: [] });
const current = readJson('data/autonomy/queue.json', { schemaVersion: '1.0.0', items: [] });
const known = new Set(current.items.map((item) => item.id));
let added = 0;
for (const sourceItem of source.items || []) {
  if (known.has(sourceItem.id)) continue;
  current.items.push({
    id: sourceItem.id,
    clusterId: sourceItem.clusterId,
    clusterTitle: sourceItem.clusterTitle,
    query: sourceItem.query || sourceItem.clusterTitle,
    contentType: normalizeContentType(sourceItem.contentType),
    title: sourceItem.title,
    suggestedRoute: sourceItem.suggestedRoute,
    targetWords: sourceItem.targetWords,
    minimumWords: sourceItem.minimumWords,
    sourceSignalCount: sourceItem.sourceSignalCount,
    score: sourceItem.score,
    llmPrompt: sourceItem.llmPrompt,
    humanizationChecklist: sourceItem.humanizationChecklist,
    conversionPath: sourceItem.conversionPath,
    sections: sourceItem.sections,
    state: 'DISCOVERED',
    // An item in data/autonomy/queue.json can reach release. These two flags are
    // the human release gate: process_manifest.js#requiresIndividualApproval
    // treats either one being true as "this piece needs Monika's own named
    // approval, whatever its date", and standingApprovalFor then refuses to let
    // a standing window sweep it in.
    //
    // This wrote `false` on every migrated item - stripping that gate off each
    // new candidate as it entered the queue. It predates the gate landing on
    // 2026-08-27; the 15 items already in the queue were repaired to `true` then
    // and the writer was not, so the defect re-armed on every item migrated
    // afterwards. On 2026-09-01 the continuity sidecar migrated three and pushed
    // them, and every lane running the full validation profile has been red
    // since: Content Publish run 34127601153 hard-failed autonomy-contract with
    // approval-gate-missing on exactly those three.
    //
    // The red run was the cheap half of the damage. The expensive half is that
    // a queue item carrying `false` is one a standing approval is allowed to
    // release to a client's live site with nobody having agreed to it.
    //
    // `true` here is the value _ops/validators/deep/validate_autonomy_contract.js
    // has always required. Note this is the autonomy queue only: the pre-draft
    // brief surfaces below (data/social/publish_queue.json,
    // data/intake/content_brief_candidates.json) legitimately carry `false`,
    // because drafting a candidate needs no approval - only releasing one does.
    // Held together by _ops/validators/validate_autonomy_queue_approval_gate.js,
    // which drives this script and asserts the flags survive migration.
    routineApprovalRequired: true,
    publicOnlyAfterApproval: true,
    source: 'legacy_generated_queue_migration',
    legacy: { publishMode: sourceItem.publishMode, approvalStatus: sourceItem.approvalStatus, status: sourceItem.status },
    createdAt: sourceItem.createdAt || nowIso(clock),
    history: [{ from: null, to: 'DISCOVERED', at: nowIso(clock), reason: 'Migrated from the prior approval-only generated queue.' }]
  });
  added += 1;
}
// Titles used to be copied into this queue exactly once, when a candidate was
// first migrated, and never looked at again. So when the upstream brief was
// retitled the autonomy queue kept the old string - two components each keeping
// their own list with no link between them, which is how a composed title
// survived into a rendered page after its source had already been fixed.
//
// A candidate that has NOT yet produced a page is reconciled to its upstream
// title, route and prompt on every migration. One that has (SCHEDULED or later,
// or that already owns a route) is left alone: its URL is committed.
const TERMINAL_STATES = new Set(['SCHEDULED', 'PUBLISHED', 'VALIDATED_SAFE']);
const sourceById = new Map((source.items || []).map((item) => [item.id, item]));
let reconciled = 0;
for (const item of current.items) {
  const upstream = sourceById.get(item.id);
  if (!upstream || !upstream.title) continue;
  if (TERMINAL_STATES.has(item.state) || item.route) continue;
  if (item.title === upstream.title) continue;
  item.title = upstream.title;
  item.suggestedRoute = upstream.suggestedRoute || item.suggestedRoute;
  item.llmPrompt = upstream.llmPrompt || item.llmPrompt;
  item.sections = upstream.sections || item.sections;
  item.query = upstream.demandPhrasing ? upstream.title : (item.query || upstream.clusterTitle);
  item.demandPhrasing = upstream.demandPhrasing || item.demandPhrasing;
  item.updatedAt = nowIso(clock);
  item.history = Array.isArray(item.history) ? item.history : [];
  item.history.push({ from: item.state, to: item.state, at: nowIso(clock), reason: 'Title reconciled to the upstream demand-grounded brief before any page existed.' });
  reconciled += 1;
}
writeJsonAtomic('data/autonomy/queue.json', current);
source.publishMode = 'full_safe_autonomy';
source.items = (source.items || []).map((item) => ({
  ...item,
  publishMode: 'full_safe_autonomy',
  autonomyStatus: current.items.find((candidate) => candidate.id === item.id)?.state || 'DISCOVERED',
  routineApprovalRequired: false,
  publicOnlyAfterApproval: false,
  approvalStatus: undefined,
  status: undefined
}));
source.items = source.items.map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)));
writeJsonAtomic('data/social/publish_queue.json', source);
const briefs = readJson('data/intake/content_brief_candidates.json', { candidates: [] });
briefs.policy = 'full_safe_autonomy_llm_humanized_prewrite_validated';
briefs.candidates = (briefs.candidates || []).map((item) => ({
  ...item,
  publishMode: 'full_safe_autonomy',
  autonomyStatus: current.items.find((candidate) => candidate.id === item.id)?.state || 'DISCOVERED',
  routineApprovalRequired: false,
  publicOnlyAfterApproval: false,
  approvalStatus: undefined
})).map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)));
writeJsonAtomic('data/intake/content_brief_candidates.json', briefs);
console.log(JSON.stringify({ ok: true, added, reconciledTitles: reconciled, total: current.items.length, publishMode: 'full_safe_autonomy' }, null, 2));
