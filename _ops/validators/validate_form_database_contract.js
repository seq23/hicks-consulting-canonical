const { fs, path, read, fail } = require('./util');

const root = process.cwd();
const workerPath = path.join(root, 'worker', '_worker.js');
if (!fs.existsSync(workerPath)) fail('Cloudflare Advanced Mode worker missing: worker/_worker.js');

const worker = read('worker/_worker.js');
const siteJs = read('assets/js/site.js');
const packageJson = JSON.parse(read('package.json'));

const formContracts = [
  {
    type: 'training',
    route: '/api/training-inquiry',
    page: 'pages/organizational-training-inquiry/index.html',
    functionPath: 'functions/api/training-inquiry.js',
    formId: 'training-inquiry-form',
    fields: ['firstName', 'lastName', 'company', 'email', 'services', 'eventDate', 'honorarium', 'referral', 'eventDetails'],
    required: ['firstName', 'lastName', 'company', 'email', 'services', 'eventDate', 'honorarium', 'eventDetails']
  },
  {
    type: 'groups',
    route: '/api/groups-inquiry',
    page: 'pages/groups/index.html',
    functionPath: 'functions/api/groups-inquiry.js',
    formId: 'group-inquiry-form',
    fields: ['firstName', 'lastName', 'email', 'phone', 'groupInterest', 'supportNeed', 'availability', 'message'],
    required: ['firstName', 'lastName', 'email', 'groupInterest', 'supportNeed']
  },
  {
    type: 'lead-magnet',
    route: '/api/lead-magnet',
    page: 'pages/stress-management-worksheet/index.html',
    functionPath: 'functions/api/lead-magnet.js',
    formId: 'stress-worksheet-form',
    fields: ['firstName', 'email', 'leadMagnet', 'stressContext', 'consent', 'sourcePage', 'submittedAtClient'],
    required: ['firstName', 'email', 'consent'],
    downloadPath: '/assets/downloads/stress-management-made-simple.pdf'
  }
];

for (const token of [
  'FORM_DATABASE_FORMS',
  'getFormDatabaseConfig',
  'FORM_DATABASE_WEBHOOK_URL',
  'FORM_DATABASE_SHARED_SECRET',
  'TRAINING_INQUIRY_WEBHOOK_URL',
  'INQUIRY_SHARED_SECRET',
  'postJsonToWebhook',
  'sendFormDatabaseSubmission',
  'FORM_DATABASE_DISPATCH_FAILED',
  'FORM_DATABASE_DISPATCH_ERROR',
  'normalizeForwardFields',
  'handleFormDatabaseSubmission'
]) {
  if (!worker.includes(token)) fail(`Worker missing unified form database token: ${token}`);
}

if (worker.indexOf('FORM_DATABASE_WEBHOOK_URL') > worker.indexOf('TRAINING_INQUIRY_WEBHOOK_URL')) {
  fail('Worker must prefer FORM_DATABASE_WEBHOOK_URL before legacy webhook variables.');
}
if (worker.indexOf('FORM_DATABASE_SHARED_SECRET') > worker.indexOf('TRAINING_INQUIRY_SECRET')) {
  fail('Worker must prefer FORM_DATABASE_SHARED_SECRET before legacy secret variables.');
}
if (!worker.includes('LEAD_MAGNET_WEBHOOK_URL') || !worker.includes('LEAD_MAGNET_SHARED_SECRET')) {
  fail('Worker must keep lead magnet env vars during transition.');
}
if (!worker.includes("webhookUrl: env.LEAD_MAGNET_WEBHOOK_URL || env.FORM_DATABASE_WEBHOOK_URL || env.TRAINING_INQUIRY_WEBHOOK_URL")) {
  fail('Worker must prefer LEAD_MAGNET_WEBHOOK_URL for lead-magnet submissions.');
}
if (!worker.includes("sharedSecret: env.LEAD_MAGNET_SHARED_SECRET || env.FORM_DATABASE_SHARED_SECRET || env.TRAINING_INQUIRY_SECRET || env.INQUIRY_SHARED_SECRET")) {
  fail('Worker must prefer LEAD_MAGNET_SHARED_SECRET for lead-magnet submissions.');
}
if (worker.includes('context.waitUntil') || worker.includes('queueFormDatabaseSubmission')) {
  fail('Worker must not background-queue form submissions because users would see success without confirmed spreadsheet capture.');
}

