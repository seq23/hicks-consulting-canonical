'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

// A live page must never be made "unresolvable" by pages that are only queued.
// 8 Oct 2026: the first released page of a templated series shared its legacy
// description with 42 queued siblings; judged together, the live page counted as
// boilerplate, could not be re-derived, and the whole release lane threw. This
// fixture is that shape in miniature: one incumbent and three newcomers carrying
// the same description and no other copy. The incumbent must stay resolved and
// untouched, and every newcomer must be held instead. The control run (the
// newcomers not declared as releasing) must reproduce the defect, so the fixture
// is proven to reach it.
const { MANIFEST_STATUSES } = require('../publishing/manifest_statuses.js');

function verifyIncumbentPriority() {
  const { applySearchMetadata } = require('./apply_search_metadata.js');
  const lib = require('../lib/search_metadata');
  const repo = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-incumbent-priority-'));
  const shared = 'Consider a more compassionate way to understand overload and depleted capacity, what it can cost, and which kind of support may help next.';
  assert.ok(lib.descriptionInRange(shared), 'Fixture description must itself be in range.');
  const names = ['incumbent', 'queued-one', 'queued-two', 'queued-three'];
  const manifest = names.map((name, i) => ({ id: `fixture-${name}`, status: 'published', validationPassed: true, slug: `/resources/insights/fixture-${name}/`, title: `Fixture Series Page ${i + 1} About Depleted Capacity` }));
  // The repair reports unresolved pages on stderr; in this fixture that is the
  // expected outcome, asserted below, so it is captured rather than printed.
  const quiet = (fn) => { const saved = [console.log, console.error]; console.log = console.error = () => {}; try { return fn(); } finally { [console.log, console.error] = saved; } };
  try {
    process.chdir(root);
    fs.writeFileSync('sitemap.xml', `<urlset><url><loc>https://www.hicksconsulting.org${manifest[0].slug}</loc></url></urlset>`);
    for (const item of manifest) {
      const dir = path.join(root, 'pages', item.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), `<html><head><title>${lib.searchTitle(item.title)}</title><meta content="${shared}" name="description"/></head><body><div class="short-answer">${shared}</div></body></html>`);
    }
    const incumbentFile = path.join(root, 'pages', manifest[0].slug, 'index.html');
    const original = fs.readFileSync(incumbentFile, 'utf8');
    const releasing = manifest.slice(1).map((item) => item.slug);
    const fixed = quiet(() => applySearchMetadata({ manifest, allowUnresolved: true, releasing }));
    assert.equal(fixed.examined, manifest.length, `Incumbent-priority fixture examined ${fixed.examined} page(s), expected ${manifest.length}; it checked nothing.`);
    assert.ok(!fixed.unresolved.includes(manifest[0].slug), 'A live page was made unresolvable by pages that are only queued (the 8 Oct 2026 release-lane failure).');
    assert.deepEqual([...fixed.unresolved].sort(), [...releasing].sort(), 'Queued pages that cannot be made distinct from a live page must be held, every one of them.');
    assert.equal(fs.readFileSync(incumbentFile, 'utf8'), original, 'A compliant live page was rewritten because of queued pages.');
    const control = quiet(() => applySearchMetadata({ manifest, allowUnresolved: true, check: true }));
    assert.ok(control.unresolved.includes(manifest[0].slug), 'Control lost: judged without the releasing set the fixture no longer reproduces the defect, so it proves nothing.');
    return manifest.length;
  } finally {
    process.chdir(repo);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Run the real publisher against the queued calendar, never the working tree.
function verifyReleaseMetadata() {
  const fixturePages = verifyIncumbentPriority();
  const repo = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-release-metadata-'));
  try {
    fs.cpSync(repo, root, { recursive: true, filter: (file) => {
      const rel = path.relative(repo, file);
      return !['.git', 'dist', 'node_modules', 'artifacts', '.build'].some((dir) => rel === dir || rel.startsWith(`${dir}${path.sep}`));
    } });
    const manifestPath = path.join(root, 'data/admin/content_manifest.json');
    const before = JSON.parse(fs.readFileSync(manifestPath));
    const pages = new Map(before.filter((item) => item.status !== 'published').map((item) => {
      const file = path.join(root, 'pages', (item.publicPath || item.slug).replace(/^\//, ''), 'index.html');
      return [item.id, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null];
    }));
    const run = (script, extra = {}) => {
      const result = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, PUBLISH_CLOCK: '2026-12-31T23:59:59Z', SKIP_RELEASE_METADATA_REGRESSION: '1', ...extra }, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      assert.equal(result.status, 0, `${script}: ${result.error || result.stderr || result.stdout}`);
      if (script === 'scripts/site_build.js') {
        assert.equal(fs.readFileSync(path.join(root, 'dist/data/cadence/lastmod_ledger.json'), 'utf8'), fs.readFileSync(path.join(root, 'data/cadence/lastmod_ledger.json'), 'utf8'), 'Build shipped a stale freshness ledger.');
      }
      return result;
    };
    // Reproduce the currently failing release date before advancing the clock.
    run('scripts/publishing/run_safe_publish.mjs', { PUBLISH_CLOCK: '2026-09-29T19:00:00Z' });
    run('scripts/navigation/build_internal_navigation.mjs');
    run('scripts/site_build.js');
    run('_ops/validators/validate_search_metadata_contract.js');
    run('scripts/publishing/run_safe_publish.mjs');
    const after = JSON.parse(fs.readFileSync(manifestPath));
    const eligible = before.filter((item) => item.status === 'approved' && item.validationPassed && item.scheduledAt <= '2026-12-31T23:59:59Z' && !item.requiresIndividualApproval);
    assert.ok(eligible.length > 0, 'Regression must examine the real queued calendar.');
    const released = after.filter((item) => item.status === 'published' && before.find((row) => row.id === item.id).status !== 'published');
    assert.ok(released.length > 0, 'Regression must release real legacy pages.');
    // A held page keeps its manifest record exactly as it was (still `approved`);
    // the hold lives in the receipt and exceptions.json. Writing a status of its
    // own (`skipped_unsafe`, 9 Oct 2026) broke publish-state and the protected
    // editorial baseline on the next validate:all.
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'data/autonomy/receipts/publish-2026-12-31T23-59-59-000Z.json'), 'utf8'));
    const heldIds = new Set(receipt.skipped.map((entry) => entry.id));
    const exceptions = JSON.parse(fs.readFileSync(path.join(root, 'data/autonomy/exceptions.json'), 'utf8')).items;
    const unsafeContent = new Set(exceptions.filter((e) => e.decision === 'SKIPPED_PROHIBITED_ACTION').map((e) => e.candidateId));
    let skipped = 0;
    for (const row of after) {
      const original = before.find((item) => item.id === row.id);
      assert.ok(MANIFEST_STATUSES.includes(row.status), `${row.id}: the publisher wrote status "${row.status}", which is not in scripts/publishing/manifest_statuses.js.`);
      if (heldIds.has(row.id)) {
        skipped++;
        assert.deepEqual(row, original, `${row.id} was held but its manifest record changed; a hold must leave the record alone.`);
        const entry = receipt.skipped.find((e) => e.id === row.id);
        assert.ok(entry.findings?.length, `${row.id} was held with no recorded reason.`);
        assert.ok(exceptions.some((e) => e.candidateId === row.id || e.candidateId === row.autonomy?.candidateId), `${row.id} was held with no exception recorded.`);
      }
      if (row.status !== 'published' && pages.has(row.id) && !unsafeContent.has(row.id)) {
        const file = path.join(root, 'pages', (row.publicPath || row.slug).replace(/^\//, ''), 'index.html');
        assert.equal(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, pages.get(row.id), 'Unapproved, held and future-only page source changed.');
        assert.equal(row.status, original.status);
      }
    }
    // The state the release lane leaves behind must pass the same gates
    // validate:all runs on it in the Content Publish job.
    run('_ops/validators/validate_publish_state.js');
    run('scripts/authority_scale/validate_protected_editorial_core.mjs');
    run('scripts/navigation/build_internal_navigation.mjs');
    run('scripts/site_build.js');
    run('_ops/validators/validate_search_metadata_contract.js');
    // A resting run must not change statuses or descriptions a second time.
    const stable = fs.readFileSync(manifestPath, 'utf8');
    run('scripts/publishing/run_safe_publish.mjs');
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), stable);
    const repaired = run('scripts/search/apply_search_metadata.js');
    assert.match(repaired.stdout, /0 rewritten/);
    console.log(`Release metadata regression OK: incumbent-priority fixture held ${fixturePages - 1} queued page(s) and left the live one untouched; ${eligible.length} queued calendar items examined, ${released.length} safe releases, ${skipped} held with their records untouched; public metadata valid, human gate preserved, repeat release idempotent.`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
module.exports = { verifyReleaseMetadata, verifyIncumbentPriority };
if (require.main === module) verifyReleaseMetadata();
