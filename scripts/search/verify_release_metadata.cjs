'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

// Run the real publisher against the queued calendar, never the working tree.
function verifyReleaseMetadata() {
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
    let skipped = 0;
    for (const row of after) {
      const original = before.find((item) => item.id === row.id);
      if (row.status === 'skipped_unsafe' && original.status !== row.status) {
        skipped++;
        assert.ok(row.skipReason?.length && row.validationPassed === false, 'Unsafe metadata needs a recorded reason and cannot remain eligible.');
      }
      if (row.status !== 'published' && row.status !== 'skipped_unsafe' && pages.has(row.id)) {
        const file = path.join(root, 'pages', (row.publicPath || row.slug).replace(/^\//, ''), 'index.html');
        assert.equal(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, pages.get(row.id), 'Unapproved and future-only page source changed.');
        assert.equal(row.status, original.status);
      }
    }
    run('scripts/navigation/build_internal_navigation.mjs');
    run('scripts/site_build.js');
    run('_ops/validators/validate_search_metadata_contract.js');
    // A resting run must not change statuses or descriptions a second time.
    const stable = fs.readFileSync(manifestPath, 'utf8');
    run('scripts/publishing/run_safe_publish.mjs');
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), stable);
    const repaired = run('scripts/search/apply_search_metadata.js');
    assert.match(repaired.stdout, /0 rewritten/);
    console.log(`Release metadata regression OK: ${eligible.length} queued calendar items examined, ${released.length} safe releases, ${skipped} explicitly recorded unsafe skips; public metadata valid, human gate preserved, repeat release idempotent.`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
module.exports = { verifyReleaseMetadata };
if (require.main === module) verifyReleaseMetadata();
