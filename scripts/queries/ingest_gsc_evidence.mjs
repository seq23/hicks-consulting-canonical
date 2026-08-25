#!/usr/bin/env node
// Ingest real Google Search Console query data as T1 evidence for the query pipeline.
//
// Why this exists
// ---------------
// data/intake/query_signals_post_2027.json is the head of this repo's query
// pipeline: normalize -> cluster -> score -> map -> fanouts -> briefs all descend
// from it. Every row in it today comes from RSS scraping or hand seeding - titles
// of Reddit threads, not queries anyone typed. So the whole downstream content
// intelligence was modelled guesswork while real, measured demand sat unread in
// Search Console.
//
// This closes that loop: it reads the queries people actually typed against this
// property and merges them in as measured (T1) evidence the existing pipeline
// already knows how to consume.
//
// Behaviour
// ---------
// - Merges. Existing rows are never dropped, and non-T1 rows are preserved exactly
//   as they are. When a query already present as a modelled row is confirmed by
//   measured data, it is promoted to T1 and its modelled fields (id, tags, source
//   lineage) are kept rather than discarded.
// - Exits 0 without writing when credentials are absent, so local runs and forks
//   are not failures and no file is ever truncated by a credential-less run.
// - Fails loudly (exit 1) when credentials are present but Search Console errors,
//   because that is a real fault, not an absence.
//
// Ported to Node rather than Python: this repo has no Python toolchain and no npm
// dependencies at all, and it already talks to Search Console with a stdlib JWT in
// scripts/agency/refresh_search_health.js. This reuses that exact credential shape.
//
// Environment
// -----------
//   GSC_SITE_URL               property, e.g. https://www.hicksconsulting.org/
//   GSC_SERVICE_ACCOUNT_EMAIL  service-account address   } either this pair,
//   GSC_PRIVATE_KEY            service-account key       } or
//   GSC_ACCESS_TOKEN           a pre-minted access token } this,
//   GSC_SERVICE_ACCOUNT_JSON   or a full service-account key (raw JSON or a path)
//   GSC_EVIDENCE_PATH          default data/intake/query_signals_post_2027.json
//   GSC_LOOKBACK_DAYS          default 90
//   GSC_ROW_LIMIT              default 5000
//   GSC_MIN_IMPRESSIONS        default 1
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
// resolve, not join, so an absolute GSC_EVIDENCE_PATH is honoured as given.
const EVIDENCE = path.resolve(ROOT, process.env.GSC_EVIDENCE_PATH || 'data/intake/query_signals_post_2027.json');
const LOOKBACK = Number(process.env.GSC_LOOKBACK_DAYS || 90);
const ROW_LIMIT = Number(process.env.GSC_ROW_LIMIT || 5000);
const MIN_IMPRESSIONS = Number(process.env.GSC_MIN_IMPRESSIONS || 1);
const PAGE = Math.min(ROW_LIMIT, 25000);
const SOURCE_TYPE = 'gsc_search_analytics';

const b64url = (value) => Buffer.from(value).toString('base64url');
const dateOnly = (d) => d.toISOString().slice(0, 10);
const shiftDays = (d, n) => new Date(d.getTime() + n * 86400000);

function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'query';
}

function readEvidence() {
  try {
    const doc = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
    if (!Array.isArray(doc.querySignals)) doc.querySignals = [];
    return doc;
  } catch {
    return { generatedAt: new Date().toISOString(), querySignals: [] };
  }
}

// Accepts either the split email/key secrets this repo already uses, a pre-minted
// access token, or a whole service-account JSON key. Returns null when nothing is
// configured - that is an absence, not an error.
function credentials() {
  const site = String(process.env.GSC_SITE_URL || '').trim();
  if (!site) return null;

  if (String(process.env.GSC_ACCESS_TOKEN || '').trim()) {
    return { site, token: String(process.env.GSC_ACCESS_TOKEN).trim() };
  }

  let email = String(process.env.GSC_SERVICE_ACCOUNT_EMAIL || '').trim();
  let key = String(process.env.GSC_PRIVATE_KEY || '').trim();

  const raw = String(process.env.GSC_SERVICE_ACCOUNT_JSON || '').trim();
  if ((!email || !key) && raw) {
    let info = null;
    try {
      info = raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(raw, 'utf8'));
    } catch {
      info = null;
    }
    if (info) {
      email = email || String(info.client_email || '').trim();
      key = key || String(info.private_key || '').trim();
    }
  }

  if (!email || !key) return null;
  return { site, email, key: key.replace(/\\n/g, '\n') };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 1000) }; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(body).slice(0, 600)}`);
  return body;
}

async function accessToken(creds) {
  if (creds.token) return creds.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    iss: creds.email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600
  }));
  const input = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), creds.key).toString('base64url');
  const token = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${input}.${signature}`
    })
  });
  if (!token.access_token) throw new Error('Search Console token exchange returned no access_token.');
  return token.access_token;
}

