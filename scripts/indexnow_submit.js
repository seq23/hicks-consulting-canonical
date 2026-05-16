#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const reportsDir = path.join(root, 'reports');
const siteConfigPath = path.join(root, 'data', 'system', 'config.json');
const siteConfig = fs.existsSync(siteConfigPath) ? JSON.parse(fs.readFileSync(siteConfigPath, 'utf8')) : {};
const canonicalDomain = String(process.env.SITE_URL || siteConfig.canonicalDomain || 'https://www.hicksconsulting.org').replace(/\/$/, '');
const host = new URL(canonicalDomain).host;
const endpoint = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow';
const key = process.env.INDEXNOW_KEY || '';
const keyLocation = process.env.INDEXNOW_KEY_LOCATION || `${canonicalDomain}/indexnow.txt`;
const dryRun = process.env.INDEXNOW_DRY_RUN === '1' || process.env.INDEXNOW_DRY_RUN === 'true';
const priorityFile = process.env.INDEXNOW_PRIORITY_FILE || path.join(reportsDir, 'indexnow-priority.txt');
const batchFile = process.env.INDEXNOW_BATCH_FILE || path.join(reportsDir, 'indexnow-batch.txt');
function readUrls(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
const priorityUrls = readUrls(priorityFile);
const batchUrls = readUrls(batchFile);
const allUrls = [...new Set([...priorityUrls, ...batchUrls])];
const failures = [];

if (!dryRun && key) {
  const localKeyFile = path.join(root, 'dist', 'indexnow.txt');
  if (!fs.existsSync(localKeyFile)) {
    failures.push('dist/indexnow.txt is missing. Create root indexnow.txt containing the IndexNow key, then run npm run build so it is copied to dist.');
  } else {
    const fileKey = fs.readFileSync(localKeyFile, 'utf8').trim();
    if (fileKey !== key) failures.push('dist/indexnow.txt does not match INDEXNOW_KEY. The public verification file and GitHub secret must contain the exact same key.');
  }
}
for (const url of allUrls) {
  try {
    const parsed = new URL(url);
    if (parsed.host !== host) failures.push(`URL host mismatch: ${url}`);
  } catch {
    failures.push(`Invalid URL: ${url}`);
  }
}
fs.mkdirSync(reportsDir, { recursive: true });
async function submit(urls, label) {
  if (!urls.length) return { label, attempted: false, count: 0, status: 'skipped', httpStatus: null };
  if (dryRun) return { label, attempted: false, count: urls.length, status: 'dry-run', httpStatus: null };
  if (!key) return { label, attempted: false, count: urls.length, status: 'failed', httpStatus: null, error: 'INDEXNOW_KEY is required for live submission.' };
  const body = { host, key, keyLocation, urlList: urls };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text().catch(() => '');
  return { label, attempted: true, count: urls.length, status: res.ok ? 'success' : 'failed', httpStatus: res.status, response: text.slice(0, 500) };
}
(async () => {
  const results = [];
  if (failures.length) {
    const report = {
      repo: 'hicks-consulting-canonical', host, endpoint, keyLocation, submittedAt: new Date().toISOString(), dryRun,
      priorityCount: priorityUrls.length, batchCount: batchUrls.length, status: 'failed', failures, results
    };
    fs.writeFileSync(path.join(reportsDir, 'indexnow-submit-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.error(`IndexNow submit failed before request: ${failures.join('; ')}`);
    process.exit(1);
  }
  results.push(await submit(priorityUrls, 'priority'));
  results.push(await submit(batchUrls, 'batch'));
  for (const r of results) if (r.status === 'failed') failures.push(`${r.label}: ${r.error || `HTTP ${r.httpStatus}`}`);
  const status = failures.length ? 'failed' : (dryRun ? 'dry-run' : 'success');
  const report = {
    repo: 'hicks-consulting-canonical', host, endpoint, keyLocation, submittedAt: new Date().toISOString(), dryRun,
    priorityCount: priorityUrls.length, batchCount: batchUrls.length, status, failures, results
  };
  fs.writeFileSync(path.join(reportsDir, 'indexnow-submit-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`IndexNow submit report written: ${status}`);
  if (failures.length) process.exit(1);
})().catch(err => {
  fs.mkdirSync(reportsDir, { recursive: true });
  const report = { repo: 'hicks-consulting-canonical', host, endpoint, keyLocation, submittedAt: new Date().toISOString(), dryRun, status: 'failed', failures: [err.message], results: [] };
  fs.writeFileSync(path.join(reportsDir, 'indexnow-submit-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(err);
  process.exit(1);
});
