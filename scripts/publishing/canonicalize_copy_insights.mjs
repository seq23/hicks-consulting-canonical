#!/usr/bin/env node
// Copy-cat insights point their canonical at the parent article (owner approval, 3 Nov 2026).
//
// The live insights were cut from their parent article's template: measured with this repo's
// own 8-word-run check (scripts/lib/search_metadata.js shinglesOf over pagePassages), 31 of the
// 76 live insights share half or more of their text with the article whose slug they extend.
// Two near-copies split one search between them, so Google shows neither. Each such insight
// stays live for readers; its <link rel="canonical"> names the parent article, and it leaves
// sitemap.xml (scripts/site_build.js reads the list), so the parent carries the search.
//
// The list (data/editorial/canonical_to_parent.json) is measured once and then fixed: a page on
// it never moves back on its own, and a new page is never added here (new posts are written by
// scripts/publishing/write_calendar_slots.mjs at under 30% shared with any live page).
//
// Usage: node scripts/publishing/canonicalize_copy_insights.mjs [--measure] [--write]
//   --measure  recompute the list from the live pages (only when the owner asks again)
//   --write    apply the list to the page sources
import fs from 'node:fs';
import path from 'node:path';
import { readLive } from './write_calendar_slots.mjs';

export const LIST = 'data/editorial/canonical_to_parent.json';
export const NEAR_COPY = 0.5;
const ORIGIN = 'https://www.hicksconsulting.org';
const root = process.cwd();
const fileOf = (route) => path.join(root, 'pages', route.replace(/^\/+|\/+$/g, ''), 'index.html');

export function measure() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/admin/content_manifest.json'), 'utf8'));
  const live = readLive(root, manifest);
  const articles = [...live.values()].filter((p) => p.route.startsWith('/resources/articles/') && p.route !== '/resources/articles/');
  const out = [];
  for (const p of live.values()) {
    if (!p.route.startsWith('/resources/insights/') || p.route === '/resources/insights/') continue;
    const slug = p.route.split('/')[3];
    const parent = articles.filter((a) => slug.startsWith(a.route.split('/')[3].slice(0, 60))).sort((x, y) => y.route.length - x.route.length)[0];
    if (!parent || !p.runs.size) continue;
    let n = 0; for (const r of p.runs) if (parent.runs.has(r)) n += 1;
    const share = n / p.runs.size;
    if (share >= NEAR_COPY) out.push({ route: p.route, parent: parent.route, shared: Math.round(share * 1000) / 1000 });
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

export function apply(list) {
  let changed = 0;
  for (const { route, parent } of list) {
    const file = fileOf(route);
    const html = fs.readFileSync(file, 'utf8');
    const re = /<link\b[^>]*rel="canonical"[^>]*>/i;
    if (!re.test(html)) throw new Error(`${route}: no canonical link to repoint`);
    const next = html.replace(re, `<link href="${ORIGIN}${parent}" rel="canonical"/>`);
    if (next !== html) { fs.writeFileSync(file, next); changed += 1; }
  }
  return changed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let list = fs.existsSync(path.join(root, LIST)) ? JSON.parse(fs.readFileSync(path.join(root, LIST), 'utf8')).items : null;
  if (process.argv.includes('--measure') || !list) {
    list = measure();
    fs.mkdirSync(path.dirname(path.join(root, LIST)), { recursive: true });
    fs.writeFileSync(path.join(root, LIST), JSON.stringify({ schemaVersion: '1.0.0', approvedBy: 'Site owner, 3 Nov 2026 (relayed by Sequoia Taylor)', rule: `live insight sharing >= ${NEAR_COPY} of its 8-word runs with the parent article its slug extends`, measuredAt: new Date().toISOString().slice(0, 10), items: list }, null, 2) + '\n');
  }
  if (!list.length) { console.error('NAMED STOP: CANONICAL_LIST_EMPTY nothing measured as a near-copy; nothing applied.'); process.exit(1); }
  const changed = process.argv.includes('--write') ? apply(list) : 0;
  console.log(JSON.stringify({ insights: list.length, changed }));
}
