const { fs, path, fail } = require('./util');
function walk(dir, arr=[]){ for(const e of fs.readdirSync(dir)){ const p=path.join(dir,e); const s=fs.statSync(p); if(s.isDirectory()) walk(p,arr); else if(e==='index.html') arr.push(p);} return arr; }
for(const file of walk(path.join(process.cwd(),'pages'))){
  const html=fs.readFileSync(file,'utf8');
  const rel=path.relative(process.cwd(), file);
  const isNoIndex = html.includes('noindex,nofollow');
  const isAdmin = rel.includes(`${path.sep}admin${path.sep}`);
  if(isNoIndex || isAdmin) continue;
  if(!/<h1[ >]/.test(html)) fail(`Missing H1 in ${file}`);
  if(!html.includes('short-answer')) fail(`Missing short answer block in ${file}`);
}


// Homepage above-fold dual pathway checks.
const homepage = fs.readFileSync(path.join(process.cwd(), 'pages', 'index.html'), 'utf8');
for (const token of ['Mental health support for high-achieving women and healthier organizations.', 'Work With Me (Individuals)', 'Book a Training (Organizations)', 'boundary challenges', 'luxury-fade-words', 'Grounded care.', 'Intentional healing.', 'Room to exhale.']) {
  if (!homepage.includes(token)) fail(`Homepage above-fold dual pathway token missing: ${token}`);
}

console.log('Above-fold contract OK');
