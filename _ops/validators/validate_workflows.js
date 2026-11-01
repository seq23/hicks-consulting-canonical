const { fs, path, fail, read, exists } = require('./util');
const pkg = JSON.parse(read('package.json'));
const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
const writeWorkflows = [];

const registry = JSON.parse(read('_repo_validation_registry.json'));
const leafScripts = new Set(registry.checks.map((check) => check.npmScript));

for (const file of files) {
  const full = path.join(workflowsDir, file);
  const content = fs.readFileSync(full, 'utf8');
  for (const match of content.matchAll(/-\s+run:\s+npm run ([A-Za-z0-9:_-]+)/g)) {
    const script = match[1];
    if (!pkg.scripts || !pkg.scripts[script]) fail(`Workflow ${file} references missing npm script: ${script}`);
    if (leafScripts.has(script)) fail(`Workflow ${file} invokes leaf validator ${script} directly; use a registered validation profile.`);
  }
  // A caller of the shared search-loop engine runs no steps of its own: the
  // engine's reusable workflow checks out and sets up node. It must be pinned
  // to @v1 with engine_ref v1, so an unpinned or moving engine never runs here.
  const engineCaller = /^\s+uses:\s*seq23\/search-loop\/\.github\/workflows\/search-loop\.yml@/m.test(content);
  if (engineCaller) {
    if (!/^\s+uses:\s*seq23\/search-loop\/\.github\/workflows\/search-loop\.yml@v1\s*$/m.test(content)) fail(`Workflow ${file} calls the search-loop engine but is not pinned to @v1`);
    if (!/^\s+engine_ref:\s*v1\s*$/m.test(content)) fail(`Workflow ${file} calls the search-loop engine without engine_ref: v1`);
    if (/^\s+steps:\s*$/m.test(content)) fail(`Workflow ${file} calls the search-loop engine and also runs steps; keep the caller to the one reusable call`);
  } else {
    if (!/uses:\s+actions\/checkout@v\d+/.test(content)) fail(`Workflow ${file} missing actions/checkout`);
    if (!/uses:\s+actions\/setup-node@v\d+/.test(content)) fail(`Workflow ${file} missing actions/setup-node`);
  }
  const writes = /permissions:[\s\S]*contents:\s*write/.test(content) || /git\s+push/.test(content);
  if (writes) {
    writeWorkflows.push(file);
    if (!/concurrency:[\s\S]*group:\s*hicks-consulting-content-automation/.test(content)) {
      fail(`Writer workflow ${file} must use shared hicks-consulting-content-automation concurrency group.`);
    }
    // An engine caller mutates through its commit_command script; that script must pull.
    const commitScript = (content.match(/^\s+commit_command:\s*bash\s+(\S+)\s*$/m) || [])[1];
    const pullsIn = engineCaller
      ? Boolean(commitScript) && fs.existsSync(path.join(process.cwd(), commitScript)) && /git pull --rebase --autostash origin main/.test(fs.readFileSync(path.join(process.cwd(), commitScript), 'utf8'))
      : /git pull --rebase origin main/.test(content);
    if (!pullsIn) {
      fail(`Writer workflow ${file} must pull latest main before mutating generated outputs.`);
    }
  }
}
if (writeWorkflows.length < 2) fail('Expected content-publish and social-ingestion writer workflows to be present.');

const buildWorkflow = fs.readFileSync(path.join(workflowsDir, 'build.yml'), 'utf8');
const buildStep = buildWorkflow.indexOf('npm run build');
const validateStep = buildWorkflow.indexOf('npm run validate:all');
if (buildStep === -1 || validateStep === -1 || buildStep > validateStep) {
  fail('build.yml must build before validate:all so dist-aware checks inspect the current output.');
}

