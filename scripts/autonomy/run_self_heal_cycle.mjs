import path from 'node:path';
import { listFiles, readJson, writeJsonAtomic, nowIso } from './lib/io.mjs';
import { analyzeResourceHtml, repairResourceHtml } from './lib/self_heal.mjs';
import { freezeFile, rollbackRevision } from './lib/freeze.mjs';

const clock = process.env.SELF_HEAL_CLOCK ? new Date(process.env.SELF_HEAL_CLOCK) : new Date();
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
console.log(JSON.stringify({ ok: true, status: state.status, repairedPages: repairs.length, skippedPages: skips.length, rollbackReady: state.rollbackReady }, null, 2));
