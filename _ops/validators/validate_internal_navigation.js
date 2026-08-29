#!/usr/bin/env node
/*
 * The internal-navigation lane must actually run, and pages/ must match what it
 * produces.
 *
 * scripts/navigation/build_internal_navigation.mjs writes the four category hub
 * lists, a breadcrumb and a related-links block into pages/ from the manifest.
 * It was written because 69 of this site's 98 public pages had zero inbound
 * internal links, and it fixed that once - and then nothing invoked it. Not
 * package.json, not any workflow, not scripts/site_build.js. So every release
 * after it landed left the navigation describing the library as it was before
 * that release.
 *
 * That was not theoretical. Two items published on 2026-08-29; running the
 * script afterwards changed the insights hub source and six sibling pages, all
 * of which had been pointing at the previous set for as long as the release had
 * been live.
 *
 * This is the guard. It runs the real script in --check mode, which reports what
 * it WOULD rewrite and touches nothing, and fails if that list is non-empty. A
 * page that the generator and the tree disagree about is a page whose links are
 * stale, which is the failure the script exists to prevent.
 *
 * Rule 0: it must never pass having examined nothing. The script prints how many
 * pages it considered; if that is zero, the check is inert and says so.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const script = path.join(root, 'scripts/navigation/build_internal_navigation.mjs');

const run = spawnSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' });
const output = `${run.stdout || ''}${run.stderr || ''}`;
const errors = [];

if (run.error) {
  errors.push(`could-not-run-the-navigation-generator: ${run.error.message}`);
}

// "published resources linked: N" and "memphis local-intent family: N page(s)"
// are the generator's own counts of what it governs.
const linked = Number((output.match(/published resources linked:\s*(\d+)/) || [])[1] || 0);
const family = Number((output.match(/memphis local-intent family:\s*(\d+) page\(s\)/) || [])[1] || 0);
const wouldChange = Number((output.match(/would change:\s*(\d+) source page\(s\)/) || [])[1] || 0);

if (!/would change:\s*\d+ source page\(s\)/.test(output)) {
  errors.push('the navigation generator did not report a change count -- it did not complete');
}
if (!linked && !family) {
  errors.push('examined-no-pages -- the generator governs nothing, so this check proves nothing');
}
if (wouldChange) {
  errors.push(`internal navigation is stale: ${wouldChange} source page(s) do not match what the generator produces. Run: npm run nav:internal`);
  for (const line of output.split('\n').filter((l) => /hub container not found/.test(l))) errors.push(line.trim());
}
// --check exits 1 only when it would change something; any other non-zero is a
// crash and must not be read as a pass.
if (run.status !== 0 && !wouldChange) {
  errors.push(`the navigation generator exited ${run.status} without reporting stale pages`);
}

if (errors.length) {
  console.log('VALIDATION_FINDING check=internal-navigation');
  console.error(`HARD FAIL  internal-navigation (${errors.length})`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log(`Internal navigation is current (generator run in --check mode over ${linked} published resource page(s) and a ${family}-page Memphis local-intent family; 0 source pages stale).`);
