import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = process.cwd();

export function readJson(relativePath, fallback = undefined) {
  const full = path.resolve(ROOT, relativePath);
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    if (fallback !== undefined) return structuredClone(fallback);
    throw new Error(`Unable to read JSON ${relativePath}: ${error.message}`);
  }
}

export function writeJsonAtomic(relativePath, value) {
  const full = path.resolve(ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const temp = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}.${Date.now()}.tmp`);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(temp, body, 'utf8');
  fs.renameSync(temp, full);
}

export function writeTextAtomic(relativePath, body) {
  const full = path.resolve(ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const temp = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, body, 'utf8');
  fs.renameSync(temp, full);
}

export function sha256(value) {
  const hash = crypto.createHash('sha256');
  if (Buffer.isBuffer(value)) hash.update(value);
  else hash.update(String(value));
  return hash.digest('hex');
}

export function sha256File(relativePath) {
  return sha256(fs.readFileSync(path.resolve(ROOT, relativePath)));
}

export function stableJsonHash(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.keys(input).sort().reduce((acc, key) => {
        acc[key] = normalize(input[key]);
        return acc;
      }, {});
    }
    return input;
  };
  return sha256(JSON.stringify(normalize(value)));
}

export function ensureArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

export function nowIso(clock = new Date()) {
  if (!(clock instanceof Date) || Number.isNaN(clock.valueOf())) throw new TypeError('Clock must be a valid Date.');
  return clock.toISOString();
}

export function slugify(value, max = 90) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

export function routeToSourceFile(route) {
  const clean = String(route || '').replace(/^\/+|\/+$/g, '');
  return path.posix.join('pages', clean, 'index.html');
}

export function fileExists(relativePath) {
  return fs.existsSync(path.resolve(ROOT, relativePath));
}

export function appendLedger(relativePath, entry, key = 'items') {
  const ledger = readJson(relativePath, { schemaVersion: '1.0.0', [key]: [] });
  if (!Array.isArray(ledger[key])) ledger[key] = [];
  ledger[key].push(entry);
  writeJsonAtomic(relativePath, ledger);
  return ledger;
}

export function listFiles(relativeDir, predicate = () => true) {
  const base = path.resolve(ROOT, relativeDir);
  if (!fs.existsSync(base)) return [];
  const output = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        if (predicate(rel)) output.push(rel);
      }
    }
  };
  walk(base);
  return output.sort();
}