for (const contract of formContracts) {
  const html = read(contract.page);
  const fnPath = path.join(root, contract.functionPath);
  if (!fs.existsSync(fnPath)) fail(`${contract.type} function missing: ${contract.functionPath}`);
  const fn = fs.readFileSync(fnPath, 'utf8');

  if (!worker.includes(`route: '${contract.route}'`)) fail(`Worker registry missing route ${contract.route}.`);
  if (!worker.includes(`'${contract.type}':`) && !worker.includes(`${contract.type}:`)) fail(`Worker registry missing form type ${contract.type}.`);
  if (!fn.includes(`const FORM_TYPE = '${contract.type}'`)) fail(`${contract.functionPath} must be a thin wrapper for ${contract.type}.`);
  if (!fn.includes('FORM_DATABASE_FORMS')) fail(`${contract.functionPath} missing unified form registry.`);
  if (!fn.includes('postJsonToWebhook')) fail(`${contract.functionPath} missing normal webhook POST transport.`);
  if (fn.includes("redirect: 'manual'") || fn.includes('redirect: "manual"') || fn.includes('postJsonWithManualRedirect')) fail(`${contract.functionPath} must not use manual redirect transport for Apps Script webhooks.`);
  if (!fn.includes('sendFormDatabaseSubmission')) fail(`${contract.functionPath} must synchronously send Apps Script submission.`);
  if (!fn.includes('webhookResult.parsed.ok !== true')) fail(`${contract.functionPath} must require Apps Script JSON ok:true before returning success.`);
  if (!fn.includes('FORM_DATABASE_DISPATCH_FAILED')) fail(`${contract.functionPath} must log failed dispatches.`);
  if (fn.includes('context.waitUntil') || fn.includes('queueFormDatabaseSubmission')) fail(`${contract.functionPath} must not background-queue form database submissions.`);

  const formPattern = new RegExp(`<form[^>]+id=["']${contract.formId}["'][^>]*>`, 'i');
  if (!formPattern.test(html)) fail(`${contract.type} HTML form missing: ${contract.formId}.`);
  if (!html.includes(`action="${contract.route}"`) && !html.includes(`action='${contract.route}'`)) fail(`${contract.type} form must post to ${contract.route}.`);
  if (!siteJs.includes(contract.route)) fail(`Client JS missing endpoint ${contract.route}.`);

  for (const field of contract.fields) {
    if (!worker.includes(`'${field}'`)) fail(`Worker registry missing ${contract.type} field: ${field}`);
    if (!fn.includes(`'${field}'`)) fail(`${contract.functionPath} registry missing field: ${field}`);
  }
  for (const field of contract.required) {
    if (!worker.includes(`'${field}'`)) fail(`Worker registry missing ${contract.type} required field: ${field}`);
  }

  if (contract.downloadPath) {
    if (!worker.includes(contract.downloadPath)) fail('Worker missing lead magnet download path.');
    if (!fn.includes(contract.downloadPath)) fail('Lead magnet function missing download path.');
  }
}

if (!packageJson.scripts['validate:form-database']) fail('package.json missing validate:form-database script.');
if (!packageJson.scripts['validate:all'].includes('validate:form-database')) fail('validate:all must include validate:form-database.');

const formRunbookPath = 'docs/runbooks/form-database-webhook.md';
if (!fs.existsSync(path.join(root, formRunbookPath))) fail('Unified form database runbook missing.');
const runbook = read(formRunbookPath);
for (const token of ['FORM DATABASE', 'FORM_DATABASE_WEBHOOK_URL', 'FORM_DATABASE_SHARED_SECRET', 'Training Inquiries', 'Group Inquiries', 'Lead Magnet Leads', 'Adding a new spreadsheet tab', 'Apps Script']) {
  if (!runbook.includes(token)) fail(`Form database runbook missing token: ${token}`);
}

console.log(`Form database contract OK (${formContracts.length} forms use normal webhook POST transport and synchronously confirm Apps Script ok:true before user success).`);
