#!/usr/bin/env node
'use strict';
/**
 * Entity graph check (authority audit, 30 Oct 2026).
 *
 * The site's identity in JSON-LD is defined once, in the entity sources named by
 * config/entity_watch.json (data/entities/org_schema.json and person_schema.json).
 * Before this check nothing compared what the pages publish against those files,
 * and nothing watched whether the sameAs profiles still resolve. This fast check
 * pins the first half; the weekly entity-backlink-watch workflow does the second.
 *
 * Fails when:
 *   A. config/entity_watch.json is missing or names no entity source;
 *   B. an entity source has no @id or an empty sameAs (Rule 0: zero items fails);
 *   C. a sameAs entry is not https, is duplicated, or points at the site's own host;
 *   D. a profiles_pending entry is already in a sameAs (pending never doubles as live);
 *   E. any JSON-LD node in pages/ or dist/ carrying an entity's @id publishes a sameAs,
 *      name, logo or description that differs from the entity source;
 *   F. no page publishes an entity's @id with its sameAs at all;
 *   G. the weekly watch workflow is missing, has no schedule or workflow_dispatch, or
 *      does not run scripts/authority/entity_backlink_watch.mjs.
 * Usage: node validate_entity_graph.js [repo-root]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const problems = [];
const fail = (m) => problems.push(m);
const abs = (p) => path.join(ROOT, p);
const readJson = (p) => JSON.parse(fs.readFileSync(abs(p), 'utf8'));

let cfg = null;
try { cfg = readJson('config/entity_watch.json'); } catch (e) { fail(`config/entity_watch.json unreadable: ${e.message}`); }
const sources = (cfg && Array.isArray(cfg.entity_sources)) ? cfg.entity_sources : [];
if (cfg && !sources.length) fail('config/entity_watch.json names no entity_sources');

const host = cfg ? String(cfg.site_host || '').toLowerCase() : '';
if (cfg && !host) fail('config/entity_watch.json has no site_host');
const bareHost = host.replace(/^www\./, '');

const entities = [];
const allSameAs = new Set();
for (const src of sources) {
  let e;
  try { e = readJson(src.file); } catch (err) { fail(`${src.file} unreadable: ${err.message}`); continue; }
  if (!e['@id']) { fail(`${src.file} has no @id`); continue; }
  const same = Array.isArray(e.sameAs) ? e.sameAs : [];
  if (!same.length) fail(`${src.file} has an empty sameAs; the entity would publish no profiles`);
  const seen = new Set();
  for (const u of same) {
    let url;
    try { url = new URL(u); } catch { fail(`${src.file} sameAs "${u}" is not a URL`); continue; }
    if (url.protocol !== 'https:') fail(`${src.file} sameAs ${u} is not https`);
    const h = url.hostname.toLowerCase().replace(/^www\./, '');
    if (bareHost && h === bareHost) fail(`${src.file} sameAs ${u} points at the site's own host`);
    if (seen.has(u)) fail(`${src.file} sameAs lists ${u} twice`);
    seen.add(u);
    allSameAs.add(u);
  }
  entities.push({ file: src.file, id: e['@id'], sameAs: same, name: e.name, logo: e.logo, description: e.description, published: 0 });
}

for (const p of (cfg && cfg.profiles_pending) || []) {
  const u = typeof p === 'string' ? p : p && p.url;
  if (!u) fail('profiles_pending holds an entry with no url');
  else if (allSameAs.has(u)) fail(`profiles_pending ${u} is already in a sameAs; remove it from pending`);
}

// ------------------------------------------------------------ published JSON-LD
function htmlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...htmlFiles(p));
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}
const files = [...htmlFiles(abs('pages')), ...htmlFiles(abs('dist'))];
if (!files.length) fail('no HTML under pages/ or dist/ to inspect');
const LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const byId = new Map(entities.map((e) => [e.id, e]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let nodesSeen = 0;
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  for (const m of html.matchAll(LD)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; } // malformed JSON-LD is another validator's job
    const stack = [data];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) { stack.push(...n); continue; }
      if (!n || typeof n !== 'object') continue;
      for (const v of Object.values(n)) if (v && typeof v === 'object') stack.push(v);
      const e = byId.get(n['@id']);
      if (!e) continue;
      nodesSeen += 1;
      const where = `${path.relative(ROOT, f)} (${n['@id']})`;
      if ('sameAs' in n) {
        e.published += 1;
        if (!same(n.sameAs, e.sameAs)) fail(`${where} publishes sameAs ${JSON.stringify(n.sameAs)}; ${e.file} says ${JSON.stringify(e.sameAs)}`);
      }
      for (const k of ['name', 'logo', 'description']) {
        if (k in n && e[k] !== undefined && !same(n[k], e[k])) fail(`${where} publishes a ${k} that differs from ${e.file}`);
      }
    }
  }
}
for (const e of entities) if (!e.published) fail(`no page publishes ${e.id} with its sameAs (${e.file} is not reaching the site)`);

// ---------------------------------------------------------------- the watch
const wf = (cfg && cfg.workflow) || '.github/workflows/entity-backlink-watch.yml';
if (!fs.existsSync(abs(wf))) fail(`${wf} is missing; nothing would watch the sameAs profiles`);
else {
  const y = fs.readFileSync(abs(wf), 'utf8');
  if (!/^\s*schedule:\s*$/m.test(y) || !/cron:/.test(y)) fail(`${wf} has no schedule`);
  if (!/workflow_dispatch:/.test(y)) fail(`${wf} has no workflow_dispatch`);
  if (!y.includes('scripts/authority/entity_backlink_watch.mjs')) fail(`${wf} does not run scripts/authority/entity_backlink_watch.mjs`);
}
if (!fs.existsSync(abs('scripts/authority/entity_backlink_watch.mjs'))) fail('scripts/authority/entity_backlink_watch.mjs is missing');

if (problems.length) {
  const { fail: emit } = require('../validation/protocol');
  emit([`ENTITY GRAPH: ${problems.length} problem(s).`, ...problems.map((p) => `- ${p}`)].join('\n'));
}
const total = entities.reduce((s, e) => s + e.sameAs.length, 0);
console.log(`entity-graph OK: ${entities.length} entities, ${total} sameAs profiles, ${nodesSeen} JSON-LD nodes across ${files.length} HTML files match the entity sources; weekly watch wired.`);
