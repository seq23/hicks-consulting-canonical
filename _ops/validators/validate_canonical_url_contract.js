const { fs, path, fail } = require('./util');
function walk(dir, arr=[]){ for(const e of fs.readdirSync(dir)){ const p=path.join(dir,e); const s=fs.statSync(p); if(s.isDirectory()) walk(p,arr); else if(e==='index.html') arr.push(p);} return arr; }
for(const file of walk(path.join(process.cwd(),'pages'))){ const html=fs.readFileSync(file,'utf8'); if(!html.includes('https://www.hicksconsulting.org')) fail(`Missing canonical domain in ${file}`); }
console.log('Canonical URLs OK');
