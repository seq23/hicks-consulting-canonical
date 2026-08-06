import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, sha256File, writeJsonAtomic } from './io.mjs';

export function freezeFile({ route, sourceFile, reason, revisionId, createdAt }) {
  const hash = sha256File(sourceFile);
  const extension = path.extname(sourceFile) || '.html';
  const frozenRelative = `data/autonomy/freeze/${hash}${extension}`;
  const frozenFull = path.resolve(ROOT, frozenRelative);
  fs.mkdirSync(path.dirname(frozenFull), { recursive: true });
  if (!fs.existsSync(frozenFull)) fs.copyFileSync(path.resolve(ROOT, sourceFile), frozenFull);
  const registry = readJson('data/autonomy/revision_registry.json', { schemaVersion: '1.0.0', revisions: [] });
  registry.revisions.push({ revisionId, route, sourceFile, hash, frozenFile: frozenRelative, reason, createdAt, status: 'FROZEN' });
  writeJsonAtomic('data/autonomy/revision_registry.json', registry);
  return { hash, frozenFile: frozenRelative };
}

export function rollbackRevision({ revisionId }) {
  const registry = readJson('data/autonomy/revision_registry.json', { revisions: [] });
  const revision = registry.revisions.find((item) => item.revisionId === revisionId);
  if (!revision) throw new Error(`Revision not found: ${revisionId}`);
  const frozen = path.resolve(ROOT, revision.frozenFile);
  if (!fs.existsSync(frozen)) throw new Error(`Frozen file missing: ${revision.frozenFile}`);
  fs.copyFileSync(frozen, path.resolve(ROOT, revision.sourceFile));
  return revision;
}
