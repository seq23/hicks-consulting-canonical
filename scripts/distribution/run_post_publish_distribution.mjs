#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const readLines = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [];
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
const sanitize = (value) => value.replace(/[^0-9A-Za-z_.-]+/g, '-');
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const now = new Date().toISOString();
const receiptId = sanitize(`${now}-${process.env.GITHUB_RUN_ID || 'local'}`);
const siteOrigin = (process.env.SITE_URL || 'https://www.hicksconsulting.org').replace(/\/$/, '');
const sitemapPath = 'sitemap.xml';
if (!fs.existsSync(sitemapPath)) throw new Error(`Missing ${sitemapPath}; run the existing build first.`);
const sitemapUrl = `${siteOrigin}/sitemap.xml`;
const batchUrls = readLines('reports/indexnow-batch.txt');
const priorityUrls = readLines('reports/indexnow-priority.txt').slice(0, 20);
if (!batchUrls.length) throw new Error('IndexNow batch is empty; run npm run indexnow:emit first.');
const host = new URL(batchUrls[0]).host;

function base64url(value) { return Buffer.from(value).toString('base64url'); }
async function getGoogleToken() {
  if (!process.env.GSC_SERVICE_ACCOUNT_JSON || !process.env.GSC_SITE_URL) return null;
  const sa = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON);
  const iat = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/webmasters', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const signer = crypto.createSign('RSA-SHA256'); signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${signer.sign(sa.private_key, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error(`Google OAuth token request failed: HTTP ${response.status}`);
  return (await response.json()).access_token;
}
async function submitIndexNow() {
  const key = process.env.INDEXNOW_KEY || '';
  const keyLocation = process.env.INDEXNOW_KEY_LOCATION || `${siteOrigin}/indexnow.txt`;
  if (!key) return { status: 'NOT_CONFIGURED', attempted: false, submitted_urls: 0 };
  const keyFile = 'dist/indexnow.txt';
  if (!fs.existsSync(keyFile)) return { status: 'FAILED', attempted: false, submitted_urls: 0, error: `${keyFile} missing` };
  const fileKey = fs.readFileSync(keyFile, 'utf8').trim();
  if (fileKey !== key) return { status: 'FAILED', attempted: false, submitted_urls: 0, error: `${keyFile} does not match INDEXNOW_KEY` };
  try {
    const payload = { host, key, keyLocation, urlList: batchUrls.slice(0, 10000) };
    const response = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.ok ? 'SUCCESS' : 'FAILED', attempted: true, http_status: response.status, submitted_urls: payload.urlList.length, key_location: keyLocation };
  } catch (error) { return { status: 'FAILED', attempted: true, submitted_urls: 0, error: String(error?.message || error) }; }
}
async function runGsc() {
  if (!process.env.GSC_SERVICE_ACCOUNT_JSON || !process.env.GSC_SITE_URL) return { sitemap: { status: 'NOT_CONFIGURED', attempted: false }, inspection: { status: 'NOT_CONFIGURED', attempted: false, requested_urls: priorityUrls.length, inspected_urls: 0, results: [] } };
  try {
    const token = await getGoogleToken();
    const sitemapEndpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(process.env.GSC_SITE_URL)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
    const sitemapResponse = await fetch(sitemapEndpoint, { method: 'PUT', headers: { authorization: `Bearer ${token}` } });
    const sitemap = { status: sitemapResponse.ok ? 'SUCCESS' : 'FAILED', attempted: true, http_status: sitemapResponse.status, site_url: process.env.GSC_SITE_URL, sitemap_url: sitemapUrl };
    const limit = Math.max(0, Math.min(Number(process.env.GSC_INSPECTION_LIMIT || 20), priorityUrls.length));
    const results = [];
    for (const url of priorityUrls.slice(0, limit)) {
      try {
        const response = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ inspectionUrl: url, siteUrl: process.env.GSC_SITE_URL, languageCode: 'en-US' }) });
        const body = await response.json().catch(() => ({}));
        const state = body?.inspectionResult?.indexStatusResult || {};
        results.push({ url, status: response.ok ? 'SUCCESS' : 'FAILED', http_status: response.status, verdict: state.verdict || 'UNKNOWN', coverage_state: state.coverageState || 'UNKNOWN', indexing_state: state.indexingState || 'UNKNOWN', last_crawl_time: state.lastCrawlTime || null });
      } catch (error) { results.push({ url, status: 'FAILED', error: String(error?.message || error) }); }
    }
    const failures = results.filter((item) => item.status === 'FAILED').length;
    return { sitemap, inspection: { status: failures === 0 ? 'SUCCESS' : (failures === results.length ? 'FAILED' : 'PARTIAL'), attempted: true, requested_urls: priorityUrls.length, inspected_urls: results.length, failed_urls: failures, results } };
  } catch (error) {
    const message = String(error?.message || error);
    return { sitemap: { status: 'FAILED', attempted: true, error: message }, inspection: { status: 'FAILED', attempted: true, requested_urls: priorityUrls.length, inspected_urls: 0, results: [], error: message } };
  }
}

