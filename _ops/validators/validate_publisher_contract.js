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

const result = processManifest(source, now);
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

const idempotent = processManifest(result.manifest, now);
assert(idempotent.changed === false, 'second run at same clock must be idempotent');
assert(idempotent.publishedCount === 0, 'idempotent run must not republish content');

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
  const fileResult = publishManifestFile({ manifestPath, now });
  const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(fileResult.publishedCount === 1, 'file publisher must publish the due item');
  assert(written.find((item) => item.id === 'due').status === 'published', 'atomic file write must persist published state');
  assert(!fs.readdirSync(tempDir).some((name) => name.endsWith('.tmp')), 'atomic file write must not leave temporary files');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Publisher scheduling contract OK (strict scheduledAt authority, future-date protection, preview cleanup, duplicate protection, atomic write, idempotence).');
