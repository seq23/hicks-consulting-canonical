const { fs, path, fail, read } = require('./util');
const pkg = JSON.parse(read('package.json'));
const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
const writeWorkflows = [];
for (const file of files) {
  const full = path.join(workflowsDir, file);
  const content = fs.readFileSync(full, 'utf8');
  for (const match of content.matchAll(/-\s+run:\s+npm run ([A-Za-z0-9:_-]+)/g)) {
    const script = match[1];
    if (!pkg.scripts || !pkg.scripts[script]) fail(`Workflow ${file} references missing npm script: ${script}`);
  }
  if (!/uses:\s+actions\/checkout@v4/.test(content)) fail(`Workflow ${file} missing actions/checkout@v4`);
  if (!/uses:\s+actions\/setup-node@v4/.test(content)) fail(`Workflow ${file} missing actions/setup-node@v4`);
  const writes = /permissions:[\s\S]*contents:\s*write/.test(content) || /git\s+push/.test(content);
  if (writes) {
    writeWorkflows.push(file);
    if (!/concurrency:[\s\S]*group:\s*hicks-consulting-content-automation/.test(content)) {
      fail(`Writer workflow ${file} must use shared hicks-consulting-content-automation concurrency group.`);
    }
    if (!/git pull --rebase origin main/.test(content)) {
      fail(`Writer workflow ${file} must pull latest main before mutating generated outputs.`);
    }
  }
}
if (writeWorkflows.length < 2) fail('Expected content-publish and social-ingestion writer workflows to be present.');
console.log(`Workflow contracts OK (${files.length} workflows, ${writeWorkflows.length} writer workflows traced).`);

{
  const fsWorkflow = require('fs');
  const workflowText = fsWorkflow.readFileSync('.github/workflows/content-publish.yml', 'utf8');
  function workflowFail(message) {
    console.error(`Workflow contract failed: ${message}`);
    process.exit(1);
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
