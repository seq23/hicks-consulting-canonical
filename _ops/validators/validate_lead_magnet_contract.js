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
  'data/system/config.json',
  'docs/runbooks/lead-magnet-download.md',
  'docs/runbooks/form-database-webhook.md'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(process.cwd(), file))) fail(`Missing required file: ${file}`);
}

const page = read('pages/stress-management-worksheet/index.html');
for (const token of [
  'Stress Management Made Simple',
  'stress-worksheet-form',
  'stress-worksheet-download',
  '/api/lead-magnet',
  '/assets/downloads/stress-management-made-simple.pdf',
  'Identify',
  'Eliminate',
  'Minimize',
  'Manage',
  'educational',
  'application/ld+json',
  'og:title',
  'twitter:card'
]) {
  if (!page.includes(token)) fail(`Landing page missing token: ${token}`);
}

const homepage = read('pages/index.html');
if (!homepage.includes('/stress-management-worksheet/')) fail('Homepage must link to stress worksheet landing page.');
if (!homepage.includes('stress-worksheet-home')) fail('Homepage spotlight section missing.');

const resources = read('pages/resources/index.html');
if (!resources.includes('/stress-management-worksheet/')) fail('Resources page must link to stress worksheet landing page.');
if (!resources.includes('stress-worksheet-resources')) fail('Resources spotlight section missing.');

const js = read('assets/js/site.js');
for (const token of ['wireLeadMagnetForm', '/api/lead-magnet', 'stress-worksheet-form', 'stress-worksheet-download', 'result.ok !== true', 'downloadPath']) {
  if (!js.includes(token)) fail(`Client JS missing token: ${token}`);
}

const fn = read('functions/api/lead-magnet.js');
for (const token of [
  "const FORM_TYPE = 'lead-magnet'",
  'FORM_DATABASE_FORMS',
  'FORM_DATABASE_WEBHOOK_URL',
  'FORM_DATABASE_SHARED_SECRET',
  'TRAINING_INQUIRY_WEBHOOK_URL',
  'LEAD_MAGNET_WEBHOOK_URL',
  'postJsonToWebhook',
  'sendFormDatabaseSubmission',
  'FORM_DATABASE_DISPATCH_FAILED',
  'Consent is required',
  'downloadPath'
]) {
  if (!fn.includes(token)) fail(`Lead magnet function missing token: ${token}`);
}


if (!fn.includes("webhookUrl: env.LEAD_MAGNET_WEBHOOK_URL || env.FORM_DATABASE_WEBHOOK_URL || env.TRAINING_INQUIRY_WEBHOOK_URL")) fail('Lead magnet function must prefer LEAD_MAGNET_WEBHOOK_URL before legacy training webhook URL.');
if (fn.includes('postJsonWithManualRedirect')) fail('Lead magnet function must use the unified postJsonToWebhook helper only.');
if (!fn.includes('webhookResult.parsed.ok !== true')) fail('Lead magnet function must require Apps Script JSON ok:true before revealing download.');
if (fn.includes('context.waitUntil') || fn.includes('queueFormDatabaseSubmission')) fail('Lead magnet function must not background-queue spreadsheet capture.');

const worker = read('worker/_worker.js');
for (const token of [
  "route: '/api/lead-magnet'",
  "'lead-magnet'",
  'FORM_DATABASE_FORMS',
  'LEAD_MAGNET_DOWNLOAD_PATH',
  'FORM_DATABASE_WEBHOOK_URL',
  'postJsonToWebhook',
  'sendFormDatabaseSubmission'
]) {
  if (!worker.includes(token)) fail(`Worker missing token: ${token}`);
}

const pdfSize = fs.statSync('assets/downloads/stress-management-made-simple.pdf').size;
if (pdfSize < 50000) fail('PDF asset appears too small or corrupt.');

console.log('Lead magnet contract OK');
