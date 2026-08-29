#!/usr/bin/env node
/**
 * Assert that what the repo says is published is actually live.
 *
 * Why this exists. Content Publish pushes with GITHUB_TOKEN, and a GITHUB_TOKEN
 * push never triggers another workflow. So `Postdeploy Smoke` and `Build`, both
 * of which are `on: push`, do not run after the cron's own release commit.
 * Cloudflare Pages still deploys - it watches the branch, not the Actions API -
 * so the site is normally fine. But if that deploy fails, or the release lands a
 * route Pages will not serve, nothing anywhere alerts anyone. The client's site
 * would sit with a published item in its manifest and a 404 at the URL, and the
 * first person to find out would be a reader.
 *
 * The fix has to be schedule-triggered, because push-triggered is precisely what
 * does not fire. This runs on its own cron, half an hour after the publish cron,
 * and checks the live site over HTTP.
 *
 * What it checks, every day, whether or not anything published today:
 *   1. the most recently published item in data/admin/content_manifest.json
 *      returns 200 at its live URL;
 *   2. that URL appears in the live sitemap.xml, with a <lastmod>;
 *   3. the live sitemap is not smaller than the repo's own sitemap, which is how
 *      a partial or reverted deploy shows up.
 *
 * There is no "nothing to do" path. On a day with no release the newest item is
 * simply the one from the last release, and verifying it is real work: it is the
 * check that catches a deploy that silently stopped serving. Hard-fails if the
 * manifest contains nothing published, rather than passing an empty check.
 *
 * Traceable with faux data. `check()` takes its fetcher as an argument, so
 * _ops/validators/validate_live_publication_verification.js drives this exact
 * code path with synthetic 200/404 responses and synthetic sitemaps and proves
 * each assertion actually fails when it should. A verifier that cannot be shown
 * to fail is not a verifier.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DEFAULT_SITE = 'https://www.hicksconsulting.org';

export function newestPublished(manifest) {
  const published = (Array.isArray(manifest) ? manifest : []).filter(
    (item) => item && item.status === 'published' && typeof item.slug === 'string' && item.slug.startsWith('/')
  );
  if (!published.length) return null;
  const key = (item) => String(item.publishedAt || item.scheduledAt || '');
  return published.slice().sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : a.id < b.id ? 1 : -1))[0];
}

export function repoSitemapUrlCount(xml) {
  return (String(xml).match(/<loc>/g) || []).length;
}

/**
 * Pure check. `fetcher(url)` must resolve to { status, body }.
 * Returns { ok, failures[], checks[] } and never throws on a failed assertion,
 * so a caller can assert on the failures rather than on an exit code.
 */
export async function check({ site, manifest, repoSitemapXml, fetcher }) {
  const failures = [];
  const checks = [];
  const newest = newestPublished(manifest);
  if (!newest) {
    return {
      ok: false,
      newest: null,
      checks,
      failures: [
        'nothing-published-to-verify: data/admin/content_manifest.json contains no item with status "published". ' +
          'This check has no meaningful empty state - a repo that claims a live editorial library and offers zero ' +
          'published items to verify is itself the finding.'
      ]
    };
  }

  const pageUrl = `${site}${newest.slug}`;
  const page = await fetcher(pageUrl);
  checks.push(`newest published item ${newest.id} -> ${pageUrl} returned ${page.status}`);
  if (page.status !== 200) {
    failures.push(
      `live-route-not-served: ${pageUrl} returned ${page.status}. The manifest says this item is published; the live ` +
        'site disagrees. Most likely the Cloudflare Pages deploy for the release commit failed or was never triggered.'
    );
  }

  const sitemapUrl = `${site}/sitemap.xml`;
  const live = await fetcher(sitemapUrl);
  checks.push(`live sitemap ${sitemapUrl} returned ${live.status}`);
  if (live.status !== 200) {
    failures.push(`live-sitemap-unreachable: ${sitemapUrl} returned ${live.status}.`);
    return { ok: false, newest, checks, failures };
  }

  const liveXml = String(live.body || '');
  const liveCount = repoSitemapUrlCount(liveXml);
  checks.push(`live sitemap carries ${liveCount} url(s)`);
  if (!liveXml.includes(`<loc>${pageUrl}</loc>`)) {
    failures.push(
      `not-in-live-sitemap: ${pageUrl} is published in the manifest but absent from the live sitemap, so no crawler ` +
        'will be told it exists. The deployed sitemap is behind the release.'
    );
  } else {
    const entry = liveXml.match(new RegExp(`<url><loc>${pageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>(.*?)</url>`));
    if (entry && !/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(entry[1])) {
      failures.push(
        `no-freshness-signal: ${pageUrl} is in the live sitemap with no <lastmod>. data/cadence/policy.json treats a ` +
          'missing lastmod as blocking, and recency is the strongest single correlate of an answer-engine citation.'
      );
    }
  }

  const repoCount = repoSitemapUrlCount(repoSitemapXml);
  checks.push(`repo sitemap carries ${repoCount} url(s)`);
  if (repoCount && liveCount < repoCount) {
    failures.push(
      `live-sitemap-behind-repo: the live sitemap serves ${liveCount} url(s) where the repo's committed sitemap.xml ` +
        `has ${repoCount}. A deploy that shrank the sitemap is a partial or reverted release.`
    );
  }

  return { ok: failures.length === 0, newest, checks, failures };
}

async function httpFetcher(url) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'hicks-publish-verification/1.0' } });
  const body = await response.text();
  return { status: response.status, body };
}

async function main() {
  const site = String(process.env.SITE_URL || DEFAULT_SITE).replace(/\/$/, '');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'admin', 'content_manifest.json'), 'utf8'));
  const repoSitemapPath = path.join(ROOT, 'sitemap.xml');
  const repoSitemapXml = fs.existsSync(repoSitemapPath) ? fs.readFileSync(repoSitemapPath, 'utf8') : '';
  const result = await check({ site, manifest, repoSitemapXml, fetcher: httpFetcher });

  console.log(`Live publication verification against ${site}`);
  if (result.newest) {
    console.log(`  newest published item: ${result.newest.id} (${result.newest.publishedAt || result.newest.scheduledAt})`);
    console.log(`  title: ${result.newest.title}`);
  }
  for (const line of result.checks) console.log(`  - ${line}`);

  if (!result.ok) {
    console.error('');
    console.error('LIVE PUBLICATION VERIFICATION FAILED');
    for (const failure of result.failures) console.error(`  ! ${failure}`);
    console.error('');
    console.error('This lane exists because Content Publish pushes with GITHUB_TOKEN, which triggers no workflow.');
    console.error('Nothing else checks the live site after a scheduled release.');
    process.exit(1);
  }
  console.log('');
  console.log(`OK - the newest published item is served, listed in the live sitemap with a lastmod, and the live sitemap is not behind the repo.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`LIVE PUBLICATION VERIFICATION ERRORED: ${error && error.stack ? error.stack : error}`);
    process.exit(1);
  });
}
