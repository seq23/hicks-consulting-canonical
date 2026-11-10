// validate:site-intent-preservation (restored 10 Nov 2026, hostile review: undeclared-owner-addition only).
// An element carrying data-owner-addition="<marker>" is copy the site owner added on top of the
// client's page. Every marker on a protected page must be declared in that page's ownerAdditions
// (data/system/source_preservation_manifest.json) with who decided and why, so nothing is added to
// a client's page without a recorded decision.
const fs = require('fs');
const { fail } = require('../../validation/protocol');
const preservation=JSON.parse(fs.readFileSync('data/system/source_preservation_manifest.json','utf8'));
const pages=preservation.protectedNavPages||[];
if(!pages.length) fail('site-intent: source_preservation_manifest.json lists no protected pages; nothing was checked.');
const errors=[];
let markers=0;
for(const page of pages){
  if(!fs.existsSync(page.path)){errors.push(`missing:${page.path}`);continue;}
  const declared=new Set((page.ownerAdditions||[]).filter(a=>a&&a.marker&&String(a.decided_by||'').trim()&&String(a.reason||'').trim()).map(a=>a.marker));
  for(const m of fs.readFileSync(page.path,'utf8').matchAll(/data-owner-addition=["']([^"']+)["']/gi)){ markers++; if(!declared.has(m[1])) errors.push(`undeclared-owner-addition:${page.path}:${m[1]}`); }
}
if(errors.length) fail(errors);
console.log(`Site intent OK (${pages.length} protected pages; ${markers} owner-addition marker(s), every one declared with who decided and why).`);
