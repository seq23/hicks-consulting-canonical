const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(`LEAD MAGNET CONTRACT FAIL: ${message}`);
  process.exit(1);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

const requiredFiles = [
  'assets/downloads/stress-management-made-simple.pdf',
  'pages/stress-management-worksheet/index.html',
  'functions/api/lead-magnet.js',
  'worker/_worker.js',
  'assets/js/site.js',
  'data/system/config.json'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(process.cwd(), file))) fail(`Missing required file: ${file}`);
}

const config = JSON.parse(read('data/system/config.json'));
const lead = config.leadMagnets && config.leadMagnets.stressManagementWorksheet;
if (!lead) fail('data/system/config.json missing leadMagnets.stressManagementWorksheet registry.');
if (lead.slug !== '/stress-management-worksheet/') fail('Lead magnet slug mismatch.');
if (lead.downloadPath !== '/assets/downloads/stress-management-made-simple.pdf') fail('Lead magnet downloadPath mismatch.');

const page = read('pages/stress-management-worksheet/index.html');
const requiredPageTokens = [
  'id="stress-worksheet-form"',
  'name="firstName"',
  'name="email"',
  'name="consent"',
  'id="stress-worksheet-download"',
  'data-download-url="/assets/downloads/stress-management-made-simple.pdf"',
  'educational resource, not therapy',
  'rel="canonical"',
  'property="og:title"',
  'name="twitter:card"',
  'type="application/ld+json"',
  'CreativeWork',
  'BreadcrumbList',
  'Identify',
  'Eliminate',
  'Minimize',
  'Manage'
];
for (const token of requiredPageTokens) {
  if (!page.includes(token)) fail(`Landing page missing token: ${token}`);
}

const home = read('pages/index.html');
if (!home.includes('/stress-management-worksheet/')) fail('Homepage missing stress worksheet link.');
if (!home.includes('Stress Management Made Simple')) fail('Homepage missing lead magnet spotlight copy.');

const resources = read('pages/resources/index.html');
if (!resources.includes('/stress-management-worksheet/')) fail('Resources page missing stress worksheet link.');
if (!resources.includes('Featured free download')) fail('Resources page missing featured download spotlight.');

const js = read('assets/js/site.js');
for (const token of ['wireLeadMagnetForm', '/api/lead-magnet', 'stress-worksheet-form', 'stress-worksheet-download']) {
  if (!js.includes(token)) fail(`Client JS missing token: ${token}`);
}

const fn = read('functions/api/lead-magnet.js');
for (const token of ['LEAD_MAGNET_WEBHOOK_URL', 'LEAD_MAGNET_SHARED_SECRET', 'TRAINING_INQUIRY_WEBHOOK_URL', 'Lead magnet endpoint is not configured', 'webhookResult.parsed.ok !== true', 'Consent is required', 'downloadPath']) {
  if (!fn.includes(token)) fail(`Lead magnet function missing token: ${token}`);
}

const worker = read('worker/_worker.js');
for (const token of ["url.pathname === '/api/lead-magnet'", 'handleLeadMagnet', 'LEAD_MAGNET_DOWNLOAD_PATH', 'Lead magnet endpoint is not configured', 'webhookResult.parsed.ok !== true']) {
  if (!worker.includes(token)) fail(`Worker missing token: ${token}`);
}

const pdfSize = fs.statSync('assets/downloads/stress-management-made-simple.pdf').size;
if (pdfSize < 50000) fail('PDF asset appears too small or corrupt.');

console.log('Lead magnet contract OK');