async function fetchQueries(creds) {
  const token = await accessToken(creds);
  const end = shiftDays(new Date(), -2); // Search Console data lags ~2 days
  const start = shiftDays(end, -LOOKBACK);
  const base = (process.env.GSC_API_BASE || 'https://www.googleapis.com').replace(/\/$/, '');
  const endpoint = `${base}/webmasters/v3/sites/${encodeURIComponent(creds.site)}/searchAnalytics/query`;
  const rows = [];
  let startRow = 0;
  for (;;) {
    const body = await fetchJson(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        startDate: dateOnly(start),
        endDate: dateOnly(end),
        dimensions: ['query'],
        rowLimit: PAGE,
        startRow,
        dataState: 'final'
      })
    });
    const batch = body.rows || [];
    rows.push(...batch);
    if (batch.length < PAGE || rows.length >= ROW_LIMIT) break;
    startRow += batch.length;
  }
  return { rows: rows.slice(0, ROW_LIMIT), start: dateOnly(start), end: dateOnly(end) };
}

async function main() {
  const creds = credentials();
  if (!creds) {
    console.log('[gsc-evidence] no Search Console credentials; leaving query evidence untouched');
    return 0;
  }

  let measured;
  try {
    measured = await fetchQueries(creds);
  } catch (error) {
    // Credentials are present, so a failure here is a real fault, not an absence.
    console.error(`[gsc-evidence] FAILED to read Search Console: ${error.message}`);
    return 1;
  }

  const doc = readEvidence();
  const byQuery = new Map();
  for (const signal of doc.querySignals) {
    const key = String(signal?.query || '').trim().toLowerCase();
    if (key) byQuery.set(key, signal);
  }

  const today = new Date().toISOString();
  const domain = creds.site.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  let added = 0;
  let promoted = 0;
  let refreshed = 0;

  for (const row of measured.rows) {
    const term = String((row.keys || [])[0] || '').trim();
    const impressions = Number(row.impressions || 0);
    if (!term || impressions < MIN_IMPRESSIONS) continue;
    const key = term.toLowerCase();
    const prior = byQuery.get(key) || null;

    const entry = {
      // Keep the prior id so anything downstream that already references this
      // signal keeps resolving to it.
      id: prior?.id || `gsc-${slugify(term)}`,
      title: prior?.title || term,
      query: term,
      source: 'google_search_console',
      sourceType: SOURCE_TYPE,
      tags: Array.isArray(prior?.tags) && prior.tags.length ? prior.tags : ['gsc_measured'],
      evidence_tier: 'T1',
      // Measured impressions for this property - this property's own demand, not a
      // market-wide estimate. A smaller and far more honest number.
      impressions,
      clicks: Number(row.clicks || 0),
      ctr: Number((Number(row.ctr || 0)).toFixed(5)),
      averagePosition: Number((Number(row.position || 0)).toFixed(2)),
      targetDomain: domain,
      measuredWindowDays: LOOKBACK,
      measuredStart: measured.start,
      measuredEnd: measured.end,
      firstSeen: prior?.firstSeen || today,
      lastSeen: today,
      collectedAt: today
    };

    if (!prior) {
      added += 1;
    } else if (prior.evidence_tier === 'T1') {
      refreshed += 1;
    } else {
      // Measured demand outranks a modelled row; keep the modelled fields T1 does
      // not supply rather than discarding them.
      for (const [k, v] of Object.entries(prior)) {
        if (entry[k] === undefined) entry[k] = v;
      }
      entry.evidence_tier = 'T1';
      entry.supersededTier = prior.evidence_tier || prior.sourceType || 'modelled';
      promoted += 1;
    }
    byQuery.set(key, entry);
  }

  doc.generatedAt = today;
  doc.querySignals = [...byQuery.values()];
  doc.lastGscIngest = {
    at: today,
    site: creds.site,
    window: `${measured.start}..${measured.end}`,
    rowsReturned: measured.rows.length,
    added,
    promoted,
    refreshed,
    totalSignals: doc.querySignals.length
  };

  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(doc, null, 2)}\n`);

  const measuredCount = doc.querySignals.filter((s) => s.sourceType === SOURCE_TYPE).length;
  console.log(`[gsc-evidence] ${creds.site}: ${measured.rows.length} rows -> +${added} new, ${promoted} promoted, `
    + `${refreshed} refreshed; ${measuredCount}/${doc.querySignals.length} signals now measured`);
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(`[gsc-evidence] FAILED: ${error.stack || error.message}`);
  process.exit(1);
});
