const { fs, path, fail } = require('./util');
function walk(dir, arr=[]){ for(const e of fs.readdirSync(dir)){ const p=path.join(dir,e); const s=fs.statSync(p); if(s.isDirectory()) walk(p,arr); else if(e==='index.html') arr.push(p);} return arr; }
const banned=['best therapist','top therapist','guaranteed','you have anxiety','you have depression','REPLACE_THERAPY_FORM','REPLACE_COACHING_FORM','REPLACE_CORPORATE_FORM'];
for(const file of walk(path.join(process.cwd(),'pages'))){ const html=fs.readFileSync(file,'utf8').toLowerCase(); for(const phrase of banned){ if(html.includes(phrase)) fail(`Policy phrase found: ${phrase} in ${file}`);} if(!html.includes('for informational purposes only') && !html.includes('this website is for informational purposes only')) fail(`Missing disclaimer/footer language in ${file}`); }
console.log('Policy compliance OK');
