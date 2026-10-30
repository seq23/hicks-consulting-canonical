#!/usr/bin/env node
/**
 * Weekly sameAs watch (authority audit, 30 Oct 2026). Run by
 * .github/workflows/entity-backlink-watch.yml; inputs in config/entity_watch.json.
 *
 * For every sameAs URL in the entity sources, and every profiles_pending URL:
 *   - fetch it with several user agents and confirm it resolves (2xx after
 *     redirects with a real profile title, not the platform's generic shell);
 *   - where the platform renders server-side (Facebook, Pinterest, YouTube,
 *     GitHub, plain sites) check the page links back to the site host;
 *   - where it may not (Instagram, LinkedIn, Gumroad, Google Maps) a link-back
 *     that cannot be seen is recorded as `unverifiable`, a named state, never a pass.
 *
 * Self-heal, only with --apply:
 *   - a sameAs URL that every agent gets a 404/410 for is removed from its entity
 *     source (never the last one: an entity left with no profiles is a named stop);
 *   - a pending profile that now resolves is promoted into its entity's sameAs.
 * The workflow then rebuilds, runs the full validation matrix, and pushes only if
 * it is clean.
 *
 * A missing link-back is a NAMED STOP naming the exact profile field to edit:
 * only the account holder can change it.
 *
 * Writes reports/entity-backlink-watch.json. Exits 1 when it checked nothing
 * (Rule 0) or could not read its inputs; otherwise 0, with every stop named.
 * Usage: node scripts/authority/entity_backlink_watch.mjs [--apply] [--root DIR]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ri = args.indexOf('--root');
const ROOT = path.resolve(ri >= 0 ? args[ri + 1] : process.cwd());
const abs = (p) => path.join(ROOT, p);
const readJson = (p) => JSON.parse(fs.readFileSync(abs(p), 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(abs(p), `${JSON.stringify(v, null, 2)}\n`);

// Platforms answer differently per user agent: Facebook returns 400 to a desktop
// browser UA without a full browser fingerprint, and Instagram serves its empty
// JS shell to one. Their own link-preview agent gets the real server-rendered
// page, so each URL is tried with several agents and the best answer counts.
const AGENTS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'curl/8.7.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];
// Platforms whose profile pages may be rendered by JavaScript or sit behind a
// login wall: a link-back that cannot be seen there is `unverifiable`, not missing.
const JS_RENDERED = [/(^|\.)instagram\.com$/, /(^|\.)linkedin\.com$/, /(^|\.)gumroad\.com$/, /^maps\.google\./, /^(www\.)?google\.[a-z.]+$/, /^maps\.app\.goo\.gl$/, /^g\.page$/];
// What a platform serves, with a 200, when it will not show the profile (or the
// profile does not exist): never proof either way, so never grounds for removal.
const GENERIC_TITLE = /^\s*(facebook|instagram|linkedin|pinterest|youtube|gumroad|error|log ?in\b.*|sign ?in\b.*|page not found)\s*$|isn['’]t available|page (isn['’]t|not) found|this account doesn['’]t exist/i;

const RANK = { dead: 0, unverifiable: 1, resolves: 2 };
const LINK_RANK = { unverifiable: 0, missing: 1, present: 2 };

export function classifyResponse({ status, finalUrl, body }, needle) {
  const host = (() => { try { return new URL(finalUrl).hostname.toLowerCase(); } catch { return ''; } })();
  const title = ((body || '').match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
  const ogTitle = ((body || '').match(/property=["']og:title["'][^>]*content=["']([^"']*)/i) || [])[1] || '';
  const shown = (ogTitle || title).trim();
  let resolve;
  // Only a hard 404/410 is death. A 200 generic shell, a login wall, a 400/403/429/999
  // or a network error says nothing about the profile, so it stays `unverifiable`.
  if (status === 404 || status === 410) resolve = 'dead';
  else if (status >= 200 && status < 300 && shown && !GENERIC_TITLE.test(shown)) resolve = 'resolves';
  else resolve = 'unverifiable';
  const hasLink = (body || '').toLowerCase().includes(needle.toLowerCase());
  let linkBack;
  if (resolve !== 'resolves') linkBack = 'unverifiable';
  else if (hasLink) linkBack = 'present';
  else linkBack = JS_RENDERED.some((r) => r.test(host)) ? 'unverifiable' : 'missing';
  return { resolve, link_back: linkBack, status, final_url: finalUrl, title: shown.slice(0, 120) };
}

async function fetchOnce(url, ua) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();
    return { status: res.status, finalUrl: res.url || url, body };
  } catch (e) {
    return { status: 0, finalUrl: url, body: '', error: String((e && e.message) || e) };
  }
}

// Every agent is tried; the best answer wins. A profile is `dead` only when every
// agent got a 404/410, so one bad answer can never remove a published profile.
export function bestOf(results) {
  return results.reduce((best, r) => {
    if (!best) return r;
    if (RANK[r.resolve] !== RANK[best.resolve]) return RANK[r.resolve] > RANK[best.resolve] ? r : best;
    return LINK_RANK[r.link_back] > LINK_RANK[best.link_back] ? r : best;
  }, null);
}

async function check(url, needle) {
  const results = [];
  for (const ua of AGENTS) {
    const r = await fetchOnce(url, ua);
    const c = { ...classifyResponse(r, needle), agent: ua.split('/')[0], ...(r.error ? { error: r.error } : {}) };
    results.push(c);
    if (c.resolve === 'resolves' && c.link_back === 'present') break;
  }
  return bestOf(results);
}

function fieldFor(url) {
  const h = new URL(url).hostname.replace(/^www\./, '');
  if (h.endsWith('facebook.com')) return 'Facebook Page > About > Contact info > Website';
  if (h.endsWith('instagram.com')) return 'Instagram > Edit profile > Website (or Links)';
  if (h.endsWith('linkedin.com')) return 'LinkedIn profile > Contact info > Website';
  if (h.endsWith('pinterest.com')) return 'Pinterest > Edit profile > Website';
  if (h.endsWith('youtube.com')) return 'YouTube Studio > Customisation > Links';
  return 'the profile\'s website field';
}

async function main() {
  const cfg = readJson('config/entity_watch.json');
  const needle = cfg.link_back_needle || cfg.site_host;
  const siteUrl = `https://${cfg.site_host}`;
  const sources = (cfg.entity_sources || []).map((s) => ({ ...s, data: readJson(s.file) }));
  const rows = [];
  const stops = [];
  const changes = [];

  for (const s of sources) {
    for (const url of s.data.sameAs || []) {
      const r = await check(url, needle);
      rows.push({ url, entity: s.file, list: 'sameAs', ...r });
    }
  }
  const pending = (cfg.profiles_pending || []).map((p) => (typeof p === 'string' ? { url: p } : p));
  for (const p of pending) {
    const r = await check(p.url, needle);
    rows.push({ url: p.url, entity: p.entity || (sources[0] && sources[0].file), list: 'profiles_pending', ...r });
  }

  if (!rows.length) {
    console.error('NAMED STOP: entity watch checked zero profiles; config/entity_watch.json names no sameAs and no pending profiles.');
    process.exit(1);
  }

  for (const row of rows) {
    const s = sources.find((x) => x.file === row.entity);
    if (row.list === 'sameAs' && row.resolve === 'dead') {
      if ((s.data.sameAs || []).length <= 1) {
        stops.push(`${row.url} is dead (HTTP ${row.status}) and is the only profile in ${row.entity}; replace it with a live profile.`);
      } else {
        s.data.sameAs = s.data.sameAs.filter((u) => u !== row.url);
        s.dirty = true;
        changes.push(`removed dead ${row.url} from ${row.entity} (HTTP ${row.status}${row.title ? `, "${row.title}"` : ''})`);
      }
    }
    if (row.list === 'profiles_pending' && row.resolve === 'resolves' && s) {
      s.data.sameAs = [...(s.data.sameAs || []), row.url];
      s.dirty = true;
      cfg.profiles_pending = (cfg.profiles_pending || []).filter((p) => (typeof p === 'string' ? p : p.url) !== row.url);
      cfg.dirty = true;
      changes.push(`promoted pending ${row.url} into ${row.entity} sameAs (now resolves)`);
    }
    if (row.list === 'sameAs' && row.link_back === 'missing') {
      stops.push(`${row.url} does not link back to ${siteUrl}: account holder sets ${fieldFor(row.url)} to ${siteUrl}/`);
    }
  }

  if (APPLY) {
    for (const s of sources) if (s.dirty) { const { data } = s; writeJson(s.file, data); }
    if (cfg.dirty) { delete cfg.dirty; writeJson('config/entity_watch.json', cfg); }
  }

  const count = (k, v) => rows.filter((r) => r[k] === v).length;
  const report = {
    generated_at: new Date().toISOString(),
    applied: APPLY,
    checked: rows.length,
    resolves: count('resolve', 'resolves'),
    dead: count('resolve', 'dead'),
    unverifiable_fetch: count('resolve', 'unverifiable'),
    link_back: { present: count('link_back', 'present'), missing: count('link_back', 'missing'), unverifiable: count('link_back', 'unverifiable') },
    changes: APPLY ? changes : [],
    proposed_changes: APPLY ? [] : changes,
    named_stops: stops,
    profiles: rows,
  };
  fs.mkdirSync(path.dirname(abs(cfg.report)), { recursive: true });
  writeJson(cfg.report, report);

  const lines = [
    `entity watch: ${rows.length} profiles checked; ${report.resolves} resolve, ${report.dead} dead, ${report.unverifiable_fetch} unverifiable to fetch; link-back ${report.link_back.present} present, ${report.link_back.missing} missing, ${report.link_back.unverifiable} unverifiable (JS-rendered or walled).`,
    ...rows.map((r) => `- ${r.url}: ${r.resolve} (HTTP ${r.status}), link-back ${r.link_back}`),
    ...(changes.length ? [`${APPLY ? 'Self-heal applied' : 'Self-heal would apply (run with --apply)'}:`, ...changes.map((c) => `- ${c}`)] : ['No self-heal needed.']),
    ...stops.map((s) => `NAMED STOP: ${s}`),
  ];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${APPLY && changes.length ? 'true' : 'false'}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`entity watch failed: ${e.stack || e}`); process.exit(1); });
}
