const { fs, path, fail, read } = require('./util');
const pkg = JSON.parse(read('package.json'));
const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
for (const file of files) {
  const full = path.join(workflowsDir, file);
  const content = fs.readFileSync(full, 'utf8');
  for (const match of content.matchAll(/-\s+run:\s+npm run ([A-Za-z0-9:_-]+)/g)) {
    const script = match[1];
    if (!pkg.scripts || !pkg.scripts[script]) fail(`Workflow ${file} references missing npm script: ${script}`);
  }
  if (!/uses:\s+actions\/checkout@v4/.test(content)) fail(`Workflow ${file} missing actions/checkout@v4`);
  if (!/uses:\s+actions\/setup-node@v4/.test(content)) fail(`Workflow ${file} missing actions/setup-node@v4`);
}
console.log('Workflow contracts OK');