const indexnow = await submitIndexNow();
const gsc = await runGsc();
const providerSuccess = [indexnow.status, gsc.sitemap.status, gsc.inspection.status].includes('SUCCESS');
const providerFailure = [indexnow.status, gsc.sitemap.status, gsc.inspection.status].includes('FAILED');
const chain = ['successful_publish','sitemap_refresh','indexnow','gsc_sitemap_submission','priority_url_inspection_where_configured','durable_distribution_receipt','observation_feedback'];
const receipt = {
  schema_version: '2.0', receipt_id: receiptId, attempted_at: now,
  publication_trigger: 'ONLY_AFTER_EXISTING_CONTENT_PUBLISH_WORKFLOW_SUCCEEDS', chain,
  sitemap_refresh: { status: 'SUCCESS', sitemap_url: sitemapUrl, sitemap_sha256: sha256File(sitemapPath), url_count: batchUrls.length },
  indexnow, gsc_sitemap_submission: gsc.sitemap, priority_url_inspection: gsc.inspection,
  durable_receipt: { status: 'SUCCESS', latest_path: 'data/distribution/provider_receipt.json', history_path: `data/distribution/receipts/${receiptId}.json` },
  observation_feedback: { status: 'PENDING_WRITE', path: 'data/distribution/observation_feedback.json' },
  provider_success_claimed: providerSuccess, verified_external_citations_delta: 0,
  truth_boundary: 'Provider submission or inspection is not proof of indexing, search visibility, LLM surfacing, external reference, or citation.'
};
const feedback = {
  schema_version: '1.0', observed_at: now, source_receipt_id: receiptId,
  distribution_state: providerFailure ? 'ATTENTION' : (providerSuccess ? 'OBSERVED' : 'NOT_CONFIGURED'),
  sitemap_refresh_status: 'SUCCESS', indexnow_status: indexnow.status, gsc_sitemap_status: gsc.sitemap.status, gsc_inspection_status: gsc.inspection.status,
  inspected_urls: gsc.inspection.inspected_urls || 0,
  inspection_verdict_counts: (gsc.inspection.results || []).reduce((acc, item) => { acc[item.verdict || item.status || 'UNKNOWN'] = (acc[item.verdict || item.status || 'UNKNOWN'] || 0) + 1; return acc; }, {}),
  verified_external_citations_delta: 0,
  recommended_action: providerFailure ? 'REVIEW_PROVIDER_RECEIPT' : (providerSuccess ? 'FEED_OBSERVED_INDEX_STATUS_INTO_AUTHORITY_YIELD_REVIEW' : 'CONFIGURE_PROVIDER_CREDENTIALS_WHEN_READY'),
  truth_boundary: 'Observation feedback records only provider responses returned during this run.'
};
receipt.observation_feedback.status = 'SUCCESS';
writeJson('data/distribution/provider_receipt.json', receipt);
writeJson(`data/distribution/receipts/${receiptId}.json`, receipt);
writeJson('data/distribution/observation_feedback.json', feedback);
console.log(JSON.stringify(receipt, null, 2));
if (providerFailure) process.exitCode = 1;
