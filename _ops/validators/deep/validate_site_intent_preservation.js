const fs = require('fs');
const { fail } = require('../../validation/protocol');

function text(html) {
  return String(html).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/gi,' ').replace(/\s+/g,' ').trim();
}
function mainHtml(html){ return (String(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)||[])[1] || html; }
function headings(html){ html=String(html).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' '); return [...String(html).matchAll(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m=>({level:m[1].toLowerCase(),text:text(m[2])})); }
function navLinks(html){ const nav=(String(html).match(/<nav\b[^>]*(?:id=["']site-navigation["'])?[^>]*>([\s\S]*?)<\/nav>/i)||[])[1]||''; return [...nav.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(m=>m[1]); }
function tokens(value){ return String(value).toLowerCase().match(/[a-z0-9'-]+/g)||[]; }
function similarity(a,b){ const A=tokens(a),B=tokens(b); const ca=new Map(),cb=new Map(); for(const x of A)ca.set(x,(ca.get(x)||0)+1); for(const x of B)cb.set(x,(cb.get(x)||0)+1); let common=0; for(const [k,v] of ca)common+=Math.min(v,cb.get(k)||0); return common/Math.max(A.length,B.length,1); }

// Owner additions (11 Oct 2026): an element carrying data-owner-addition="<marker>"
// is new copy the site owner added on top of the client's page. It is removed
// before the heading and copy comparison, so the client's original headings,
// nav and copy stay pinned at full strictness; every marker on a page must be
// declared in that page's ownerAdditions with who decided and why.
function stripOwnerAdditions(html, page, errors){
  const declared=new Set((page.ownerAdditions||[]).filter(a=>a&&a.marker&&String(a.decided_by||'').trim()&&String(a.reason||'').trim()).map(a=>a.marker));
  let out=String(html);
  for(const tag of ['section','div','p']){
    out=out.replace(new RegExp(`<${tag}\\b[^>]*data-owner-addition=["']([^"']+)["'][^>]*>[\\s\\S]*?<\\/${tag}>`,'gi'),(m,marker)=>{ if(!declared.has(marker)) errors.push(`undeclared-owner-addition:${page.path}:${marker}`); return ' '; });
  }
  if(/data-owner-addition=/i.test(out)) errors.push(`owner-addition-not-stripped:${page.path}`);
  return out;
}
const preservation=JSON.parse(fs.readFileSync('data/system/source_preservation_manifest.json','utf8'));
const errors=[];
for(const page of preservation.protectedNavPages||[]){
  if(!fs.existsSync(page.path)){errors.push(`missing:${page.path}`);continue;}
  const html=stripOwnerAdditions(fs.readFileSync(page.path,'utf8'),page,errors);
  const currentHeadings=headings(mainHtml(html));
  if(JSON.stringify(currentHeadings)!==JSON.stringify(page.baselineHeadings)) errors.push(`heading-shape-drift:${page.path}`);
  const currentNav=navLinks(html);
  if(JSON.stringify(currentNav)!==JSON.stringify(page.baselineNavLinks)) errors.push(`primary-nav-drift:${page.path}`);
  const score=similarity(page.baselineMainText,text(mainHtml(html)));
  if(score<0.78) errors.push(`copy-changed-too-drastically:${page.path}:${score.toFixed(3)}`);
  if(!/Memphis/i.test(html)) errors.push(`missing-memphis-context:${page.path}`);
  if(!/Black woman therapist/i.test(html)) errors.push(`missing-black-woman-therapist-context:${page.path}`);
}
if(errors.length) fail(errors);
console.log(`Site intent/preservation OK (${preservation.protectedNavPages.length} NAV pages retain headings/nav and remain >=78% baseline copy while adding requested context).`);
