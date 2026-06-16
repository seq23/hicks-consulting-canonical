const { fs, path, read, fail } = require('./util');

const js = read('assets/js/site.js');
const config = JSON.parse(read('data/system/config.json'));
const build = read('scripts/site_build.js');
const homepage = read('pages/index.html');
const css = read('assets/css/styles.css');
const wranglerPath = path.join(process.cwd(), 'wrangler.toml');
const wranglerToml = fs.existsSync(wranglerPath) ? fs.readFileSync(wranglerPath, 'utf8') : '';

const contracts = [
  {
    label: 'Training inquiry',
    htmlPath: 'pages/organizational-training-inquiry/index.html',
    formId: 'training-inquiry-form',
    statusId: 'training-inquiry-status',
    endpoint: '/api/training-inquiry',
    fnPath: path.join(process.cwd(), 'functions', 'api', 'training-inquiry.js'),
    formType: "const FORM_TYPE = 'training'",
    successCopy: 'Your organizational training inquiry has been received',
    fields: ['firstName', 'lastName', 'company', 'email', 'services', 'eventDate', 'honorarium', 'referral', 'eventDetails']
  },
  {
    label: 'Groups inquiry',
    htmlPath: 'pages/groups/index.html',
    formId: 'group-inquiry-form',
    statusId: 'group-inquiry-status',
    endpoint: '/api/groups-inquiry',
    fnPath: path.join(process.cwd(), 'functions', 'api', 'groups-inquiry.js'),
    formType: "const FORM_TYPE = 'groups'",
    successCopy: 'Your group inquiry has been received',
    fields: ['firstName', 'lastName', 'email', 'phone', 'groupInterest', 'supportNeed', 'availability', 'message'],
    forbiddenFields: ['company', 'services', 'eventDate', 'honorarium', 'eventDetails']
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

  const formBlockMatch = html.match(new RegExp(String.raw`<form[^>]+id=["\']${contract.formId}["\'][^>]*>[\s\S]*?<\/form>`, 'i'));
  if (!formBlockMatch) fail(`${contract.label} form block missing.`);
  const formBlock = formBlockMatch[0];
  const formFields = Array.from(formBlock.matchAll(/name=["']([^"']+)["']/g)).map(match => match[1]);
  const uniqueFields = [...new Set(formFields)];
  if (JSON.stringify(uniqueFields) !== JSON.stringify(contract.fields)) {
    fail(`${contract.label} must expose exact fields in order. Expected ${contract.fields.join(', ')}; got ${uniqueFields.join(', ')}`);
  }

  if (contract.forbiddenFields) {
    const forbidden = contract.forbiddenFields.filter(field => new RegExp(`name=["']${field}["']`).test(formBlock));
    if (forbidden.length) fail(`${contract.label} contains stale Training-only fields: ${forbidden.join(', ')}`);
  }

  for (const field of contract.fields) {
    const fieldPattern = new RegExp(`name=["']${field}["']`);
    if (!fieldPattern.test(formBlock)) fail(`${contract.label} frontend field missing: ${field}`);
    if (!js.includes(`'${field}'`) && !js.includes(`"${field}"`)) fail(`${contract.label} JS payload mapping missing: ${field}`);
    if (!fn.includes(`'${field}'`) && !fn.includes(`"${field}"`)) fail(`${contract.label} backend registry missing: ${field}`);
    fieldCount += 1;
  }

  if (!new RegExp(`id=["']${contract.statusId}["']`).test(html)) fail(`${contract.label} status message region missing.`);
  if (/<form[^>]+action=["']mailto:/i.test(html)) fail(`${contract.label} form must not use mailto action.`);
  if (!js.includes('submitInquiryPayload(endpoint, payload)')) fail(`${contract.label} JS must submit through explicit POST helper.`);
  if (!js.includes('form.hidden = true')) fail(`${contract.label} success behavior must hide the form.`);
  if (!js.includes(contract.successCopy)) fail(`${contract.label} success thank-you copy missing from JS.`);
  if (!fn.includes(contract.formType)) fail(`${contract.label} backend form type marker missing.`);
  if (!fn.includes('FORM_DATABASE_WEBHOOK_URL') || !fn.includes('FORM_DATABASE_SHARED_SECRET')) fail(`${contract.label} must support canonical form database env vars.`);
  if (!fn.includes('TRAINING_INQUIRY_WEBHOOK_URL') || !fn.includes('INQUIRY_SHARED_SECRET')) fail(`${contract.label} must keep legacy webhook fallback variables.`);
  if (!fn.includes('secret: sharedSecret')) fail(`${contract.label} backend must forward shared secret to Apps Script.`);
  if (!fn.includes('sendFormDatabaseSubmission')) fail(`${contract.label} backend must synchronously send Apps Script submission.`);
  if (!fn.includes('webhookResult.parsed.ok !== true')) fail(`${contract.label} backend must require Apps Script JSON ok:true before user success.`);
  if (!fn.includes('FORM_DATABASE_DISPATCH_FAILED')) fail(`${contract.label} backend must log failed dispatches.`);
  if (fn.includes('context.waitUntil') || fn.includes('queueFormDatabaseSubmission')) fail(`${contract.label} backend must not background-queue form submissions.`);
}

if (config.forms?.groups !== '/groups/#group-inquiry-form') fail('Groups config must route to /groups/#group-inquiry-form.');
if (String(config.forms?.groups || '').startsWith('mailto:')) fail('Groups config must not route to mailto.');
if (!js.includes('validInternal')) fail('wireFormLinks must recognize internal paths like /groups/#group-inquiry-form.');
if (!js.includes("key !== 'groups'")) fail('wireFormLinks must not allow Groups CTA to resolve to mailto.');
if (build.includes("Groups: ${siteConfig.forms?.groups || 'mailto:")) fail('Build llms fallback must not route groups to mailto.');

if (!read('pages/corporate-speaking/index.html').toLowerCase().includes('keynote speaking')) fail('Corporate Speaking page must mention keynote speaking.');
if (!read('pages/organizational-training-inquiry/index.html').toLowerCase().includes('keynote speaking')) fail('Organizational Training Inquiry page must mention keynote speaking.');

if (/hero-logo-medallion/.test(homepage)) fail('Homepage hero must not include logo overlay on green blazer photo.');
if (!homepage.includes('/assets/hicks-consulting-logo-full.png')) fail('Homepage header must use full Hicks Consulting logo.');
if (!homepage.includes('/assets/monika-primary.jpg')) fail('Homepage must keep green blazer hero photo.');
if (!homepage.includes('/assets/headshot-logo.png')) fail('Homepage must keep clean white-background / colorful-suit Meet Monika portrait.');
if (!css.includes('content must never depend on JS animation') || !css.includes('opacity: 1 !important')) fail('Animated sections must fail open so homepage content remains visible without JS.');

if (!fs.existsSync(wranglerPath)) fail('wrangler.toml is required so Cloudflare Pages uses the explicit repo deployment contract.');
if (!wranglerToml.includes('pages_build_output_dir = "dist"')) fail('wrangler.toml must set pages_build_output_dir = "dist".');
if (!wranglerToml.includes('TRAINING_INQUIRY_WEBHOOK_URL')) fail('wrangler.toml must retain legacy TRAINING_INQUIRY_WEBHOOK_URL fallback during form database migration.');
if (!wranglerToml.includes('INQUIRY_SHARED_SECRET')) fail('wrangler.toml must retain legacy INQUIRY_SHARED_SECRET fallback during form database migration.');

const advancedWorkerPath = path.join(process.cwd(), 'worker', '_worker.js');
if (!fs.existsSync(advancedWorkerPath)) fail('Cloudflare Advanced Mode worker missing: worker/_worker.js');
const advancedWorker = fs.readFileSync(advancedWorkerPath, 'utf8');
for (const marker of ['/api/training-inquiry', '/api/groups-inquiry', 'FORM_DATABASE_FORMS', 'FORM_DATABASE_WEBHOOK_URL', 'FORM_DATABASE_SHARED_SECRET', 'TRAINING_INQUIRY_WEBHOOK_URL', 'INQUIRY_SHARED_SECRET', 'env.ASSETS.fetch(request)']) {
  if (!advancedWorker.includes(marker)) fail(`Cloudflare Advanced Mode worker missing marker: ${marker}`);
}
if (!advancedWorker.includes('sendFormDatabaseSubmission') || !advancedWorker.includes('webhookResult.parsed.ok !== true')) fail('Advanced worker must synchronously require Apps Script ok:true before user success.');
if (advancedWorker.includes('context.waitUntil') || advancedWorker.includes('queueFormDatabaseSubmission')) fail('Advanced worker must not background-queue form submissions.');
const buildSource = read('scripts/site_build.js');
if (!buildSource.includes("path.join(root, 'worker', '_worker.js')") || !buildSource.includes("path.join(dist, '_worker.js')")) fail('Build must copy worker/_worker.js to dist/_worker.js.');

const runbook = read('docs/runbooks/training-inquiry-google-sheet.md');
if (!runbook.includes('Groups inquiry field contract')) fail('Runbook must document Groups inquiry field contract.');
if (!runbook.includes('FORM_DATABASE_WEBHOOK_URL')) fail('Training runbook must point to the unified form database env vars.');
if (!js.includes('Your organizational training inquiry has been received')) fail('Training form must show thank-you confirmation after successful submit.');
if (!js.includes('Your group inquiry has been received')) fail('Groups form must show thank-you confirmation after successful submit.');

const articleRoot = path.join(process.cwd(), 'pages', 'resources', 'articles');
const articleDirs = fs.readdirSync(articleRoot).filter(name => fs.existsSync(path.join(articleRoot, name, 'index.html')));
const missingArticleCredits = articleDirs
  .filter(name => name !== 'articles')
  .filter(name => !fs.readFileSync(path.join(articleRoot, name, 'index.html'), 'utf8').includes('Author: Monika Hicks, LCSW'));
if (missingArticleCredits.length) fail(`Article author credit missing on ${missingArticleCredits.length} article pages: ${missingArticleCredits.slice(0, 10).join(', ')}`);

console.log(`Inquiry, visual, runtime, and edit-audit contracts OK (${contracts.length} forms, ${fieldCount} locked fields traced frontend → JS → backend).`);
