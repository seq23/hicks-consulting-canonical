// Search Console client shared by the measurement collectors. Same credential
// rules as scripts/queries/ingest_gsc_evidence.mjs (GSC_SERVICE_ACCOUNT_JSON as
// raw JSON or a path), minted with a JWT bearer grant; no Google SDK needed.
//
// The property is the Domain property: GSC_SERVICE_ACCOUNT_JSON is a user on
// sc-domain:hicksconsulting.org. GSC_SITE_URL is not used here because the agency
// snapshot reads it as the URL-prefix property, which is a different property.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PROPERTY = String(process.env.SEARCH_INTELLIGENCE_PROPERTY || 'sc-domain:hicksconsulting.org').trim();
export const SITE_ORIGIN = 'https://www.hicksconsulting.org';
export const SI_DIR = 'data/search_intelligence';
export const READONLY = 'https://www.googleapis.com/auth/webmasters.readonly';
export const READWRITE = 'https://www.googleapis.com/auth/webmasters';

export function serviceAccount() {
  const raw = String(process.env.GSC_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    const info = raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(path.resolve(ROOT, raw), 'utf8'));
    if (!info.client_email || !info.private_key) return null;
    return { email: info.client_email, key: String(info.private_key).replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

export class GscError extends Error {
  constructor(status, message) { super(message); this.status = status; }
  // 401/403: only the owner can grant access. 429: daily quota. Both are holds, not defects.
  get hold() {
    if (this.status === 401 || this.status === 403) return 'HELD_CREDENTIAL';
    if (this.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(this.message)) return 'HELD_QUOTA';
    return null;
  }
}

export async function fetchJson(url, options = {}, attempts = 4) {
  for (let i = 1; ; i += 1) {
    let res;
    try {
      res = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
    } catch (err) {
      if (i >= attempts) throw new GscError(0, `${err.name}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      continue;
    }
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
    if (res.ok) return body;
    // 5xx and 429 are retried with backoff; 4xx is final.
    if ((res.status >= 500 || res.status === 429) && i < attempts) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      continue;
    }
    throw new GscError(res.status, `${res.status} ${res.statusText}: ${JSON.stringify(body).slice(0, 400)}`);
  }
}

export async function accessToken(sa, scope = READONLY) {
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const input = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({
    iss: sa.email, scope, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600
  }))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), sa.key).toString('base64url');
  const tok = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${sig}` })
  });
  if (!tok.access_token) throw new GscError(0, 'token exchange returned no access_token');
  return tok.access_token;
}

export function api(token) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const site = encodeURIComponent(PROPERTY);
  return {
    searchAnalytics: (body) => fetchJson(`https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, { method: 'POST', headers, body: JSON.stringify(body) }),
    inspect: (url) => fetchJson('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST', headers, body: JSON.stringify({ inspectionUrl: url, siteUrl: PROPERTY, languageCode: 'en-US' })
    }, 3),
    listSitemaps: () => fetchJson(`https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps`, { headers }),
    submitSitemap: (feed) => fetchJson(`https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps/${encodeURIComponent(feed)}`, { method: 'PUT', headers }),
    deleteSitemap: (feed) => fetchJson(`https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps/${encodeURIComponent(feed)}`, { method: 'DELETE', headers })
  };
}

export function readJson(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

export function writeJson(rel, doc) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(doc, null, 2)}\n`);
}

export function sitemapUrls() {
  return [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

export function ownerStep(sa) {
  return `Owner step: Search Console > ${PROPERTY} > Settings > Users and permissions > add ${sa?.email || 'the service account'} (Full permission for sitemap submission). Nothing else is missing.`;
}