// A workflow GitHub still lists as active but that no ref defines is invisible from
// inside the repository - `gh workflow list` showed "ChatGPT Baseline Package" for a
// month after its file was deleted, and nothing on disk could say whether it was a
// deliberately manual lane or a dead one. config/retired_workflows.json is where that
// question is answered, and this keeps the answer honest in the one direction a file
// of prose can drift: an entry may not claim a workflow is gone while its file is
// sitting in .github/workflows.
const retiredPath = 'config/retired_workflows.json';
if (!exists(retiredPath)) fail(`${retiredPath} is missing; retired workflow names have nowhere to be recorded and nothing distinguishes a manual lane from a dead one.`);
let retired;
try { retired = JSON.parse(read(retiredPath)); }
catch (error) { fail(`${retiredPath} is not valid JSON: ${error.message}`); }
if (!Array.isArray(retired.workflows)) fail(`${retiredPath} must carry a workflows array.`);
const fileSet = new Set(files);
for (const entry of retired.workflows) {
  for (const field of ['name', 'path', 'decision', 'reason', 'decidedOn', 'decidedBy']) {
    if (!entry[field]) fail(`${retiredPath}: entry ${entry.name || '(unnamed)'} is missing ${field}. An unexplained retirement is indistinguishable from an oversight.`);
  }
  if (!['RETIRED_ONE_OFF', 'MANUAL_ONLY', 'SUPERSEDED'].includes(entry.decision)) {
    fail(`${retiredPath}: entry ${entry.name} carries unknown decision "${entry.decision}".`);
  }
  const base = String(entry.path || '').split('/').pop();
  if (entry.decision !== 'MANUAL_ONLY' && fileSet.has(base)) {
    fail(`${retiredPath}: ${entry.name} is recorded as ${entry.decision} but .github/workflows/${base} exists on disk. The record and the repository disagree.`);
  }
  if (entry.decision === 'MANUAL_ONLY' && !fileSet.has(base)) {
    fail(`${retiredPath}: ${entry.name} is recorded as MANUAL_ONLY but .github/workflows/${base} does not exist. A manual lane needs a file to invoke.`);
  }
}

console.log(`Workflow contracts OK (${files.length} workflows, ${writeWorkflows.length} writer workflows traced; `
  + `${retired.workflows.length} name(s) GitHub still lists with no file behind them, each recorded in ${retiredPath} with a decision - `
  + `${retired.workflows.map((entry) => `${entry.name}=${entry.decision}`).join(', ') || 'none'}).`);

{
  const fsWorkflow = require('fs');
  const workflowText = fsWorkflow.readFileSync('.github/workflows/content-publish.yml', 'utf8');
  function workflowFail(message) {
    fail(`Workflow contract failed: ${message}`);
  }

  for (const marker of ['push:', 'branches:', '- main', 'paths:', "data/admin/content_manifest.json"]) {
    if (!workflowText.includes(marker)) workflowFail(`content-publish.yml missing manifest push trigger marker: ${marker}`);
  }

  if (!workflowText.includes('permissions:') || !workflowText.includes('contents: write')) {
    workflowFail('content-publish.yml must grant contents: write permission.');
  }

  if (!workflowText.includes('concurrency:')) {
    workflowFail('content-publish.yml must define concurrency.');
  }

  const publishIndex = workflowText.indexOf('npm run publish:content');
  const buildIndex = workflowText.indexOf('npm run build');
  const validateIndex = workflowText.indexOf('npm run validate:all');
  const commitIndex = workflowText.indexOf('Commit published status changes');

  if (publishIndex === -1) workflowFail('content-publish.yml missing npm run publish:content.');
  if (buildIndex === -1) workflowFail('content-publish.yml missing npm run build.');
  if (validateIndex === -1) workflowFail('content-publish.yml missing npm run validate:all.');
  if (commitIndex === -1) workflowFail('content-publish.yml missing Commit published status changes step.');

  if (!(publishIndex < buildIndex && buildIndex < validateIndex && validateIndex < commitIndex)) {
    workflowFail('content-publish.yml must run publish:content before build before validate:all before commit.');
  }
}
