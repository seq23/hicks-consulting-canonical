// validate:memphis-search-surfaces (restored 10 Nov 2026, hostile review: one rule).
// Each Memphis therapist landing page states "Tennessee" (where she is licensed) and "virtual"
// (how sessions happen), so no page implies an in-person or out-of-state service.
const fs=require('fs');
const { fail }=require('../../validation/protocol');
const routes=['black-therapist-memphis','anxiety-therapist-memphis','therapist-near-me-memphis','female-therapist-memphis','christian-therapist-memphis','psychologist-vs-therapist-memphis','therapist-olive-branch-ms'];
const errors=[];
const text=(html)=>String(html).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ');
for(const r of routes){
  const file=`pages/${r}/index.html`;
  if(!fs.existsSync(file)){errors.push(`missing:${file}`);continue;}
  const t=text(fs.readFileSync(file,'utf8'));
  if(!/Tennessee/i.test(t)) errors.push(`missing-tennessee:/${r}/`);
  if(!/virtual/i.test(t)) errors.push(`missing-virtual:/${r}/`);
}
if(errors.length) fail(errors);
console.log(`Memphis search surfaces OK (${routes.length} therapist pages state Tennessee and virtual).`);
