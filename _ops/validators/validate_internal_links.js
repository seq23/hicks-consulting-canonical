const { fs, path, fail } = require('./util');
const routes = new Set();
function walk(dir, arr=[]){ for(const e of fs.readdirSync(dir)){ const p=path.join(dir,e); const s=fs.statSync(p); if(s.isDirectory()) walk(p,arr); else if(e==='index.html') arr.push(p);} return arr; }
for(const file of walk(path.join(process.cwd(),'pages'))){ const rel='/' + path.relative(path.join(process.cwd(),'pages'), path.dirname(file)).replace(/\\/g,'/'); routes.add(rel==='/'?'/':rel+'/'); }
const allowedExternal=[];
for(const file of walk(path.join(process.cwd(),'pages'))){ const html=fs.readFileSync(file,'utf8'); const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1]); for(const href of hrefs){ if(href.startsWith('http')){ if(!href.startsWith('https://www.hicksconsulting.org') && !allowedExternal.includes(href)) fail(`Unexpected external link ${href} in ${file}`); } else if(href.startsWith('/')) { if(href.startsWith('/assets/')|| href.startsWith('/data/')) continue; let normalized=href.endsWith('/')?href:href+'/'; if(href==='/' ) normalized='/'; if(!routes.has(normalized) && !['/assets/css/styles.css/','/assets/js/site.js/','/assets/js/admin.js/'].includes(normalized)) fail(`Broken internal route ${href} in ${file}`); } }
}
console.log('Internal links OK');
