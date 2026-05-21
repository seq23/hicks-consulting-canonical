const { fs, path, read, fail } = require('./util');

const js = read('assets/js/site.js');
const config = JSON.parse(read('data/system/config.json'));
const build = read('scripts/build/build.js');
const homepage = read('pages/index.html');

const contracts = [
  {
    label: 'Training inquiry',
    htmlPath: 'pages/organizational-training-inquiry/index.html',
    formId: 'training-inquiry-form',
    statusId: 'training-inquiry-status',
    endpoint: '/api/training-inquiry',
    fnPath: path.join(process.cwd(), 'functions', 'api', 'training-inquiry.js'),
    fields: [
      'firstName',
      'lastName',
      'company',
      'email',
      'services',
      'eventDate',
      'honorarium',
      'referral',
      'eventDetails'
    ],
    requiredBackendMarkers: [
      'TRAINING_INQUIRY_WEBHOOK_URL',
      'TRAINING_INQUIRY_SECRET',
      "inquiryType: 'training'",
      'secret: sharedSecret'
    ],
    successCopy: 'Your organizational training inquiry has been received'
  },
  {
    label: 'Groups inquiry',
    htmlPath: 'pages/groups/index.html',
    formId: 'group-inquiry-form',
    statusId: 'group-inquiry-status',
    endpoint: '/api/groups-inquiry',
    fnPath: path.join(process.cwd(), 'functions', 'api', 'groups-inquiry.js'),
    fields: [
      'firstName',
      'lastName',
      'email',
      'groupInterest',
      'preferredAvailability',
      'referral',
      'message'
    ],
    requiredBackendMarkers: [
      'TRAINING_INQUIRY_WEBHOOK_URL',
      'TRAINING_INQUIRY_SECRET',
      "inquiryType: 'groups'",
      'secret: sharedSecret'
    ],
    successCopy: 'Your group inquiry has been received'
  }
];

let fieldCount = 0;

for (const contract of contracts) {
  const html = read(contract.htmlPath);
  if (!fs.existsSync(contract.fnPath)) fail(`${contract.label} Cloudflare Function missing: ${contract.fnPath}`);
  const fn = fs.readFileSync(contract.fnPath, 'utf8');

  const formPattern = new RegExp(`<form[^>]+id=["']${contract.formId}["'][^>]*>`, 'i');
  if (!formPattern.test(html)) fail(`${contract.label} form missing.`);
  const endpointPattern = new RegExp(`action=["']${contract.endpoint.replace(/\//g, '\\/')}["']`);
  if (!endpointPattern.test(html)) fail(`${contract.label} form must post to ${contract.endpoint}.`);
  if (!/method=["']POST["']/i.test(html)) fail(`${contract.label} form method must be POST.`);

  for (const field of contract.fields) {
    const fieldPattern = new RegExp(`name=["']${field}["']`);
    if (!fieldPattern.test(html)) fail(`${contract.label} frontend field missing: ${field}`);
    if (!js.includes(`'${field}'`) && !js.includes(`"${field}"`)) fail(`${contract.label} JS payload mapping missing: ${field}`);
    if (!fn.includes(`'${field}'`) && !fn.includes(`"${field}"`)) fail(`${contract.label} backend mapping missing: ${field}`);
    fieldCount += 1;
  }

  if (!new RegExp(`id=["']${contract.statusId}["']`).test(html)) fail(`${contract.label} status message region missing.`);
  if (/<form[^>]+action=["']mailto:/i.test(html)) fail(`${contract.label} form must not use mailto action.`);
  if (!js.includes('fetch(endpoint')) fail(`${contract.label} JS must submit through fetch.`);
  if (!js.includes('form.hidden = true')) fail(`${contract.label} success behavior must hide the form.`);
  if (!js.includes(contract.successCopy)) fail(`${contract.label} success thank-you copy missing from JS.`);

  for (const marker of contract.requiredBackendMarkers) {
    if (!fn.includes(marker)) fail(`${contract.label} backend marker missing: ${marker}`);
  }
}

if (config.forms?.groups && String(config.forms.groups).startsWith('mailto:')) fail('Groups config must not route to mailto.');
if (build.includes("Groups: ${siteConfig.forms?.groups || 'mailto:")) fail('Build llms fallback must not route groups to mailto.');
if (/hero-logo-medallion/.test(homepage)) fail('Homepage hero must not include logo overlay on green blazer photo.');
if (!homepage.includes('/assets/hicks-consulting-logo-full.png')) fail('Homepage header must use full Hicks Consulting logo.');
if (!homepage.includes('/assets/monika-primary.jpg')) fail('Homepage must keep green blazer hero photo.');
if (!homepage.includes('/assets/headshot-logo.png')) fail('Homepage must keep clean colorful suit portrait in Meet Monika section.');

console.log(`Inquiry and visual contracts OK (${contracts.length} forms, ${fieldCount} locked fields traced frontend → JS → backend).`);
