import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-self-heal-e2e-'));
const fail = (message) => { console.error(`VALIDATION_FINDING ${message}`); process.exitCode = 1; };
const writeJson = (rel, value) => { const full = path.join(temp, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`); };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

try {
  fs.cpSync(path.join(repo, 'scripts/autonomy'), path.join(temp, 'scripts/autonomy'), { recursive: true });
  const rel = 'pages/resources/articles/self-heal-fixture/index.html';
  const original = '<!doctype html><html><head></head><body><main><h1>Self Heal Fixture</h1><p>This is a grounded resource with enough ordinary copy to remain safe.</p></main></body></html>\n';
  fs.mkdirSync(path.dirname(path.join(temp, rel)), { recursive: true });
  fs.writeFileSync(path.join(temp, rel), original);
  writeJson('data/admin/content_manifest.json', [{ id: 'self-heal-fixture', title: 'Self Heal Fixture', slug: '/resources/articles/self-heal-fixture/', contentType: 'articles', status: 'published', scheduledAt: '2026-08-04T13:00:00.000Z' }]);
  writeJson('data/autonomy/self_heal_state.json', { schemaVersion: '1.0.0', repairs: [], skips: [] });
  writeJson('data/autonomy/revision_registry.json', { schemaVersion: '1.0.0', revisions: [] });

  const result = spawnSync(process.execPath, ['scripts/autonomy/run_self_heal_cycle.mjs'], {
    cwd: temp, env: { ...process.env, SELF_HEAL_CLOCK: '2026-08-06T23:00:00.000Z' }, encoding: 'utf8', timeout: 30000
  });
  if (result.status !== 0) fail(`self-heal cycle exited ${result.status}: ${result.stderr || result.stdout}`);

  const repaired = fs.readFileSync(path.join(temp, rel), 'utf8');
  for (const token of ['<title>Self Heal Fixture | Hicks Consulting</title>', 'name="description"', 'rel="canonical"', 'Monika Hicks, LCSW', '<time datetime="2026-08-04"', 'Informational note:']) {
    if (!repaired.includes(token)) fail(`repaired page missing ${token}`);
  }
  if (hash(repaired) === hash(original)) fail('self-heal cycle reported success without changing the repairable page.');

  const state = JSON.parse(fs.readFileSync(path.join(temp, 'data/autonomy/self_heal_state.json'), 'utf8'));
  if (state.repairs?.length !== 1 || state.rollbackReady !== true) fail('self-heal state did not record one rollback-ready repair.');
  const repair = state.repairs?.[0] || {};
  if (!repair.preRevisionId || !repair.postRevisionId || repair.preHash === repair.postHash) fail('pre/post revision evidence is incomplete.');

  const registry = JSON.parse(fs.readFileSync(path.join(temp, 'data/autonomy/revision_registry.json'), 'utf8'));
  if (registry.revisions?.length !== 2) fail(`expected two freeze revisions, found ${registry.revisions?.length || 0}.`);
  for (const revision of registry.revisions || []) if (!fs.existsSync(path.join(temp, revision.frozenFile))) fail(`frozen blob missing: ${revision.frozenFile}`);

  const rollback = spawnSync(process.execPath, ['--input-type=module', '-e', `import { rollbackRevision } from './scripts/autonomy/lib/freeze.mjs'; rollbackRevision({revisionId:${JSON.stringify(repair.rollbackRevisionId)}});`], { cwd: temp, encoding: 'utf8', timeout: 30000 });
  if (rollback.status !== 0) fail(`rollback command failed: ${rollback.stderr || rollback.stdout}`);
  const restored = fs.readFileSync(path.join(temp, rel), 'utf8');
  if (restored !== original) fail('rollback did not restore the exact pre-repair page bytes.');

  if (!process.exitCode) console.log('Self-heal E2E OK (bounded repair -> clean reanalysis -> pre/post freeze -> exact rollback).');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
