#!/usr/bin/env node
/*
 * The human release gate must survive the trip into the autonomy queue.
 *
 * data/autonomy/queue.json is the last stop before a drafted page can be
 * released. Two flags on each item carry the gate - routineApprovalRequired and
 * publicOnlyAfterApproval - and scripts/publishing/process_manifest.js treats
 * either one being true as "this piece needs Monika's own named approval,
 * whatever its date", so no standing window can sweep it in.
 *
 * scripts/autonomy/migrate_queue.mjs, which is the only writer that puts new
 * items into that queue, hard-coded both flags to `false`. It was written before
 * the gate landed on 2026-08-27. When the gate landed, the 15 items already in
 * the queue were repaired to `true` and the writer was not - so the defect
 * re-armed on every item migrated afterwards, and nothing noticed until the
 * state was already committed to main.
 *
 * _ops/validators/deep/validate_autonomy_contract.js has always required `true`,
 * so it caught the result. It caught it late and in the wrong place: the
 * Editorial Continuity Sidecar runs continuity:replenish and autonomy:migrate -
 * both writers of this queue - and then validates with the six-check
 * authority-modernization profile, which does not contain autonomy-contract. So
 * on 2026-09-01 it wrote three ungated items, validated a profile that could not
 * see them, and pushed. Content Publish (run 34127601153) and every other lane
 * running the full profile went red on a state they did not create and could not
 * fix.
 *
 * This check asserts the three things that had to all be true for that to
 * happen, so no one of them can come back on its own:
 *
 *   1. BEHAVIOUR. The real migrate_queue.mjs is driven in a sandbox over a
 *      synthetic publish-queue item and the migrated result must carry both
 *      flags true. Not a string match on the source - the script is run.
 *   2. CONSEQUENCE. The real requiresIndividualApproval / standingApprovalFor
 *      from process_manifest.js must refuse to let a standing window cover a
 *      migrated item, and must cover an equivalent ungated one. That second half
 *      is what makes this a safety check rather than a spelling check: it shows
 *      what `false` actually buys.
 *   3. COVERAGE. Every workflow that runs a writer of data/autonomy/queue.json
 *      must also run a validation profile containing autonomy-contract, so a
 *      writer can never again commit a state nothing checked.
 *
 * Every loop below refuses to pass having examined zero items.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { fail } = require('../validation/protocol');

const ROOT = path.resolve(__dirname, '../..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const AUTONOMY_QUEUE = 'data/autonomy/queue.json';
const MIGRATOR = 'scripts/autonomy/migrate_queue.mjs';
// npm scripts that write data/autonomy/queue.json. A workflow running any of
// these must validate the contract that governs the file.
const QUEUE_WRITER_SCRIPTS = ['autonomy:migrate', 'autonomy:cycle', 'autonomy:full-cycle'];
const GOVERNING_CHECK = 'autonomy-contract';

const errors = [];
const note = [];

// ---------------------------------------------------------------------------
// 1. BEHAVIOUR - drive the real migrator.
// ---------------------------------------------------------------------------
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-gate-'));
try {
  const probes = [
    { id: 'probe-continuity-insight', contentType: 'insight', title: 'Probe insight', suggestedRoute: '/resources/insights/probe/', llmPrompt: 'probe', continuity_generated: true, routineApprovalRequired: false, publicOnlyAfterApproval: false },
    { id: 'probe-brief-article', contentType: 'article', title: 'Probe article', suggestedRoute: '/resources/articles/probe/', llmPrompt: 'probe', routineApprovalRequired: false, publicOnlyAfterApproval: false },
    { id: 'probe-no-flags-at-all', contentType: 'insight', title: 'Probe unflagged', suggestedRoute: '/resources/insights/probe-2/', llmPrompt: 'probe' }
  ];
  for (const rel of ['data/social', 'data/autonomy', 'data/intake']) {
    fs.mkdirSync(path.join(sandbox, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(sandbox, 'data/social/publish_queue.json'), JSON.stringify({ items: probes }, null, 2));
  fs.writeFileSync(path.join(sandbox, AUTONOMY_QUEUE), JSON.stringify({ schemaVersion: '1.0.0', items: [] }, null, 2));
  fs.writeFileSync(path.join(sandbox, 'data/intake/content_brief_candidates.json'), JSON.stringify({ candidates: [] }, null, 2));

  execFileSync(process.execPath, [path.join(ROOT, MIGRATOR)], { cwd: sandbox, stdio: 'pipe' });

  const migrated = JSON.parse(fs.readFileSync(path.join(sandbox, AUTONOMY_QUEUE), 'utf8')).items || [];
  if (migrated.length !== probes.length) {
    errors.push(`${MIGRATOR} migrated ${migrated.length} of ${probes.length} probe item(s); the behavioural probe cannot conclude anything from a partial migration.`);
  }
  if (!migrated.length) {
    errors.push(`${MIGRATOR} migrated zero items in the sandbox, so the release-gate assertion below would examine nothing. Refusing to pass on an empty loop.`);
  }
  for (const item of migrated) {
    if (item.routineApprovalRequired !== true || item.publicOnlyAfterApproval !== true) {
      errors.push(`migrator-strips-release-gate:${item.id} - ${MIGRATOR} wrote routineApprovalRequired=${item.routineApprovalRequired} publicOnlyAfterApproval=${item.publicOnlyAfterApproval} into ${AUTONOMY_QUEUE}. An item carrying anything but true there can be released by a standing approval with no named human decision.`);
    }
  }
  note.push(`${migrated.length} probe item(s) driven through the real migrator`);
} catch (error) {
  errors.push(`could not drive ${MIGRATOR} in a sandbox: ${error.message}`);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 2. CONSEQUENCE - the publisher's own logic, both directions.
// ---------------------------------------------------------------------------
const { requiresIndividualApproval, standingApprovalFor } = require(path.join(ROOT, 'scripts/publishing/process_manifest.js'));
const wideWindow = [{ throughMs: Date.parse('2099-12-31T23:59:59.000Z') }];
const scheduled = new Date('2027-01-04T13:00:00.000Z');

const gated = { id: 'gated', scheduledAt: scheduled.toISOString(), routineApprovalRequired: true, publicOnlyAfterApproval: true };
const ungated = { id: 'ungated', scheduledAt: scheduled.toISOString(), routineApprovalRequired: false, publicOnlyAfterApproval: false };

if (requiresIndividualApproval(gated) !== true) {
  errors.push('process_manifest.js#requiresIndividualApproval no longer recognises a gated autonomy-queue item, so the flags this check defends have stopped meaning anything to the publisher.');
}
if (standingApprovalFor(gated, wideWindow, scheduled) !== null) {
  errors.push('a standing approval covering all dates swept in an item that requires an individual decision - the release gate is not binding.');
}
// The negative half. If this stopped being true, `false` would be harmless and
// this whole check would be theatre; it is here so the check fails honestly
// rather than defending a flag that no longer does anything.
if (standingApprovalFor(ungated, wideWindow, scheduled) === null) {
  errors.push('an ungated item was NOT swept in by a standing approval, so this check can no longer demonstrate what routineApprovalRequired=false costs. Re-establish the consequence before trusting the assertion above.');
}
note.push('the publisher\'s own standing-approval logic proved binding in both directions');

// ---------------------------------------------------------------------------
// 3. COVERAGE - a writer must be validated by something that can see it.
// ---------------------------------------------------------------------------
const matrix = readJson('_repo_validation_matrix.json');
const profilesWithCheck = new Set(
  Object.entries(matrix.profiles || {})
    .filter(([, profile]) => Array.isArray(profile.checks) && profile.checks.includes(GOVERNING_CHECK))
    .map(([name]) => name)
);
if (!profilesWithCheck.size) {
  errors.push(`no validation profile in _repo_validation_matrix.json contains "${GOVERNING_CHECK}", so no lane can enforce the release gate at all.`);
}
// npm script name -> profile it runs, from the matrix's own composite mapping.
const compositeScripts = matrix.compositeScripts || {};
const coveringScripts = new Set(
  Object.entries(compositeScripts)
    .filter(([, profileName]) => profilesWithCheck.has(profileName))
    .map(([script]) => script)
);
if (!coveringScripts.size) {
  errors.push(`no npm script in _repo_validation_matrix.json#compositeScripts runs a profile containing "${GOVERNING_CHECK}".`);
}

const WF_DIR = '.github/workflows';
const workflowFiles = fs.readdirSync(path.join(ROOT, WF_DIR)).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
if (!workflowFiles.length) {
  errors.push(`${WF_DIR} holds no workflows - refusing to conclude anything about coverage from an empty directory.`);
}
let writerWorkflows = 0;
for (const file of workflowFiles) {
  const body = fs.readFileSync(path.join(ROOT, WF_DIR, file), 'utf8');
  const writers = QUEUE_WRITER_SCRIPTS.filter((script) => body.includes(`npm run ${script}`));
  if (!writers.length) continue;
  writerWorkflows += 1;
  const covers = [...coveringScripts].filter((script) => body.includes(`npm run ${script}`));
  if (!covers.length) {
    errors.push(`${WF_DIR}/${file} runs ${writers.join(' and ')}, which write ${AUTONOMY_QUEUE}, but runs no validation profile containing "${GOVERNING_CHECK}". It can commit an ungated queue item that nothing in its own job would catch - which is exactly how run 34127601153 went red on a state it did not create.`);
  }
}
if (!writerWorkflows) {
  errors.push(`no workflow runs any of ${QUEUE_WRITER_SCRIPTS.join(', ')}, so this check examined zero writer workflows and must not pass on an empty loop.`);
}
note.push(`${writerWorkflows} workflow(s) writing the autonomy queue each proved to run ${GOVERNING_CHECK}`);

// ---------------------------------------------------------------------------
// 4. LIVE STATE.
// ---------------------------------------------------------------------------
const live = readJson(AUTONOMY_QUEUE).items || [];
if (!live.length) {
  errors.push(`${AUTONOMY_QUEUE} holds zero items - this check examined nothing and must not pass on an empty loop.`);
}
for (const item of live) {
  if (item.routineApprovalRequired !== true || item.publicOnlyAfterApproval !== true) {
    errors.push(`approval-gate-missing:${item.id} - live queue item is releasable without a named human decision.`);
  }
}

if (errors.length) fail(errors);
console.log(`Autonomy queue release gate holds (${live.length} live queue item(s) all requiring a named human decision; ${note.join('; ')}).`);
