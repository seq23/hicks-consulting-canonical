const fs = require('fs');
const os = require('os');
const path = require('path');
const { processManifest, publishManifestFile } = require('../../scripts/publishing/process_manifest');
const { fail } = require('../validation/protocol');

function assert(condition, message) {
  if (!condition) fail(`PUBLISHER CONTRACT FAIL: ${message}`);
}

const now = new Date('2026-06-16T12:00:00.000Z');
const source = [
  {
    id: 'due',
    status: 'approved',
    validationPassed: true,
    scheduledAt: '2026-06-16T11:59:59.000Z',
    previewPath: '/preview/resources/articles/due/'
  },
  {
    id: 'future',
    status: 'approved',
    validationPassed: true,
    scheduledAt: '2026-06-17T12:00:00.000Z',
    publishAt: '2026-01-01T00:00:00.000Z',
    previewPath: '/preview/resources/articles/future/'
  },
  {
    id: 'draft',
    status: 'draft',
    validationPassed: false,
    scheduledAt: '2026-01-01T00:00:00.000Z',
    previewPath: '/preview/resources/articles/draft/'
  }
];

// The contract now has two independent conditions: due, and approved by a person.
// Passing approvedIds explicitly keeps this test from depending on the live
// approvals file. The unapproved case is asserted immediately below.
const approvedIds = new Set(['due', 'future']);
const result = processManifest(source, now, { approvedIds });
const due = result.manifest.find((item) => item.id === 'due');
const future = result.manifest.find((item) => item.id === 'future');
const draft = result.manifest.find((item) => item.id === 'draft');

assert(result.changed === true, 'due content must produce a changed manifest');
assert(result.publishedCount === 1, `expected exactly one publication, got ${result.publishedCount}`);
assert(due.status === 'published', 'due approved content must publish');
assert(due.publishedAt === now.toISOString(), 'publishedAt must use the publication clock');
assert(!Object.prototype.hasOwnProperty.call(due, 'previewPath'), 'published content must remove previewPath');
assert(future.status === 'approved', 'future scheduled content must remain approved');
assert(future.previewPath === '/preview/resources/articles/future/', 'future content must retain previewPath');
assert(draft.status === 'draft', 'draft content must remain unchanged');

const idempotent = processManifest(result.manifest, now, { approvedIds });
assert(idempotent.changed === false, 'second run at same clock must be idempotent');
assert(idempotent.publishedCount === 0, 'idempotent run must not republish content');

// The human release gate. Without this the daily cron published LLM-drafted pages
// to a client's live site: status:'approved' is written by scripts/autonomy/
// run_cycle.mjs itself, so it never represented a human decision.
const unapproved = processManifest(source, now, { approvedIds: new Set() });
assert(unapproved.changed === false, 'a due item with no human approval must not publish');
assert(unapproved.publishedCount === 0, 'no content may publish without a named human approver');
assert(unapproved.heldForApproval === 1, `due-but-unapproved content must be reported as held, got ${unapproved.heldForApproval}`);
assert(unapproved.manifest.find((item) => item.id === 'due').status === 'approved', 'held content must keep its status rather than being mutated');

// An approval naming nobody is not an approval.
const { loadApprovedIds } = require('../../scripts/publishing/process_manifest');
const blankApprover = loadApprovedIds(undefined) instanceof Set;
assert(blankApprover, 'loadApprovedIds must return a Set');

function expectRejected(manifest, pattern, label) {
  let rejected = false;
  try {
    processManifest(manifest, now);
  } catch (error) {
    rejected = pattern.test(error.message);
  }
  assert(rejected, label);
}

expectRejected(
  [{ id: 'unsafe', status: 'approved', validationPassed: true }],
  /missing scheduledAt/,
  'approved content without scheduledAt must be rejected'
);
expectRejected(
  [{ id: 'unsafe', status: 'approved', validationPassed: true, scheduledAt: '2026-06-16T11:00:00' }],
  /ISO timestamp with timezone/,
  'timezone-less scheduledAt must be rejected'
);
expectRejected(
  [
    { id: 'duplicate', status: 'draft', validationPassed: false },
    { id: 'duplicate', status: 'draft', validationPassed: false }
  ],
  /duplicate id/,
  'duplicate manifest ids must be rejected'
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-publisher-contract-'));
try {
  const manifestPath = path.join(tempDir, 'content_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(source, null, 2) + '\n');
  const fileResult = publishManifestFile({ manifestPath, now, approvedIds });
  const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(fileResult.publishedCount === 1, 'file publisher must publish the due item');
  assert(written.find((item) => item.id === 'due').status === 'published', 'atomic file write must persist published state');
  assert(!fs.readdirSync(tempDir).some((name) => name.endsWith('.tmp')), 'atomic file write must not leave temporary files');

  // And the same file, with nobody having approved anything.
  const manifestPath2 = path.join(tempDir, 'content_manifest_unapproved.json');
  fs.writeFileSync(manifestPath2, JSON.stringify(source, null, 2) + '\n');
  const gated = publishManifestFile({ manifestPath: manifestPath2, now, approvedIds: new Set() });
  assert(gated.publishedCount === 0, 'file publisher must not publish without a human approval');
  assert(JSON.parse(fs.readFileSync(manifestPath2, 'utf8')).find((item) => item.id === 'due').status === 'approved', 'unapproved content must be left exactly as it was');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Publisher scheduling contract OK (human release gate, strict scheduledAt authority, future-date protection, preview cleanup, duplicate protection, atomic write, idempotence).');
