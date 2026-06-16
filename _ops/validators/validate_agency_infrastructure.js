const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fail } = require('../validation/protocol');

const root = process.cwd();
const issues = [];
const requiredFiles = [
  'pages/agency/index.html',
  'assets/js/agency-dashboard.js',
  'scripts/site_build.js',
  'scripts/agency/generate_agency_report.js',
  'scripts/agency/refresh_search_health.js',
  'data/agency/dashboard.json',
  'data/agency/gsc_snapshot.json',
  'data/agency/bing_snapshot.json',
  'data/agency/live_snapshot.json',
  '.github/workflows/agency-seo-monitor.yml'
];

function read(relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    issues.push(`Missing required agency file: ${relative}`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}

for (const file of requiredFiles) read(file);

const pkg = JSON.parse(read('package.json') || '{}');
const expectedScripts = {
  'build': 'node scripts/site_build.js',
  'agency:report': 'node scripts/agency/generate_agency_report.js',
  'agency:refresh': 'node scripts/agency/refresh_search_health.js',
  'agency:monitor': 'npm run agency:refresh && npm run build'
};
for (const [name, expected] of Object.entries(expectedScripts)) {
  if (pkg.scripts?.[name] !== expected) issues.push(`${name} must map exactly to: ${expected}`);
}

for (const file of ['scripts/agency/generate_agency_report.js', 'scripts/agency/refresh_search_health.js', 'assets/js/agency-dashboard.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) issues.push(`${file} failed syntax validation: ${(result.stderr || result.stdout || '').trim()}`);
}

const page = read('pages/agency/index.html');
if (!/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex[^"']*nofollow[^"']*["']/i.test(page) &&
    !/<meta[^>]+content=["'][^"']*noindex[^"']*nofollow[^"']*["'][^>]+name=["']robots["']/i.test(page)) {
  issues.push('/agency/ must contain a noindex,nofollow robots directive.');
}
if (!/assets\/js\/agency-dashboard\.js/i.test(page)) issues.push('/agency/ must load assets/js/agency-dashboard.js.');
if (!/data\/agency\/dashboard\.json/i.test(read('assets/js/agency-dashboard.js'))) issues.push('Agency dashboard JavaScript must load /data/agency/dashboard.json.');

const build = read('scripts/site_build.js');
if (!/require\(['"]\.\/agency\/generate_agency_report['"]\)\.generate\(\)/.test(build)) {
  issues.push('Production build must generate the agency dashboard report.');
}
if (fs.existsSync(path.join(root, 'scripts', 'build'))) {
  issues.push('Legacy scripts/build directory must be removed because updater v3.1 excludes directories named build during snapshot sync.');
}

const sitemap = read('sitemap.xml');
if (/\/agency\/?(?:<|$)/i.test(sitemap)) issues.push('/agency/ must remain excluded from sitemap.xml.');

let dashboard;
try {
  dashboard = JSON.parse(read('data/agency/dashboard.json'));
} catch (error) {
  issues.push(`data/agency/dashboard.json is invalid JSON: ${error.message}`);
}
if (dashboard) {
  if (dashboard.policy?.blocking !== false) issues.push('Agency report policy.blocking must be false.');
  const expectedKeys = ['technical', 'onpage', 'liveContent', 'forwardContent', 'aeo', 'geo', 'measurement', 'monitoring'];
  const actualKeys = (dashboard.scores || []).map((score) => score.key);
  for (const key of expectedKeys) if (!actualKeys.includes(key)) issues.push(`Agency scorecard is missing category: ${key}`);
  if (actualKeys.includes('security') || actualKeys.includes('privacy')) issues.push('Security/privacy must not be added to the owner-scoped agency scorecard.');
  for (const score of dashboard.scores || []) {
    if (!Number.isFinite(score.score) || score.score < 0 || score.score > 100) issues.push(`Invalid agency score for ${score.key}.`);
  }
}

const workflow = read('.github/workflows/agency-seo-monitor.yml');
for (const token of ['workflow_dispatch:', 'schedule:', 'contents: write', 'npm run agency:refresh', 'npm run build', 'actions/upload-artifact@v4']) {
  if (!workflow.includes(token)) issues.push(`Agency workflow is missing required contract token: ${token}`);
}
if (!/jobs:\s*[\s\S]*?monitor:\s*[\s\S]*?continue-on-error:\s*true/.test(workflow)) {
  issues.push('Agency monitor job must remain continue-on-error: true.');
}
if (/npm run publish:content/.test(workflow)) issues.push('Agency monitoring workflow must not invoke content publication.');

const refresh = read('scripts/agency/refresh_search_health.js');
if (!refresh.includes('https://www.googleapis.com/auth/webmasters.readonly')) issues.push('GSC connector must use the read-only webmaster scope.');
if (!/process\.exitCode\s*=\s*0/.test(refresh)) issues.push('Agency provider-monitor failures must remain non-blocking.');

const report = read('scripts/agency/generate_agency_report.js');
if (!/blocking\s*:\s*false/.test(report)) issues.push('Agency report generator must encode warning-only policy.');
if (!/process\.exitCode\s*=\s*0/.test(report)) issues.push('Agency report CLI quality failures must remain non-blocking.');

for (const file of ['data/agency/dashboard.json', 'data/agency/gsc_snapshot.json', 'data/agency/bing_snapshot.json', 'data/agency/live_snapshot.json']) {
  const text = read(file);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) issues.push(`${file} contains private-key material.`);
  if (/"(?:access_token|api_key|private_key)"\s*:\s*"(?!not_connected|warning|environment_unavailable)[^"\s]{12,}"/i.test(text)) issues.push(`${file} appears to contain a secret value.`);
}

if (fs.existsSync(path.join(root, 'dist'))) {
  for (const file of ['dist/agency/index.html', 'dist/assets/js/agency-dashboard.js', 'dist/data/agency/dashboard.json']) {
    if (!fs.existsSync(path.join(root, file))) issues.push(`Production build is missing agency artifact: ${file}`);
  }
}

if (issues.length) fail(issues);
console.log('Agency infrastructure contract OK (route, report, workflow, scorecard, noindex, sitemap isolation, and warning-only provider behavior).');
