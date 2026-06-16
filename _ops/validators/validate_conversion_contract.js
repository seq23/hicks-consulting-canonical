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
const homepageRequired = [
  'Mental health support for high-achieving women and healthier organizations.',
  'Work With Me (Individuals)',
  'Book a Training (Organizations)',
  'For Individuals Seeking Healing &amp; Support',
  'For Organizations &amp; Teams',
  'licensed mental health professional',
  'medication management',
  'keynote speaking',
  'Burnout-Proofing the Workplace',
  'Trauma-Informed Leadership in Real-World Settings',
  'The Human Side of Retention',
  '/organizational-training-inquiry/',
  'https://monika-hicks.clientsecure.me/'
];
for (const token of homepageRequired) {
  if (!homepage.includes(token)) fail(`Homepage dual-pathway contract missing token: ${token}`);
}

const individualSection = (homepage.match(/<section class="section soft-tone" id="individual-support">[\s\S]*?<\/section>/) || [''])[0];
const individualPathway = (homepage.match(/<span class="section-label">For Individuals Seeking Healing &amp; Support<\/span>[\s\S]*?<a class="button" data-form-key="therapy"/) || [''])[0];
for (const block of [individualSection, individualPathway]) {
  if (/trauma/i.test(block)) fail('Individual homepage pathway must not position trauma as an individual-client focus.');
}

if (homepage.includes('Book a Consult</a><a class="button alt" href="/corporate-speaking/">Organizational Trainings')) {
  fail('Homepage contains stale blended hero CTAs.');
}

const homepageRestoredProof = [
  'luxury-fade-words',
  'Grounded care.',
  'Intentional healing.',
  'Room to exhale.',
  'Client reviews',
  'What clients are saying',
  'Monika is easy to talk to and makes it easier to open up.',
  'Memphis Voyager',
  'memphisvoyager.com/interview/hidden-gems-meet-monika-hicks-of-hicks-consulting/',
  'Verified profiles',
  'psychology-today-badge.png',
  'therapy-for-black-girls-badge.png',
  'providers.therapyforblackgirls.com/listing/monika-hicks-lcsw/'
];
for (const token of homepageRestoredProof) {
  if (!homepage.includes(token)) fail(`Homepage restored credibility/proof feature missing token: ${token}`);
}

console.log('Conversion contract OK');
