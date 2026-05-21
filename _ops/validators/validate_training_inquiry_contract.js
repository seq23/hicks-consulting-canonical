const { fs, path, read, fail } = require('./util');

const js = read('assets/js/site.js');
const config = JSON.parse(read('data/system/config.json'));
const build = read('scripts/build/build.js');
const homepage = read('pages/index.html');
const css = read('assets/css/styles.css');
const wranglerPath = path.join(process.cwd(), 'wrangler.toml');
const wranglerToml = fs.existsSync(wranglerPath) ? fs.readFileSync(wranglerPath, 'utf8') : '';

const sharedFields = [
  'firstName',
  'lastName',
  'company',
  'email',
  'services',
  'eventDate',
  'honorarium',
  'referral',
  'eventDetails'
];

const contracts = [
  {
    label: 'Training inquiry',
    htmlPath: 'pages/organizational-training-inquiry/index.html',
    formId: 'training-inquiry-form',
    statusId: 'training-inquiry-status',
    endpoint: '/api/training-inquiry',
    fnPath: path.join(process.cwd(), 'functions', 'api', 'training-inquiry.js'),
    inquiryType: "inquiryType: 'training'",
    successCopy: 'Your organizational training inquiry has been received'
  },
  {
    label: 'Groups inquiry',
    htmlPath: 'pages/groups/index.html',
    formId: 'group-inquiry-form',
    statusId: 'group-inquiry-status',
    endpoint: '/api/groups-inquiry',
    fnPath: path.join(process.cwd(), 'functions', 'api', 'groups-inquiry.js'),
    inquiryType: "inquiryType: 'groups'",
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

  const formFields = Array.from(html.matchAll(/name=["']([^"']+)["']/g)).map(match => match[1]).filter(name => sharedFields.includes(name));
  const uniqueFields = [...new Set(formFields)];
  if (JSON.stringify(uniqueFields) !== JSON.stringify(sharedFields)) fail(`${contract.label} must expose the shared inquiry fields in order: ${uniqueFields.join(', ')}`);

  for (const field of sharedFields) {
    const fieldPattern = new RegExp(`name=["']${field}["']`);
    if (!fieldPattern.test(html)) fail(`${contract.label} frontend field missing: ${field}`);
    if (!js.includes(`'${field}'`) && !js.includes(`"${field}"`)) fail(`${contract.label} JS payload mapping missing: ${field}`);
    if (!fn.includes(`"${field}"`) && !fn.includes(`'${field}'`)) fail(`${contract.label} backend mapping missing: ${field}`);
    fieldCount += 1;
  }

  if (!new RegExp(`id=["']${contract.statusId}["']`).test(html)) fail(`${contract.label} status message region missing.`);
  if (/<form[^>]+action=["']mailto:/i.test(html)) fail(`${contract.label} form must not use mailto action.`);
  if (!js.includes('submitInquiryPayload(endpoint, payload)')) fail(`${contract.label} JS must submit through explicit POST helper.`);
  if (!js.includes('form.hidden = true')) fail(`${contract.label} success behavior must hide the form.`);
  if (!js.includes(contract.successCopy)) fail(`${contract.label} success thank-you copy missing from JS.`);
  if (!fn.includes('TRAINING_INQUIRY_WEBHOOK_URL')) fail(`${contract.label} must forward to Apps Script webhook URL.`);
  if (!fn.includes('TRAINING_INQUIRY_SECRET')) fail(`${contract.label} must use shared Apps Script secret.`);
  if (!fn.includes(contract.inquiryType)) fail(`${contract.label} backend inquiryType marker missing.`);
  if (!fn.includes('secret: sharedSecret')) fail(`${contract.label} backend must forward shared secret to Apps Script.`);
}

if (config.forms?.groups !== '/groups/#group-inquiry-form') fail('Groups config must route to /groups/#group-inquiry-form.');
if (String(config.forms?.groups || '').startsWith('mailto:')) fail('Groups config must not route to mailto.');
if (!js.includes('validInternal')) fail('wireFormLinks must recognize internal paths like /groups/#group-inquiry-form.');
if (!js.includes("key !== 'groups'")) fail('wireFormLinks must not allow Groups CTA to resolve to mailto.');
if (build.includes("Groups: ${siteConfig.forms?.groups || 'mailto:")) fail('Build llms fallback must not route groups to mailto.');

if (/hero-logo-medallion/.test(homepage)) fail('Homepage hero must not include logo overlay on green blazer photo.');
if (!homepage.includes('/assets/hicks-consulting-logo-full.png')) fail('Homepage header must use full Hicks Consulting logo.');
if (!homepage.includes('/assets/monika-primary.jpg')) fail('Homepage must keep green blazer hero photo.');
if (!homepage.includes('/assets/headshot-logo.png')) fail('Homepage must keep clean white-background / colorful-suit Meet Monika portrait.');
if (!css.includes('content must never depend on JS animation') || !css.includes('opacity: 1 !important')) fail('Animated sections must fail open so homepage content remains visible without JS.');

const articleRoot = path.join(process.cwd(), 'pages', 'resources', 'articles');
const articleDirs = fs.readdirSync(articleRoot).filter(name => fs.existsSync(path.join(articleRoot, name, 'index.html')));
const missingArticleCredits = articleDirs
  .filter(name => name !== 'articles')
  .filter(name => !fs.readFileSync(path.join(articleRoot, name, 'index.html'), 'utf8').includes('Author: Monika Hicks, LCSW'));
if (missingArticleCredits.length) fail(`Article author credit missing on ${missingArticleCredits.length} article pages: ${missingArticleCredits.slice(0, 10).join(', ')}`);


const runbook = read('docs/runbooks/training-inquiry-google-sheet.md');
if (!js.includes('form.hidden = true')) fail('Successful inquiry submission must hide the submitted form.');
if (!js.includes('Your organizational training inquiry has been received')) fail('Training form must show thank-you confirmation after successful submit.');
if (!js.includes('Your group inquiry has been received')) fail('Groups form must show thank-you confirmation after successful submit.');
if (!runbook.includes('NOTIFY_EMAIL = info@hicksconsulting.org')) fail('Apps Script runbook must require notification email info@hicksconsulting.org.');
if (!runbook.includes('MailApp.sendEmail(notifyEmail, subject, body)')) fail('Apps Script runbook must send notification email with MailApp.');


// Cloudflare Pages Functions deployment contract.
if (!fs.existsSync(wranglerPath)) fail('wrangler.toml is required so Cloudflare Pages uses the explicit repo deployment contract.');
if (!wranglerToml.includes('pages_build_output_dir = "dist"')) fail('wrangler.toml must set pages_build_output_dir = "dist".');
if (!/compatibility_date\s*=\s*"20\d{2}-\d{2}-\d{2}"/.test(wranglerToml)) fail('wrangler.toml must set compatibility_date.');
if (!fs.existsSync(path.join(process.cwd(), 'functions', 'api', 'training-inquiry.js'))) fail('Pages Function missing: functions/api/training-inquiry.js');
if (!fs.existsSync(path.join(process.cwd(), 'functions', 'api', 'groups-inquiry.js'))) fail('Pages Function missing: functions/api/groups-inquiry.js');
const advancedWorkerPath = path.join(process.cwd(), 'worker', '_worker.js');
if (!fs.existsSync(advancedWorkerPath)) fail('Cloudflare Advanced Mode worker missing: worker/_worker.js');
const advancedWorker = fs.readFileSync(advancedWorkerPath, 'utf8');
for (const marker of ['/api/training-inquiry', '/api/groups-inquiry', 'TRAINING_INQUIRY_WEBHOOK_URL', 'TRAINING_INQUIRY_SECRET', 'env.ASSETS.fetch(request)']) {
  if (!advancedWorker.includes(marker)) fail(`Cloudflare Advanced Mode worker missing marker: ${marker}`);
}
const buildSource = read('scripts/build/build.js');
if (!buildSource.includes("path.join(root, 'worker', '_worker.js')") || !buildSource.includes("path.join(dist, '_worker.js')")) fail('Build must copy worker/_worker.js to dist/_worker.js.');

console.log(`Inquiry, visual, and edit-audit contracts OK (${contracts.length} forms, ${fieldCount} locked fields traced frontend → JS → backend).`);
