import path from 'node:path';
import { listFiles, readJson, writeJsonAtomic, nowIso } from './lib/io.mjs';
import { analyzeResourceHtml, repairResourceHtml } from './lib/self_heal.mjs';
import { freezeFile, rollbackRevision } from './lib/freeze.mjs';

const clock = process.env.SELF_HEAL_CLOCK ? new Date(process.env.SELF_HEAL_CLOCK) : new Date();

// The lane used to commit "Self-heal: apply bounded validated repairs" on every
// run, including runs that repaired nothing: the `git diff --cached --quiet`
// guard fired on the state file this script rewrites unconditionally, so the
// message described repairs that never happened. The git history is the record
// the client and the operator read, so it has to say what actually occurred.
//
// This receipt is the single machine-readable outcome of a run - including the
// paused/stopped branch, which returns before the state file is written - and it
// carries the exact commit subject the workflow must use. The workflow reads it
// rather than composing a message from a guess about what changed on disk.
const OUTCOME_FILE = 'reports/self-heal-outcome.json';

function writeOutcome({ status, repairedPages, skippedPages, stoppedBy = null, rollbackReady = true }) {
  let commitMessage;
  if (status === 'PAUSED' || status === 'EMERGENCY_STOPPED') {
    commitMessage = `Self-heal: no repairs attempted, site is ${status}${stoppedBy ? ` (by ${stoppedBy})` : ''}`;
  } else if (repairedPages > 0) {
    commitMessage = `Self-heal: repaired ${repairedPages} page(s)`
      + (skippedPages > 0 ? `, skipped ${skippedPages} needing scoped review` : '');
  } else if (skippedPages > 0) {
    commitMessage = `Self-heal: no repairs applied, ${skippedPages} page(s) skipped needing scoped review`;
  } else {
    commitMessage = 'Self-heal: no repairs needed (run receipt only)';
  }
  writeJsonAtomic(OUTCOME_FILE, {
    schemaVersion: '1.0.0',
    ranAt: nowIso(clock),
    status,
    repairedPages,
    skippedPages,
    stoppedBy,
    rollbackReady,
    repairsApplied: repairedPages > 0,
    commitMessage
  });
  return commitMessage;
}

// Same reason as scripts/publishing/run_safe_publish.mjs: the pause control on
// /admin/ promises that nothing runs, and self-healing rewrites the HTML of the
// client's pages. It has to stop too.
const autonomyState = readJson('data/autonomy/state.json', { paused: false, emergencyStop: false });
if (autonomyState.paused || autonomyState.emergencyStop) {
  const status = autonomyState.emergencyStop ? 'EMERGENCY_STOPPED' : 'PAUSED';
  const who = autonomyState.emergencyStop ? autonomyState.stoppedBy : autonomyState.pausedBy;
  writeOutcome({ status, repairedPages: 0, skippedPages: 0, stoppedBy: who || null });
  console.log(JSON.stringify({ ok: true, status, repairs: [], skips: [], stoppedBy: who || null }, null, 2));
  console.log(`\nNO REPAIRS ATTEMPTED - the site is ${status === 'PAUSED' ? 'paused' : 'stopped'}${who ? ` by ${who}` : ''}. This is a successful run. Nothing on the live site was changed.`);
  process.exit(0);
}

const state = readJson('data/autonomy/self_heal_state.json', { schemaVersion: '1.0.0', repairs: [], skips: [] });
const manifest = readJson('data/admin/content_manifest.json', []);
const byRoute = new Map(manifest.map((item) => [item.slug, item]));
const repairs = [];
const skips = [];

for (const file of listFiles('pages/resources', (name) => name.endsWith('/index.html'))) {
  const route = `/${file.replace(/^pages\//, '').replace(/\/index\.html$/, '')}/`;
  const item = byRoute.get(route);
  if (!item) continue;
  const analysis = analyzeResourceHtml(file);
  if (analysis.blocked) {
    skips.push({ route, file, findings: analysis.findings, reason: 'Protected or hard finding requires scoped review.' });
    continue;
  }
  if (!analysis.findings.length) continue;

  const stamp = clock.toISOString().replace(/[:.]/g, '-');
  const preRevisionId = `self-heal-pre-${String(item.id).replace(/[^a-z0-9-]/gi, '-')}-${stamp}`;
  const pre = freezeFile({ route, sourceFile: file, reason: 'Pre-repair rollback snapshot for bounded self-healing.', revisionId: preRevisionId, createdAt: nowIso(clock) });
  const applied = repairResourceHtml(file, analysis, {
    canonical: `https://www.hicksconsulting.org${route}`,
    date: String(item.scheduledAt || item.publishedAt || clock.toISOString()).slice(0, 10),
    title: item.title
  });
  if (!applied.length) continue;

  const after = analyzeResourceHtml(file);
  if (!after.safe || after.findings.some((finding) => finding.severity === 'repairable')) {
    rollbackRevision({ revisionId: preRevisionId });
    skips.push({ route, file, findings: after.findings, reason: 'Repair did not produce a clean bounded result; pre-repair snapshot restored.', rollbackRevisionId: preRevisionId });
    continue;
  }

  const postRevisionId = `self-heal-post-${String(item.id).replace(/[^a-z0-9-]/gi, '-')}-${stamp}`;
  const post = freezeFile({ route, sourceFile: file, reason: 'Accepted bounded self-healing repair.', revisionId: postRevisionId, createdAt: nowIso(clock) });
  repairs.push({ route, file, applied, preRevisionId, preHash: pre.hash, postRevisionId, postHash: post.hash, rollbackRevisionId: preRevisionId });
}

state.lastRunAt = nowIso(clock);
state.status = skips.length ? 'COMPLETED_WITH_PROTECTED_SKIPS' : 'COMPLETED';
state.repairs = repairs;
state.skips = skips;
state.rollbackReady = repairs.every((repair) => Boolean(repair.rollbackRevisionId));
writeJsonAtomic('data/autonomy/self_heal_state.json', state);
const commitMessage = writeOutcome({
  status: state.status,
  repairedPages: repairs.length,
  skippedPages: skips.length,
  rollbackReady: state.rollbackReady
});
console.log(JSON.stringify({ ok: true, status: state.status, repairedPages: repairs.length, skippedPages: skips.length, rollbackReady: state.rollbackReady, commitMessage }, null, 2));
