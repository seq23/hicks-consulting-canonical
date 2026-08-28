import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic, writeTextAtomic, nowIso, slugify, routeToSourceFile, listFiles, ROOT, stableJsonHash } from './lib/io.mjs';
import { normalizeContentType, nextAvailableSlot } from './lib/cadence.mjs';
import { validateDraft, localRepairDraft } from './lib/safe_harbor.mjs';
import { providerConfigured, generateStructuredDraft, repairStructuredDraft } from './lib/llm_provider.mjs';
import { writeResource } from './lib/render_resource.mjs';
import { freezeFile } from './lib/freeze.mjs';

function transition(item, to, reason, clock = new Date()) {
  const from = item.state || null;
  item.state = to;
  item.updatedAt = nowIso(clock);
  item.history = Array.isArray(item.history) ? item.history : [];
  item.history.push({ from, to, at: nowIso(clock), reason });
}

function existingDocuments() {
  return listFiles('pages/resources', (file) => file.endsWith('/index.html')).map((file) => {
    const html = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const route = `/${file.replace(/^pages\//, '').replace(/\/index\.html$/, '')}/`;
    return { route, text };
  });
}

function manifestType(type) {
  return ({ insights: 'daily', articles: 'weekly', guides: 'monthly', 'white-papers': 'quarterly' })[normalizeContentType(type)];
}

function routeForCandidate(candidate) {
  if (candidate.suggestedRoute && /^\/resources\/(insights|articles|guides|white-papers)\/[a-z0-9-]+\/$/.test(candidate.suggestedRoute)) return candidate.suggestedRoute;
  const type = normalizeContentType(candidate.contentType);
  return `/resources/${type}/${slugify(candidate.title)}/`;
}

function appendException(exceptions, item, decision, findings, clock) {
  exceptions.items.push({
    id: `exception-${item.id}-${Date.now()}`,
    candidateId: item.id,
    decision,
    findings,
    createdAt: nowIso(clock),
    blocksOtherWork: false,
    clientActionRequired: decision === 'SKIPPED_UNSUPPORTED_CLAIM'
  });
}

function sourceContext() {
  const sourceHealth = readJson('data/intake/source_health.json', {});
  return { sourceHealth, policy: 'Use only supported public sources already carried by the candidate or omit the claim.' };
}

function brandContext() {
  return {
    site: readJson('data/system/config.json'),
    provider: readJson('data/entities/author_profile.json'),
    organization: readJson('data/entities/org_profile.json'),
    runtime: readJson('data/system/runtime_contract.json'),
    protectedFacts: readJson('data/system/ownership_manifest.json').protectedFacts
  };
}

const clock = process.env.AUTONOMY_CLOCK ? new Date(process.env.AUTONOMY_CLOCK) : new Date();
const maxItems = Math.max(1, Math.min(20, Number(process.env.AUTONOMY_MAX_ITEMS || 2)));
const dryRun = process.env.AUTONOMY_DRY_RUN === '1';
const state = readJson('data/autonomy/state.json');
const queue = readJson('data/autonomy/queue.json');
const exceptions = readJson('data/autonomy/exceptions.json');
const manifest = readJson('data/admin/content_manifest.json');
const runtime = readJson('data/system/runtime_contract.json');

if (runtime.runtimeMode !== 'FULL_SAFE_AUTONOMY') throw new Error(`Unexpected runtime mode: ${runtime.runtimeMode}`);
if (state.paused || state.emergencyStop) {
  state.lastCycleAt = nowIso(clock);
  state.lastCycleStatus = state.emergencyStop ? 'EMERGENCY_STOPPED' : 'PAUSED';
  writeJsonAtomic('data/autonomy/state.json', state);
  console.log(JSON.stringify({ ok: true, status: state.lastCycleStatus, processed: 0 }, null, 2));
  process.exit(0);
}

const candidates = queue.items.filter((item) => ['DISCOVERED', 'SCORED', 'ADMITTED', 'DRAFTING', 'DRAFTED', 'VALIDATING', 'REPAIRING', 'FAILED_RETRYABLE'].includes(item.state)).slice(0, maxItems);
const documents = existingDocuments();
const receipts = [];
state.currentPhase = 'RUNNING';
state.lastCycleAt = nowIso(clock);
const draftingProviderIsConfigured = providerConfigured(process.env);
state.draftingProvider = {
  configured: draftingProviderIsConfigured,
  status: draftingProviderIsConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
  requiredEnvironment: ['LLM_API_URL', 'LLM_API_KEY', 'LLM_MODEL'],
  lastSuccessfulDraftAt: state.draftingProvider?.lastSuccessfulDraftAt || null,
  lastProviderGate: state.draftingProvider?.lastProviderGate || null
};

