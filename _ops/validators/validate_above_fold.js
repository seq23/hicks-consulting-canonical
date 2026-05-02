const { fs, path, fail } = require('./util');
function walk(dir, arr=[]){ for(const e of fs.readdirSync(dir)){ const p=path.join(dir,e); const s=fs.statSync(p); if(s.isDirectory()) walk(p,arr); else if(e==='index.html') arr.push(p);} return arr; }
for(const file of walk(path.join(process.cwd(),'pages'))){ const html=fs.readFileSync(file,'utf8'); if(html.includes('noindex,nofollow')) continue; if(!/<h1[ >]/.test(html)) fail(`Missing H1 in ${file}`); if(!html.includes('short-answer')) fail(`Missing short answer block in ${file}`); }
console.log('Above-fold contract OK');
