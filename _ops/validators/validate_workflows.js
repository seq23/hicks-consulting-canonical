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
    if (file === 'content-publish.yml') {
      const publishIndex = content.indexOf('npm run publish:content');
      const buildIndex = content.indexOf('npm run build');
      const validateIndex = content.indexOf('npm run validate:all');
      if (publishIndex === -1) fail('content-publish.yml must run npm run publish:content.');
      if (buildIndex === -1) fail('content-publish.yml must run npm run build before validation.');
      if (validateIndex === -1) fail('content-publish.yml must run npm run validate:all after build.');
      if (!(publishIndex < buildIndex && buildIndex < validateIndex)) {
        fail('content-publish.yml must publish content, run build to regenerate sitemap/llms, then run validate:all.');
      }
    }
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
