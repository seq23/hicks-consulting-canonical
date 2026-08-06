const fs=require('fs');
const { fail }=require('../../validation/protocol');
const pages=[
  {file:'pages/black-therapist-memphis/index.html',route:'/black-therapist-memphis/',must:[/Black (?:woman )?therapist/i,/Memphis/i,/virtual/i,/Tennessee/i]},
  {file:'pages/anxiety-therapist-memphis/index.html',route:'/anxiety-therapist-memphis/',must:[/anxiety therapist/i,/Memphis/i,/virtual/i,/Tennessee/i]}
];
const errors=[];
const sitemap=fs.readFileSync('sitemap.xml','utf8');
for(const page of pages){
  if(!fs.existsSync(page.file)){errors.push(`missing:${page.file}`);continue;}
  const html=fs.readFileSync(page.file,'utf8');
  if(/noindex/i.test((html.match(/<meta[^>]+name=["']robots["'][^>]*>/i)||[''])[0])) errors.push(`noindex:${page.route}`);
  if((html.match(/<h1\b/gi)||[]).length!==1) errors.push(`h1-count:${page.route}`);
  if(!new RegExp(`rel=["']canonical["'][^>]+${page.route.replace(/\//g,'\\/')}`, 'i').test(html) && !new RegExp(`${page.route.replace(/\//g,'\\/')}[^>]+rel=["']canonical["']`, 'i').test(html)) errors.push(`canonical:${page.route}`);
  for(const pattern of page.must) if(!pattern.test(html)) errors.push(`missing-copy:${page.route}:${pattern}`);
  if(!/clientsecure\.me/i.test(html)) errors.push(`missing-consult-path:${page.route}`);
  if(!/application\/ld\+json/i.test(html)) errors.push(`missing-schema:${page.route}`);
  if(!sitemap.includes(`https://www.hicksconsulting.org${page.route}`)) errors.push(`missing-sitemap:${page.route}`);
}
const support=['pages/therapy/index.html','pages/about/index.html','pages/resources/index.html'];
for(const page of pages){ let links=0; for(const file of support){ const html=fs.readFileSync(file,'utf8'); if(html.includes(`href="${page.route}"`)||html.includes(`href='${page.route}'`)) links+=1; } if(links<2) errors.push(`insufficient-contextual-links:${page.route}:${links}`); }
if(errors.length) fail(errors);
console.log('Memphis search surfaces OK (2 indexable service pages, canonical/schema/sitemap/consult path, and visible contextual support links).');
