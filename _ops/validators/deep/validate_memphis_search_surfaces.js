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
// The localized high-intent landing pages.
//
// Eight measured "near me" searches had no page written for them. They are
// answered by five localized pages, written in August 2026 and released by the
// site owner on 2026-08-29.
//
// They were originally parked under /resources/guides/, for one reason:
// scripts/site_build.js prunes any /resources/ route whose manifest status is
// not "published", so that route family was the only place this repo could hold
// a finished page privately. Once the owner published them the mechanism had
// nothing left to do, and the route family was wrong on the merits anyway -
// these are localized service landing pages, the same kind of page as the two
// checked above, which are the two pages on this site that actually hold
// citations. They now sit on top-level routes and are checked to the same
// standard, including the thing that makes a published page real rather than
// nominal: it is in the sitemap AND something links to it.
//
// Nothing was ever published at the old /resources/guides/ paths, so no redirect
// is owed; that is asserted below rather than assumed.
const manifest=JSON.parse(fs.readFileSync('data/admin/content_manifest.json','utf8'));
const byRoute=new Map(manifest.map(item=>[String(item.publicPath||item.slug||''),item]));
const localized=[
  {route:'/therapist-near-me-memphis/',id:'guide-local-nearme-001',former:'/resources/guides/therapist-near-me-memphis/',must:[/therapist near me/i,/Memphis/i,/Tennessee/i,/virtual/i]},
  {route:'/female-therapist-memphis/',id:'guide-local-female-001',former:'/resources/guides/female-therapist-memphis/',must:[/female therapist/i,/Memphis/i,/Tennessee/i,/virtual/i]},
  {route:'/christian-therapist-memphis/',id:'guide-local-christian-001',former:'/resources/guides/christian-therapist-memphis/',must:[/christian therapist/i,/faith/i,/Memphis/i,/Tennessee/i]},
  {route:'/psychologist-vs-therapist-memphis/',id:'guide-local-psychologist-001',former:'/resources/guides/psychologist-vs-therapist-memphis/',must:[/psychologist/i,/Licensed Clinical Social Worker/i,/Memphis/i,/Tennessee/i]},
  {route:'/therapist-olive-branch-ms/',id:'guide-local-olivebranch-001',former:'/resources/guides/therapist-olive-branch-ms/',must:[/Olive Branch/i,/Mississippi/i,/Memphis/i,/Tennessee/i]},
];

// Every page source, once, so inbound-link counting is a fact rather than a
// guess. A published page nothing links to is inert whatever the sitemap says.
const allPageSources=[];
(function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=`${dir}/${entry.name}`;
    if(entry.isDirectory()) walk(full);
    else if(entry.name==='index.html') allPageSources.push(full);
  }
})('pages');

for(const page of localized){
  const file=`pages${page.route}index.html`;
  const item=byRoute.get(page.route);
  if(!item){errors.push(`unregistered-in-manifest:${page.route}`);continue;}
  if(!fs.existsSync(file)){errors.push(`missing:${file}`);continue;}
  // The old resources route must be gone from the tree and from the sitemap.
  if(fs.existsSync(`pages${page.former}index.html`)) errors.push(`old-route-still-present:${page.former}`);
  if(sitemap.includes(`https://www.hicksconsulting.org${page.former}`)) errors.push(`old-route-in-sitemap-needs-a-redirect:${page.former}`);
  const html=fs.readFileSync(file,'utf8');
  if((html.match(/<h1\b/gi)||[]).length!==1) errors.push(`h1-count:${page.route}`);
  // validate_agency_quality.js requires an approved item's h1 to equal its
  // manifest title; assert it here too so the pair cannot silently drift.
  const h1=(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||['',''])[1].replace(/<[^>]+>/g,'').trim();
  if(h1!==item.title) errors.push(`h1-title-drift:${page.route}`);
  if(!new RegExp(`rel=["']canonical["'][^>]+${page.route.replace(/\//g,'\\/')}`,'i').test(html)&&!new RegExp(`${page.route.replace(/\//g,'\\/')}[^>]+rel=["']canonical["']`,'i').test(html)) errors.push(`canonical:${page.route}`);
  if(/noindex/i.test((html.match(/<meta[^>]+name=["']robots["'][^>]*>/i)||[''])[0])) errors.push(`noindex:${page.route}`);
  for(const pattern of page.must) if(!pattern.test(html)) errors.push(`missing-copy:${page.route}:${pattern}`);
  if(!/clientsecure\.me/i.test(html)) errors.push(`missing-consult-path:${page.route}`);
  if(!/application\/ld\+json/i.test(html)) errors.push(`missing-schema:${page.route}`);
  if(!/emergency-crisis-notice/.test(html)) errors.push(`missing-crisis-notice:${page.route}`);
  if(!/short-answer/.test(html)) errors.push(`missing-short-answer:${page.route}`);
  // The breadcrumb must describe where the page actually is. Left alone, these
  // carried Home > Resources > Guides > page, pointing a reader and a crawler at
  // a library the page is no longer in.
  if(/"name": ?"Guides"/.test(html)||html.includes('<li><a href="/resources/guides/">Guides</a></li><li aria-current')) errors.push(`stale-resources-breadcrumb:${page.route}`);

  if(item.status==='published'){
    // Published means published: in the sitemap, and reachable.
    if(!sitemap.includes(`https://www.hicksconsulting.org${page.route}`)) errors.push(`published-but-missing-from-sitemap:${page.route}`);
    const inbound=allPageSources.filter(f=>f!==file&&fs.readFileSync(f,'utf8').includes(`href="${page.route}"`)).length;
    if(inbound<2) errors.push(`published-but-only-${inbound}-internal-link(s)-point-at-it:${page.route}`);
    // A page the owner published without the client's approval must say so in
    // the record, naming who did it and why. Never Monika's name on a decision
    // she did not make.
    const owner=item.ownerPublication||null;
    if(!owner||!String(owner.publishedBy||'').trim()) errors.push(`published-with-no-named-publisher:${page.route}`);
    else if(!String(owner.reason||'').trim()) errors.push(`owner-publication-with-no-reason:${page.route}`);
    else if(!/^none\b/i.test(String(owner.clientApproval||''))) errors.push(`owner-publication-must-state-that-no-client-approval-was-given:${page.route}`);
  }else{
    // Still unpublished. The approval requirement must be carried by the item,
    // not by a distant date: these six were previously held out of the standing
    // window by being scheduled into 2027, which delayed finished work by four
    // months for a reason that has nothing to do with when it runs.
    if(item.requiresIndividualApproval!==true) errors.push(`unpublished-without-an-individual-approval-requirement:${page.route}`);
    if(sitemap.includes(`https://www.hicksconsulting.org${page.route}`)) errors.push(`unpublished-but-in-sitemap:${page.route}`);
  }
}
if(!localized.length) errors.push('no-localized-pages-examined -- this check is inert');
if(errors.length) fail(errors);
console.log(`Memphis search surfaces OK (2 indexable service pages plus ${localized.length} localized local-intent landing pages on top-level routes; canonical/schema/crisis/consult path/breadcrumb checked on all, published ones proved present in the sitemap with >=2 inbound internal links and a named owner publication carrying a reason, old /resources/guides/ routes proved gone).`);
