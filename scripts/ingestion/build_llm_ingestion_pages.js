const fs = require('fs');
const path = require('path');
const root = process.cwd();
const required = [
  'pages/llm-atlas/index.html','pages/llm-atlas/fanouts/index.html','pages/llm-atlas/queries/index.html','pages/llm-atlas/pillars/index.html','pages/llm-atlas/clusters/index.html','pages/llm-atlas/social-signals/index.html','pages/llm-atlas/source-health/index.html','pages/llm-atlas/answer-surfaces/index.html'
];
const missing = required.filter(file => !fs.existsSync(path.join(root,file)));
if (missing.length) { console.error(`Missing LLM ingestion pages: ${missing.join(', ')}`); process.exit(1); }
console.log('LLM ingestion pages present.');
