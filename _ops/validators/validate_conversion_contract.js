const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');
const config=JSON.parse(fs.readFileSync('data/system/config.json','utf8'));
const forms=config.forms || {};
const allowed = new Set([forms.therapy, forms.coaching, forms.corporate, forms.groups, '/intake-quiz/', '/request-consult/', '/book-discovery-call/', '/organizational-training-inquiry/'].filter(Boolean));
const qmap=JSON.parse(fs.readFileSync('data/query_coverage_map.json','utf8'));
for(const item of qmap){
  if(!item.ctaTarget) fail(`Query missing ctaTarget: ${item.query}`);
  const target=item.ctaTarget;
  const internal=target.startsWith('/');
  if(!allowed.has(target) && !internal) fail(`Unapproved external ctaTarget: ${target}`);
  if(internal){
    const page=path.join('pages', target.replace(/^\//,'').replace(/\/$/,''), 'index.html');
    if(!fs.existsSync(page)) fail(`ctaTarget internal page missing: ${target}`);
  }
}
const moneyPages=['/therapy/','/coaching/','/groups/','/corporate-speaking/','/intake-quiz/','/request-consult/','/book-discovery-call/'];
for(const route of moneyPages){
  const page=path.join('pages', route.replace(/^\//,'').replace(/\/$/,''), 'index.html');
  if(!fs.existsSync(page)) continue;
  const html=fs.readFileSync(page,'utf8');
  const hasAllowed=[...allowed].some(url => url && html.includes(url));
  if(!hasAllowed) fail(`${route} missing approved conversion path.`);
}


// Homepage dual-pathway contract: individual healing and organizational training must remain visibly separated.
const homepage = fs.readFileSync('pages/index.html', 'utf8');
// Behaviour, not wording (client-approved rewrite, 17 Nov 2026): both pathways, both CTAs, the
// booking link, the training inquiry route and the six signature trainings by name.
const homepageRequired = [
  'Work With Me (Individuals)',
  'Book a Training (Organizations)',
  'For Individuals Seeking Healing &amp; Support',
  'For Organizations &amp; Teams',
  'Burnout-Proofing the Workplace',
  'Trauma-Informed Leadership',
  'Managing Emotional Load in High-Responsibility Teams',
  'The Human Side of Retention',
  '/organizational-training-inquiry/',
  '/corporate-speaking/',
  '/therapy/',
  'https://monika-hicks.clientsecure.me/'
];
for (const token of homepageRequired) {
  if (!homepage.includes(token)) fail(`Homepage dual-pathway contract missing token: ${token}`);
}

const individualPathway = (homepage.match(/<h3>For Individuals Seeking Healing &amp; Support<\/h3>[\s\S]*?<\/article>/) || [''])[0];
if (!individualPathway) fail('Homepage individual pathway card is missing.');
for (const block of [individualPathway]) {
  if (/trauma/i.test(block)) fail('Individual homepage pathway must not position trauma as an individual-client focus.');
}

if (homepage.includes('Book a Consult</a><a class="button alt" href="/corporate-speaking/">Organizational Trainings')) {
  fail('Homepage contains stale blended hero CTAs.');
}

const homepageRestoredProof = [
  'What clients are saying',
  'Monika is easy to talk to and makes it easier to open up.',
  'memphisvoyager.com/interview/hidden-gems-meet-monika-hicks-of-hicks-consulting/',
  'psychology-today-badge.png',
  'therapy-for-black-girls-badge.png',
  'providers.therapyforblackgirls.com/listing/monika-hicks-lcsw/'
];
// The client is an LCSW: no review or heading may call her "Dr." (owner rule).
if (/\bDr\.?\s+Hicks\b/.test(homepage)) fail('Homepage must not call Monika "Dr. Hicks"; she is an LCSW.');
for (const token of homepageRestoredProof) {
  if (!homepage.includes(token)) fail(`Homepage restored credibility/proof feature missing token: ${token}`);
}

console.log('Conversion contract OK');
