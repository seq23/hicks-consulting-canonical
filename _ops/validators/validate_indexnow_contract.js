const { fs, path, fail, exists, read } = require('./util');

const root = process.cwd();
const pkg = JSON.parse(read('package.json'));
const requiredScripts = ['indexnow:emit', 'indexnow:submit', 'gsc:reindex-queue', 'validate:indexnow', 'validate:profile:indexnow'];
for (const script of requiredScripts) {
  if (!pkg.scripts || !pkg.scripts[script]) fail(`IndexNow contract fail: package.json missing script ${script}`);
}

const requiredFiles = [
  'scripts/indexnow_emit.js',
  'scripts/indexnow_submit.js',
  'scripts/gsc_reindex_queue.js',
  '.github/workflows/indexnow-submit.yml'
];
for (const file of requiredFiles) {
  if (!exists(file)) fail(`IndexNow contract fail: missing ${file}`);
}

const build = read('scripts/build/build.js');
if (!/indexnow\.txt/.test(build)) fail('IndexNow contract fail: build must copy root indexnow.txt into dist for key verification.');

const workflow = read('.github/workflows/indexnow-submit.yml');
if (!/push:\s*[\s\S]*branches:\s*\[main\]/.test(workflow)) fail('IndexNow contract fail: workflow must run on push to main.');
if (!/workflow_dispatch:/.test(workflow)) fail('IndexNow contract fail: workflow must support workflow_dispatch.');
if (!/npm run build/.test(workflow)) fail('IndexNow contract fail: workflow must build before submission.');
if (!/npm run validate:all/.test(workflow)) fail('IndexNow contract fail: workflow must run validate:all before submission.');
if (!/npm run indexnow:emit/.test(workflow)) fail('IndexNow contract fail: workflow must emit IndexNow files.');
if (!/npm run validate:profile:indexnow/.test(workflow)) fail('IndexNow contract fail: workflow must validate emitted output through the registered IndexNow profile.');
if (!/npm run indexnow:submit/.test(workflow)) fail('IndexNow contract fail: workflow must submit IndexNow files.');
if (!/INDEXNOW_DRY_RUN=1 npm run indexnow:submit/.test(workflow)) fail('IndexNow contract fail: workflow must write a dry-run report when INDEXNOW_KEY is missing.');
if (!/npm run gsc:reindex-queue/.test(workflow)) fail('IndexNow contract fail: workflow must create GSC/manual reindex queue.');
if (!/actions\/upload-artifact@v4/.test(workflow)) fail('IndexNow contract fail: workflow must upload reports as artifacts.');

const emit = read('scripts/indexnow_emit.js');
if (!/indexnow-priority\.txt/.test(emit)) fail('IndexNow contract fail: emit script must write reports/indexnow-priority.txt.');
if (!/indexnow-batch\.txt/.test(emit)) fail('IndexNow contract fail: emit script must write reports/indexnow-batch.txt.');
if (!/indexnow-manifest\.json/.test(emit)) fail('IndexNow contract fail: emit script must write reports/indexnow-manifest.json.');

const submit = read('scripts/indexnow_submit.js');
if (!/api\.indexnow\.org\/indexnow/.test(submit)) fail('IndexNow contract fail: submit script must use IndexNow endpoint.');
if (!/INDEXNOW_KEY/.test(submit)) fail('IndexNow contract fail: submit script must require INDEXNOW_KEY for live submission.');
if (!/INDEXNOW_KEY_LOCATION/.test(submit)) fail('IndexNow contract fail: submit script must support INDEXNOW_KEY_LOCATION.');
if (!/indexnow\.txt/.test(submit)) fail('IndexNow contract fail: submit script must default keyLocation to /indexnow.txt.');
if (!/indexnow-submit-report\.json/.test(submit)) fail('IndexNow contract fail: submit script must write indexnow-submit-report.json.');
if (!/INDEXNOW_DRY_RUN/.test(submit)) fail('IndexNow contract fail: submit script must support INDEXNOW_DRY_RUN.');
if (!/dist.*indexnow\.txt/s.test(submit)) fail('IndexNow contract fail: submit script must verify dist/indexnow.txt before live submission.');

const queue = read('scripts/gsc_reindex_queue.js');
if (!/search-reindex-queue\.json/.test(queue)) fail('IndexNow contract fail: GSC queue script must write search-reindex-queue.json.');
if (!/manualRequestIndexingRecommended/.test(queue)) fail('IndexNow contract fail: GSC queue must flag manual request-indexing recommendations.');
if (!/indexNowStatus/.test(queue)) fail('IndexNow contract fail: GSC queue must include IndexNow status, not only a boolean.');

// Artifact checks are strict only after emit/build has generated files. This validator is also run pre-build in existing workflows.
const priorityPath = path.join(root, 'reports', 'indexnow-priority.txt');
const batchPath = path.join(root, 'reports', 'indexnow-batch.txt');
if (fs.existsSync(priorityPath) || fs.existsSync(batchPath)) {
  if (!fs.existsSync(priorityPath)) fail('IndexNow contract fail: batch exists but priority file missing.');
  if (!fs.existsSync(batchPath)) fail('IndexNow contract fail: priority exists but batch file missing.');
  const urls = fs.readFileSync(batchPath, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!urls.length) fail('IndexNow contract fail: batch file has no URLs.');
  const invalid = urls.filter(url => !/^https:\/\/www\.hicksconsulting\.org\//.test(url));
  if (invalid.length) fail(`IndexNow contract fail: non-canonical URLs in batch file: ${invalid.slice(0, 5).join(', ')}`);
}

console.log('IndexNow contract OK');
