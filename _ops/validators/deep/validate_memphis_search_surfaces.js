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

// ---------------------------------------------------------------------------
// The localized high-intent guides.
//
// Eight measured "near me" searches had no page written for them. They are now
// answered by five localized guides under /resources/guides/, which is the only
// route family this repo can hold unpublished: scripts/site_build.js prunes any
// /resources/ route whose manifest status is not "published", so these stay off
// the live site until Monika approves each one by name.
//
// That is exactly why they need a guard of their own. The two checks above run
// against pages that are already live, and a check that only ever looks at the
// sitemap cannot see a page that is deliberately not in it yet - a guard that
// cannot reach what it governs. So this section is status-aware: it asserts the
// page-level facts unconditionally, and asserts sitemap membership and hub
// reachability only once the manifest says the item is published, at which
// point an unreachable page would be a real defect rather than the intended
// state.
const manifest=JSON.parse(fs.readFileSync('data/admin/content_manifest.json','utf8'));
const byRoute=new Map(manifest.map(item=>[String(item.publicPath||item.slug||''),item]));
const localized=[
  {route:'/resources/guides/therapist-near-me-memphis/',id:'guide-local-nearme-001',must:[/therapist near me/i,/Memphis/i,/Tennessee/i,/virtual/i]},
  {route:'/resources/guides/female-therapist-memphis/',id:'guide-local-female-001',must:[/female therapist/i,/Memphis/i,/Tennessee/i,/virtual/i]},
  {route:'/resources/guides/christian-therapist-memphis/',id:'guide-local-christian-001',must:[/christian therapist/i,/faith/i,/Memphis/i,/Tennessee/i]},
  {route:'/resources/guides/psychologist-vs-therapist-memphis/',id:'guide-local-psychologist-001',must:[/psychologist/i,/Licensed Clinical Social Worker/i,/Memphis/i,/Tennessee/i]},
  {route:'/resources/guides/therapist-olive-branch-ms/',id:'guide-local-olivebranch-001',must:[/Olive Branch/i,/Mississippi/i,/Memphis/i,/Tennessee/i]},
];
const hub=fs.readFileSync('pages/resources/guides/index.html','utf8');
for(const page of localized){
  const file=`pages${page.route}index.html`;
  const item=byRoute.get(page.route);
  if(!item){errors.push(`unregistered-in-manifest:${page.route}`);continue;}
  if(!fs.existsSync(file)){errors.push(`missing:${file}`);continue;}
  const html=fs.readFileSync(file,'utf8');
  if((html.match(/<h1\b/gi)||[]).length!==1) errors.push(`h1-count:${page.route}`);
  // validate_agency_quality.js requires an approved item's h1 to equal its
  // manifest title; assert it here too so the pair cannot silently drift.
  const h1=(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||['',''])[1].replace(/<[^>]+>/g,'').trim();
  if(h1!==item.title) errors.push(`h1-title-drift:${page.route}`);
  if(!new RegExp(`rel=["']canonical["'][^>]+${page.route.replace(/\//g,'\\/')}`,'i').test(html)&&!new RegExp(`${page.route.replace(/\//g,'\\/')}[^>]+rel=["']canonical["']`,'i').test(html)) errors.push(`canonical:${page.route}`);
  for(const pattern of page.must) if(!pattern.test(html)) errors.push(`missing-copy:${page.route}:${pattern}`);
  if(!/clientsecure\.me/i.test(html)) errors.push(`missing-consult-path:${page.route}`);
  if(!/application\/ld\+json/i.test(html)) errors.push(`missing-schema:${page.route}`);
  if(!/emergency-crisis-notice/.test(html)) errors.push(`missing-crisis-notice:${page.route}`);
  if(!/short-answer/.test(html)) errors.push(`missing-short-answer:${page.route}`);
  // Approval gate. These pages were written for searches Monika has never seen
  // a page for, so they may not ride the standing editorial approval, whose
  // window closes 2026-12-31. Scheduling one inside that window would publish it
  // without a decision from her.
  if(item.scheduledAt&&Date.parse(item.scheduledAt)<=Date.parse('2026-12-31T23:59:59.999Z')&&item.status!=='published') errors.push(`inside-standing-approval-window:${page.route}:${item.scheduledAt}`);
  if(item.status==='published'){
    if(!sitemap.includes(`https://www.hicksconsulting.org${page.route}`)) errors.push(`published-but-missing-from-sitemap:${page.route}`);
    if(!hub.includes('guides-published')) errors.push(`guides-hub-missing-generated-list-container`);
  }else if(sitemap.includes(`https://www.hicksconsulting.org${page.route}`)){
    errors.push(`unpublished-but-in-sitemap:${page.route}`);
  }
}
if(errors.length) fail(errors);
console.log(`Memphis search surfaces OK (2 indexable service pages plus ${localized.length} localized high-intent guides; canonical/schema/crisis/consult path checked on all, sitemap and hub reachability checked against publication status, approval window enforced).`);
