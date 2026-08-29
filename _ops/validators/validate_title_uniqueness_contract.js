'use strict';
/**
 * TITLE UNIQUENESS CONTRACT
 *
 * On 2026-08-08, 54 pages were removed from the public sitemap for index quality.
 * Every one of the 54 mappings in reports/BING_INDEXATION_CONSOLIDATION_REPORT.json
 * carries duplicateHtmlTitle: true. The mechanism was a parent title plus a
 * rotating editorial suffix. This validator makes that mechanism unable to return.
 *
 * It asserts, across the manifest AND every candidate queue that can become a page:
 *   1. no two items share a title (normalised: case and punctuation cannot smuggle
 *      a duplicate through);
 *   2. no title is another title plus a suffix, except within the frozen legacy set
 *      in data/admin/legacy_title_grandfather.json - which may not grow;
 *   3. no title carries one of the banned editorial suffixes, outside that legacy set;
 *   4. the demand phrasing bank is internally unique and still grounded in live
 *      research (a family pointing at a cluster or lead-intent tier that no longer
 *      exists is a guard that cannot reach what it governs);
 *   5. every title-producing generator actually goes through scripts/lib/demand_titles.js.
 *      A title module nothing imports is the "exists but nothing invokes it" defect.
 *
 * It HARD FAILS if it examined zero items. A pass on an empty loop is not a pass.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const ROOT = process.cwd();
const {
  normalizeTitleKey, stemSuffixRelation, bannedSuffix, buildDemandPool, PHRASEBOOK_PATH,
} = require(path.join(ROOT, 'scripts/lib/demand_titles.js'));

const failures = [];
function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

// --------------------------------------------------------------- the corpus
const manifest = readJson('data/admin/content_manifest.json', null);
if (!Array.isArray(manifest)) fail('TITLE UNIQUENESS: data/admin/content_manifest.json is missing or is not an array. Nothing could be examined.');

const items = [];
for (const entry of manifest) {
  if (!entry || !entry.title) continue;
  items.push({ list: 'content_manifest', id: entry.id, title: entry.title, status: entry.status, route: entry.slug || entry.publicPath });
}
for (const [list, rel] of [
  ['content_brief_candidates', 'data/intake/content_brief_candidates.json'],
  ['publish_queue', 'data/social/publish_queue.json'],
  ['autonomy_queue', 'data/autonomy/queue.json'],
]) {
  const doc = readJson(rel, {});
  for (const entry of doc.candidates || doc.items || []) {
    if (!entry || !entry.title) continue;
    items.push({ list, id: entry.id, title: entry.title, status: entry.autonomyStatus || entry.state, route: entry.suggestedRoute });
  }
}

// One CANDIDATE is mirrored across the brief list, the publish queue, the
// autonomy queue and finally the manifest (where it is prefixed `auto-`). Those
// four rows are one piece of content, not four, so they are collapsed to one
// identity before uniqueness is judged - otherwise the check would fire on the
// pipeline doing exactly what it is supposed to do.
//
// Mirrors that DISAGREE are themselves a defect: that is the unlinked-list
// failure mode, where one component retitles and another keeps the old string.
const identityOf = (item) => String(item.id || `${item.list}:${item.title}`).replace(/^auto-/, '');
const byIdentity = new Map();
for (const item of items) {
  const identity = identityOf(item);
  const existing = byIdentity.get(identity);
  if (!existing) { byIdentity.set(identity, { ...item, identity, mirrors: [item.list] }); continue; }
  existing.mirrors.push(item.list);
  if (normalizeTitleKey(existing.title) !== normalizeTitleKey(item.title)) {
    failures.push(`MIRROR TITLE DRIFT: candidate ${identity} is "${existing.title}" in ${existing.list} but "${item.title}" in ${item.list}. Two components are keeping their own list with no link.`);
  }
  // The manifest row is the one that owns a route, so it wins for reporting.
  if (item.list === 'content_manifest') { existing.list = item.list; existing.route = item.route; existing.status = item.status; }
}
const rowCount = items.length;
const unique = [...byIdentity.values()];

// Rule 0: no stage may exit 0 having done nothing.
if (!unique.length) fail('TITLE UNIQUENESS: examined 0 titles. The manifest and every candidate queue are empty or unreadable, so this check proved nothing.');

// ------------------------------------------------------- the frozen legacy set
const ledger = readJson('data/admin/legacy_title_grandfather.json', null);
if (!ledger || !Array.isArray(ledger.titles)) {
  fail('TITLE UNIQUENESS: data/admin/legacy_title_grandfather.json is missing or malformed. Without the frozen legacy set this check cannot tell a pre-existing duplicate from a new one.');
}
const grandfathered = new Set(ledger.titles.map(normalizeTitleKey));
if (ledger.count !== ledger.titles.length) {
  failures.push(`legacy grandfather ledger declares count ${ledger.count} but carries ${ledger.titles.length} titles.`);
}
// The ledger is FROZEN. It may shrink as legacy pages are retired; it may never grow.
if (ledger.titles.length > ledger.count) {
  failures.push(`legacy grandfather ledger has GROWN to ${ledger.titles.length} (frozen at ${ledger.count}). A new title has been admitted to the legacy exemption, which is exactly what this contract forbids.`);
}
const manifestTitleKeys = new Set(manifest.filter((x) => x && x.title).map((x) => normalizeTitleKey(x.title)));
const orphanLedgerEntries = ledger.titles.filter((t) => !manifestTitleKeys.has(normalizeTitleKey(t)));
if (orphanLedgerEntries.length) {
  failures.push(`legacy grandfather ledger names ${orphanLedgerEntries.length} title(s) that are no longer in the manifest, e.g. "${orphanLedgerEntries[0]}". Prune the ledger rather than leaving a stale exemption in place.`);
}

// ----------------------------------------------------------------- assertions
const byKey = new Map();
for (const item of unique) {
  const key = normalizeTitleKey(item.title);
  if (!key) { failures.push(`${item.list}:${item.id} has an empty title.`); continue; }
  if (byKey.has(key)) {
    const other = byKey.get(key);
    failures.push(`DUPLICATE TITLE: "${item.title}" is held by both ${other.list}:${other.id} and ${item.list}:${item.id}.`);
  } else {
    byKey.set(key, item);
  }
}

for (const item of unique) {
  const banned = bannedSuffix(item.title);
  if (banned && !grandfathered.has(normalizeTitleKey(item.title))) {
    failures.push(`BANNED EDITORIAL SUFFIX: ${item.list}:${item.id} "${item.title}" matches ${banned}. Titles are drawn from ${PHRASEBOOK_PATH}, never composed from a stem plus a suffix.`);
  }
}

const stemSuffixFindings = [];
for (let i = 0; i < unique.length; i++) {
  for (let j = i + 1; j < unique.length; j++) {
    const relation = stemSuffixRelation(unique[i].title, unique[j].title);
    if (!relation) continue;
    const bothLegacy = grandfathered.has(normalizeTitleKey(unique[i].title)) && grandfathered.has(normalizeTitleKey(unique[j].title));
    if (bothLegacy) continue;
    stemSuffixFindings.push(`STEM PLUS SUFFIX: "${relation.extended}" is "${relation.stem}" plus a suffix (${unique[i].list}:${unique[i].id} / ${unique[j].list}:${unique[j].id}). Neither is in the frozen legacy set, so this is a new duplicate-title defect.`);
  }
}
failures.push(...stemSuffixFindings.slice(0, 25));
if (stemSuffixFindings.length > 25) failures.push(`... and ${stemSuffixFindings.length - 25} further stem-plus-suffix pair(s).`);

// ------------------------------------------------- the bank and its grounding
let pool = [];
try {
  pool = buildDemandPool(ROOT);
} catch (error) {
  failures.push(`DEMAND BANK NOT GROUNDED: ${error.message}`);
}
if (pool.length) {
  const seen = new Map();
  for (const entry of pool) {
    const key = normalizeTitleKey(entry.title);
    if (seen.has(key)) failures.push(`${PHRASEBOOK_PATH} carries "${entry.title}" twice (${seen.get(key)} and ${entry.familyId}).`);
    else seen.set(key, entry.familyId);
    if (bannedSuffix(entry.title)) failures.push(`${PHRASEBOOK_PATH} phrasing "${entry.title}" carries a banned editorial suffix.`);
  }
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const relation = stemSuffixRelation(pool[i].title, pool[j].title);
      if (relation) failures.push(`${PHRASEBOOK_PATH}: "${relation.extended}" is "${relation.stem}" plus a suffix. Every phrasing must stand on its own.`);
    }
  }
}

// -------------------------------------------- the generators actually use it
// A title module nothing imports would be the "exists but nothing invokes it"
// defect this portfolio keeps producing. These are the only files in the repo
// that put a title on a candidate or a draft.
const TITLE_PRODUCERS = [
  'scripts/ingestion/build_content_brief_candidates.js',
  'scripts/continuity/replenish_editorial_candidates.mjs',
  'scripts/autonomy/run_cycle.mjs',
  'scripts/autonomy/migrate_queue.mjs',
];
for (const rel of TITLE_PRODUCERS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { failures.push(`TITLE PRODUCER MISSING: ${rel}`); continue; }
  const source = fs.readFileSync(abs, 'utf8');
  const usesModule = /demand_titles\.js/.test(source);
  // migrate_queue does not mint titles; it must reconcile them, which is the
  // link that keeps the autonomy queue from becoming a second unlinked list.
  const reconciles = rel.endsWith('migrate_queue.mjs') && /reconciled to the upstream demand-grounded brief/.test(source);
  if (!usesModule && !reconciles) {
    failures.push(`UNLINKED TITLE PRODUCER: ${rel} puts a title on a candidate or draft without going through scripts/lib/demand_titles.js. A title created outside the registry cannot be checked for uniqueness.`);
  }
  if (/titleFor\s*\(/.test(source) && /a practical guide to what matters most/.test(source.replace(/^\s*\/\/.*$/gm, ''))) {
    failures.push(`COMPOSED TITLE RESTORED: ${rel} composes a title from a stem plus a fixed suffix again.`);
  }
}

// ------------------------------------------------------------------- report
if (failures.length) {
  fail([
    `Examined ${unique.length} distinct pieces of content (${rowCount} rows across ${new Set(items.map((i) => i.list)).size} lists) and ${pool.length} phrasings in ${PHRASEBOOK_PATH}.`,
    ...failures,
  ]);
}

const legacyCount = unique.filter((i) => grandfathered.has(normalizeTitleKey(i.title))).length;
console.log([
  `Title uniqueness contract OK.`,
  `  titles examined:        ${unique.length} distinct pieces from ${rowCount} rows (${[...new Set(items.map((i) => i.list))].join(', ')})`,
  `  demand phrasings:       ${pool.length} in ${PHRASEBOOK_PATH}, all unique and grounded in live research`,
  `  frozen legacy set:      ${ledger.titles.length} pre-existing stem-plus-suffix titles, published or client-approved, not retitled`,
  `  legacy titles in scope: ${legacyCount}`,
  `  new duplicates:         0`,
  `  new stem+suffix pairs:  0`,
  `  banned suffixes:        0 outside the frozen legacy set`,
].join('\n'));
process.exit(0);