for (const item of candidates) {
  try {
    if (['DISCOVERED', 'SCORED', 'FAILED_RETRYABLE'].includes(item.state)) {
      transition(item, 'SCORED', 'Candidate score normalized for autonomous admission.', clock);
      if (Number(item.score || 0) < Number(process.env.AUTONOMY_MIN_SCORE || 50)) {
        transition(item, 'SKIPPED_PROHIBITED_ACTION', 'Candidate did not meet the configured admission score.', clock);
        appendException(exceptions, item, item.state, [{ code: 'LOW_ADMISSION_SCORE', severity: 'advisory' }], clock);
        continue;
      }
      transition(item, 'ADMITTED', 'Candidate admitted inside the existing content policy and ownership boundaries.', clock);
    }

    if (!draftingProviderIsConfigured) {
      item.providerGate = 'LLM_PROVIDER_NOT_CONFIGURED';
      item.updatedAt = nowIso(clock);
      state.draftingProvider.lastProviderGate = 'LLM_PROVIDER_NOT_CONFIGURED';
      continue;
    }

    transition(item, 'DRAFTING', 'Structured LLM drafting started.', clock);
    let draft = await generateStructuredDraft({ candidate: item, brandContext: brandContext(), sourceContext: sourceContext(), existingContext: documents.slice(0, 12).map((document) => document.route) });
    transition(item, 'DRAFTED', 'Structured draft produced.', clock);
    item.providerGate = null;
    state.draftingProvider.lastSuccessfulDraftAt = nowIso(clock);
    state.draftingProvider.lastProviderGate = null;
    writeJsonAtomic(`data/autonomy/revisions/${item.id}-draft.json`, { candidateId: item.id, createdAt: nowIso(clock), draft });

    transition(item, 'VALIDATING', 'Safe Harbor validation started.', clock);
    const minimumWords = Number(process.env.AUTONOMY_MINIMUM_WORD_OVERRIDE || item.minimumWords || 560);
    let validation = validateDraft(draft, { existingDocuments: documents, minimumWords });
    let repairs = [];
    if (validation.decision === 'REPAIR_REQUIRED') {
      transition(item, 'REPAIRING', 'Repairable Safe Harbor findings detected.', clock);
      draft = localRepairDraft(draft, validation.findings);
      repairs = [...(draft.repairLog || [])];
      validation = validateDraft(draft, { existingDocuments: documents, minimumWords });
      if (validation.decision === 'REPAIR_REQUIRED') {
        const llmRepair = await repairStructuredDraft({ draft, findings: validation.findings, candidate: item });
        if (llmRepair) {
          draft = localRepairDraft(llmRepair, validation.findings);
          repairs.push(...(draft.repairLog || []));
          validation = validateDraft(draft, { existingDocuments: documents, minimumWords });
        }
      }
    }

    if (!validation.safe) {
      // validation.decision is Safe Harbor's DECISION vocabulary, not the queue's
      // STATE vocabulary. Passing it straight through worked for two of the three
      // reachable decisions purely because SKIPPED_UNSUPPORTED_CLAIM and
      // SKIPPED_DUPLICATE_INTENT happen to be spelled the same in both - which is
      // why the third went unnoticed. REPAIR_REQUIRED is not a state, and writing
      // it into item.state produced `invalid-state:...:REPAIR_REQUIRED` and a hard
      // fail from validate_autonomy_contract.js.
      //
      // A candidate whose findings survived local repair and the LLM repair pass
      // is retryable: run_cycle's own candidate filter above picks FAILED_RETRYABLE
      // back up on the next cycle, which is the behaviour intended here. An
      // unrecognised decision blocks rather than leaking a new value into state.
      const FINAL_STATE_BY_DECISION = {
        SKIPPED_UNSUPPORTED_CLAIM: 'SKIPPED_UNSUPPORTED_CLAIM',
        SKIPPED_DUPLICATE_INTENT: 'SKIPPED_DUPLICATE_INTENT',
        REPAIR_REQUIRED: 'FAILED_RETRYABLE',
      };
      const finalState = FINAL_STATE_BY_DECISION[validation.decision] || 'SYSTEM_BLOCKED';
      transition(item, finalState, 'Candidate did not satisfy the final Safe Harbor gate.', clock);
      item.findings = validation.findings;
      appendException(exceptions, item, validation.decision, validation.findings, clock);
      continue;
    }

    transition(item, 'VALIDATED_SAFE', repairs.length ? 'Draft repaired and passed Safe Harbor.' : 'Draft passed Safe Harbor without repair.', clock);
    const route = routeForCandidate(item);
    if (manifest.some((entry) => entry.slug === route || entry.id === `auto-${item.id}`)) {
      transition(item, 'SKIPPED_DUPLICATE_INTENT', 'Manifest already owns the target route or candidate id.', clock);
      appendException(exceptions, item, item.state, [{ code: 'DUPLICATE_MANIFEST_ROUTE', severity: 'duplicate', route }], clock);
      continue;
    }
    const contentType = normalizeContentType(item.contentType);
    const scheduledAt = nextAvailableSlot(contentType, manifest);
    const sourceFile = routeToSourceFile(route);
    if (!dryRun) writeResource({ draft, route, contentType, scheduledAt });
    const manifestItem = {
      id: `auto-${item.id}`,
      title: draft.title,
      type: manifestType(contentType),
      slug: route,
      status: 'approved',
      riskLevel: 'low',
      track: 'both',
      requiresFooter: true,
      validationPassed: true,
      contentWordTarget: Number(item.targetWords || minimumWords),
      contentWordWarningFloor: Number(item.minimumWords || minimumWords),
      source: 'full_safe_autonomy',
      contentType,
      publicPath: route,
      previewPath: `/preview${route}`,
      scheduledAt,
      autonomy: { candidateId: item.id, decision: repairs.length ? 'REWRITTEN_AND_AUTOPUBLISHED' : 'SAFE_AUTOPUBLISH', query: item.query, clusterId: item.clusterId, draftHash: stableJsonHash(draft), repairs, sources: Array.isArray(draft.sources) ? draft.sources : [], internalLinks: Array.isArray(draft.internalLinks) ? draft.internalLinks : [] }
    };
    if (!dryRun) manifest.push(manifestItem);
    const revisionId = `revision-${item.id}-${clock.toISOString().replace(/[:.]/g, '-')}`;
    let freeze = null;
    if (!dryRun) freeze = freezeFile({ route, sourceFile, reason: 'Initial accepted autonomous resource', revisionId, createdAt: nowIso(clock) });
    item.route = route;
    item.scheduledAt = scheduledAt;
    item.safeHarborDecision = manifestItem.autonomy.decision;
    item.repairs = repairs;
    item.revisionId = revisionId;
    item.freeze = freeze;
    transition(item, 'SCHEDULED', `Assigned to the next existing ${contentType} cadence slot.`, clock);
    receipts.push({ candidateId: item.id, route, scheduledAt, contentType, decision: item.safeHarborDecision, repairs, dryRun });
  } catch (error) {
    item.attempts = Number(item.attempts || 0) + 1;
    item.lastError = error.message;
    transition(item, item.attempts >= Number(process.env.AUTONOMY_MAX_ATTEMPTS || 3) ? 'SYSTEM_BLOCKED' : 'FAILED_RETRYABLE', 'Autonomy cycle error.', clock);
    appendException(exceptions, item, item.state, [{ code: 'AUTONOMY_RUNTIME_ERROR', severity: item.state === 'SYSTEM_BLOCKED' ? 'hard' : 'retryable', message: error.message }], clock);
  }
}

if (!dryRun) writeJsonAtomic('data/admin/content_manifest.json', manifest);
writeJsonAtomic('data/autonomy/queue.json', queue);
writeJsonAtomic('data/autonomy/exceptions.json', exceptions);
state.lastCycleStatus = receipts.length ? 'COMPLETED_WITH_SCHEDULED_ITEMS' : 'COMPLETED_NO_NEW_SCHEDULED_ITEMS';
state.currentPhase = 'IDLE';
state.counts = queue.items.reduce((counts, item) => {
  const key = item.state.toLowerCase();
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});
writeJsonAtomic('data/autonomy/state.json', state);
const receipt = { schemaVersion: '1.0.0', receiptId: `autonomy-${clock.toISOString().replace(/[:.]/g, '-')}`, ranAt: nowIso(clock), dryRun, processed: candidates.length, scheduled: receipts };
writeJsonAtomic(`data/autonomy/receipts/${receipt.receiptId}.json`, receipt);
console.log(JSON.stringify({ ok: true, ...receipt }, null, 2));
