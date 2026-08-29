#!/usr/bin/env node
'use strict';
/*
 * The LLM Atlas nav must exist on every atlas page, and the generator that
 * writes it must be reachable.
 *
 * Same defect, second instance. scripts/navigation/build_internal_navigation.mjs
 * fixed the site's internal links once and was then invoked by nothing, so every
 * release left the navigation describing the previous library;
 * validate:internal-navigation now guards it. scripts/ingestion/
 * build_llm_atlas_navigation.js is the same shape and was still unguarded: it
 * exists to stop the eight /llm-atlas/ surfaces being the site's only dead ends -
 * seven of them carried no anchor of any kind, and the index rendered its
 * pillars as <article> cards with no links, so the sub-surfaces sat in
 * sitemap.xml reachable by no click path at all.
 *
 * It ran once, its output was committed, and then nothing called it again. Not
 * package.json, not any workflow, not site_build.js. Proved by deleting every
 * <nav> from pages/llm-atlas/answer-surfaces/index.html and re-running the three
 * checks that plausibly govern those routes - llm-ingestion-routes,
 * hidden-llm-surfaces and internal-links - all three passed. The whole matrix
 * would have stayed green while the atlas went back to being dead ends.
 *
 * This is the guard, and it asserts behaviour rather than the presence of a
 * string:
 *
 *   1. The generator runs in --check mode, which reports what it WOULD rewrite
 *      and touches nothing. A non-empty list means the tree and the generator
 *      disagree, so the committed nav is stale.
 *   2. Independently of the generator, every atlas page is read and must link to
 *      each of its seven siblings and to the site home page. This is the property
 *      that matters - no dead ends - and it holds even if the generator is
 *      rewritten.
 *   3. The generator is reachable: an npm script must name it, so a person or a
 *      lane can regenerate the nav without knowing the file path.
 *
 * Rule 0: hard-fails if it examines zero atlas pages, rather than passing an
 * empty check.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const root = path.resolve(__dirname, '..', '..');
const GENERATOR_REL = 'scripts/ingestion/build_llm_atlas_navigation.js';
const generator = path.join(root, GENERATOR_REL);
const atlasDir = path.join(root, 'pages', 'llm-atlas');

const errors = [];

if (!fs.existsSync(generator)) fail(`generator-missing: ${GENERATOR_REL} does not exist.`);
if (!fs.existsSync(atlasDir)) fail('atlas-missing: pages/llm-atlas does not exist; this check governs nothing.');

// ------------------------------------------------------- 1. not stale
const run = spawnSync(process.execPath, [generator, '--check'], { cwd: root, encoding: 'utf8' });
const output = `${run.stdout || ''}${run.stderr || ''}`;
if (run.error) errors.push(`could-not-run-the-atlas-generator: ${run.error.message}`);

let receipt = null;
try {
  receipt = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
} catch {
  errors.push(`atlas-generator-produced-no-receipt: it did not complete. Output was: ${output.trim().slice(0, 400)}`);
}

if (receipt) {
  if (!receipt.atlas_pages) {
    fail('examined-no-atlas-pages: the generator reported 0 atlas pages, so this check proves nothing.');
  }
  for (const problem of receipt.problems || []) errors.push(`atlas-generator-problem: ${problem}`);
  if (receipt.files_changed) {
    errors.push(
      `atlas-navigation-stale: ${receipt.files_changed} atlas page(s) do not match what the generator produces ` +
        `(${(receipt.files || []).join(', ')}). Run: npm run nav:atlas`
    );
  }
  // --check exits 1 only when it would change something; anything else is a crash.
  if (run.status !== 0 && !receipt.files_changed && !(receipt.problems || []).length) {
    errors.push(`atlas-generator-crashed: exited ${run.status} without reporting stale pages or problems.`);
  }
}

// ------------------------------------------- 2. the property itself: no dead ends
const pageFiles = [path.join(atlasDir, 'index.html')];
for (const entry of fs.readdirSync(atlasDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
  if (!entry.isDirectory()) continue;
  const file = path.join(atlasDir, entry.name, 'index.html');
  if (fs.existsSync(file)) pageFiles.push(file);
}
if (pageFiles.length < 2) {
  fail(`examined-no-atlas-pages: found ${pageFiles.length} page(s) under pages/llm-atlas; nothing to verify.`);
}

const routes = pageFiles.map((file) => {
  const rel = path.relative(atlasDir, path.dirname(file));
  return rel && rel !== '.' ? `/llm-atlas/${rel}/` : '/llm-atlas/';
});

let deadEnds = 0;
for (let index = 0; index < pageFiles.length; index += 1) {
  const file = pageFiles[index];
  const rel = path.relative(root, file);
  const html = fs.readFileSync(file, 'utf8');
  const hrefs = new Set([...html.matchAll(/<a\b[^>]*?\bhref="([^"]+)"/gi)].map((match) => match[1]));
  if (!hrefs.size) {
    deadEnds += 1;
    errors.push(
      `atlas-dead-end: ${rel} carries no anchor of any kind. It is in sitemap.xml and reachable by no click path, ` +
        'which is the exact condition the atlas nav generator was written to remove.'
    );
    continue;
  }
  const missingSiblings = routes.filter((route, other) => other !== index && !hrefs.has(route));
  if (missingSiblings.length) {
    errors.push(`atlas-nav-incomplete: ${rel} does not link to ${missingSiblings.join(', ')}.`);
  }
  if (!hrefs.has('/')) {
    errors.push(`atlas-no-way-out: ${rel} carries no link to the site home page, so a reader who arrives cannot leave.`);
  }
}

// -------------------------------------------------- 3. the generator is reachable
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const namedBy = Object.entries(pkg.scripts || {}).filter(([, body]) => body.includes(GENERATOR_REL)).map(([name]) => name);
if (!namedBy.length) {
  errors.push(
    `generator-unreachable: no npm script names ${GENERATOR_REL}. The repair for a stale atlas nav would be a file ` +
      'path nobody can find, which is how this generator went uninvoked in the first place.'
  );
}

if (errors.length) fail(errors);

console.log(
  `LLM Atlas navigation is current and complete (generator run in --check mode over ${receipt.atlas_pages} atlas ` +
    `page(s), 0 stale; ${pageFiles.length} page(s) read independently, ${deadEnds} dead end(s), every page linking to ` +
    `all ${pageFiles.length - 1} siblings and to the site home page; regenerate with npm run ${namedBy.join(' / ')}).`
);
