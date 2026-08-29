'use strict';
/**
 * The daily release has to be verified against the live site by a lane that a
 * GITHUB_TOKEN push can actually start. Assert that lane exists, is wired to a
 * schedule, and that its verifier is not inert.
 *
 * The hole this closes. Content Publish pushes with GITHUB_TOKEN, and GitHub does
 * not trigger workflows from a GITHUB_TOKEN push. `Postdeploy Smoke` and `Build`
 * are both `on: push`, so neither runs after the daily cron's own release commit.
 * Cloudflare Pages deploys anyway, watching the branch rather than the Actions
 * API - which is why the site is fine and why the gap was invisible. If Monday's
 * deploy fails, the manifest says an item is published, the URL 404s, and no
 * check anywhere notices.
 *
 * Three assertions:
 *
 *   A. A schedule-triggered lane exists that runs the verifier. Schedule, not
 *      push: push is precisely the trigger that does not fire, so a lane that
 *      only listens on push would satisfy the letter of the fix and none of it.
 *      Its cron must also run after the publish cron on the same days, or it
 *      would verify yesterday's release every morning.
 *
 *   B. The verifier is invoked by that workflow. A script nothing calls is the
 *      commonest way this repo has produced a stage that exists and does nothing.
 *
 *   C. The verifier is not inert - proved, not asserted. Its own check() is
 *      driven here with synthetic responses: a healthy site must pass, and each
 *      failure mode must fail. If the verifier were rewritten to return ok for
 *      everything, this validator would go red.
 *
 * Hard-fails if it examines zero workflows or zero faux scenarios.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const ROOT = process.cwd();
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');
const VERIFIER_REL = 'scripts/verification/verify_published_release.mjs';
const PUBLISH_WORKFLOW = path.join(WORKFLOW_DIR, 'content-publish.yml');

function cronsIn(body) {
  return [...body.matchAll(/-\s*cron:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

// Minutes past midnight UTC for a `M H * * D` cron, plus its day field.
function cronDaily(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, , , dow] = parts;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  return { minutes: Number(hour) * 60 + Number(minute), dow };
}

const findings = [];

if (!fs.existsSync(path.join(ROOT, VERIFIER_REL))) fail(`verifier-missing: ${VERIFIER_REL} does not exist.`);
if (!fs.existsSync(PUBLISH_WORKFLOW)) fail('publish-workflow-missing: .github/workflows/content-publish.yml does not exist.');

// ------------------------------------------------- A + B. the lane exists
const workflowFiles = fs.existsSync(WORKFLOW_DIR)
  ? fs.readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name)).sort()
  : [];
if (!workflowFiles.length) fail('no-workflows: .github/workflows contains no workflow files.');

const callers = [];
for (const name of workflowFiles) {
  const body = fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');
  // Only actual run steps count; a comment naming the script invokes nothing.
  const invokes = body
    .split('\n')
    .some((line) => !/^\s*#/.test(line) && line.includes(VERIFIER_REL));
  if (invokes) callers.push({ name, body });
}
if (!callers.length) {
  fail(
    `verifier-orphaned: ${VERIFIER_REL} exists but no workflow runs it. The live-deploy alert would be a file, not a check.`
  );
}

const publishCrons = cronsIn(fs.readFileSync(PUBLISH_WORKFLOW, 'utf8')).map(cronDaily).filter(Boolean);
if (!publishCrons.length) {
  fail('publish-cron-unreadable: content-publish.yml declares no daily cron, so there is nothing to schedule verification after.');
}
const publishAt = Math.min(...publishCrons.map((cron) => cron.minutes));

const scheduled = [];
for (const { name, body } of callers) {
  const crons = cronsIn(body).map(cronDaily).filter(Boolean);
  if (!crons.length) {
    findings.push(
      `verification-not-scheduled: .github/workflows/${name} runs the verifier but declares no usable schedule. ` +
        'A push-triggered check cannot close this gap - the cron pushes with GITHUB_TOKEN, which triggers no workflow.'
    );
    continue;
  }
  for (const cron of crons) {
    if (cron.dow !== '*') {
      findings.push(
        `verification-not-daily: .github/workflows/${name} verifies on cron day-of-week "${cron.dow}" while the ` +
          'release cron runs every day, so releases on the other days would go unverified.'
      );
    }
    if (cron.minutes <= publishAt) {
      findings.push(
        `verification-runs-before-publish: .github/workflows/${name} verifies at ${cron.minutes} minutes past midnight ` +
          `UTC, at or before the release at ${publishAt}. It would check the previous day's release, and a repair that ` +
          'runs before the stage it is meant to verify verifies nothing.'
      );
    }
  }
  scheduled.push(name);
}
if (!scheduled.length && !findings.length) fail('verification-lane-unscheduled: no scheduled workflow runs the verifier.');

// ------------------------------------------------ C. the verifier is live
const SITE = 'https://example.test';
const ROUTE = '/resources/insights/faux-item/';
const URL = `${SITE}${ROUTE}`;
const manifest = [
  { id: 'faux-old', status: 'published', slug: '/resources/insights/faux-old/', title: 'Older', publishedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'faux-item', status: 'published', slug: ROUTE, title: 'Newest', publishedAt: '2026-08-31T13:17:00.000Z' },
  { id: 'faux-future', status: 'approved', slug: '/resources/insights/faux-future/', title: 'Not yet', scheduledAt: '2026-12-01T13:00:00.000Z' }
];
const healthySitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n` +
  `  <url><loc>${SITE}/resources/insights/faux-old/</loc><lastmod>2026-01-01</lastmod></url>\n` +
  `  <url><loc>${URL}</loc><lastmod>2026-08-31</lastmod></url>\n</urlset>\n`;
const repoSitemap = healthySitemap;

function fetcherFrom(map) {
  return async (url) => map[url] || { status: 404, body: '' };
}

const scenarios = [
  {
    name: 'healthy live site',
    expectOk: true,
    manifest,
    repoSitemapXml: repoSitemap,
    responses: { [URL]: { status: 200, body: '<html>ok</html>' }, [`${SITE}/sitemap.xml`]: { status: 200, body: healthySitemap } }
  },
  {
    name: 'newest published route 404s (a failed Pages deploy)',
    expectOk: false,
    expectCode: 'live-route-not-served',
    manifest,
    repoSitemapXml: repoSitemap,
    responses: { [URL]: { status: 404, body: '' }, [`${SITE}/sitemap.xml`]: { status: 200, body: healthySitemap } }
  },
  {
    name: 'route serves but the live sitemap is behind the release',
    expectOk: false,
    expectCode: 'not-in-live-sitemap',
    manifest,
    repoSitemapXml: repoSitemap,
    responses: {
      [URL]: { status: 200, body: '<html>ok</html>' },
      [`${SITE}/sitemap.xml`]: { status: 200, body: `<urlset>\n  <url><loc>${SITE}/resources/insights/faux-old/</loc><lastmod>2026-01-01</lastmod></url>\n</urlset>\n` }
    }
  },
  {
    name: 'live sitemap smaller than the repo sitemap (partial deploy)',
    expectOk: false,
    expectCode: 'live-sitemap-behind-repo',
    manifest,
    repoSitemapXml: `${repoSitemap}<url><loc>${SITE}/extra/</loc><lastmod>2026-08-01</lastmod></url>\n`,
    responses: { [URL]: { status: 200, body: '<html>ok</html>' }, [`${SITE}/sitemap.xml`]: { status: 200, body: healthySitemap } }
  },
  {
    name: 'listed with no freshness signal',
    expectOk: false,
    expectCode: 'no-freshness-signal',
    manifest,
    repoSitemapXml: `<urlset>\n  <url><loc>${URL}</loc></url>\n</urlset>\n`,
    responses: {
      [URL]: { status: 200, body: '<html>ok</html>' },
      [`${SITE}/sitemap.xml`]: { status: 200, body: `<urlset>\n  <url><loc>${URL}</loc></url>\n</urlset>\n` }
    }
  },
  {
    name: 'live sitemap unreachable',
    expectOk: false,
    expectCode: 'live-sitemap-unreachable',
    manifest,
    repoSitemapXml: repoSitemap,
    responses: { [URL]: { status: 200, body: '<html>ok</html>' }, [`${SITE}/sitemap.xml`]: { status: 503, body: '' } }
  },
  {
    name: 'nothing published at all',
    expectOk: false,
    expectCode: 'nothing-published-to-verify',
    manifest: [{ id: 'faux-draft', status: 'approved', slug: '/resources/insights/faux-draft/', title: 'Draft' }],
    repoSitemapXml: repoSitemap,
    responses: {}
  }
];

(async () => {
  const { check, newestPublished } = await import(`file://${path.join(ROOT, VERIFIER_REL)}`);

  if (!newestPublished(manifest) || newestPublished(manifest).id !== 'faux-item') {
    findings.push(
      'newest-selection-wrong: the verifier did not pick the most recently published item out of a faux manifest, so ' +
        'it would verify the wrong URL after a release.'
    );
  }

  let ran = 0;
  for (const scenario of scenarios) {
    const result = await check({
      site: SITE,
      manifest: scenario.manifest,
      repoSitemapXml: scenario.repoSitemapXml,
      fetcher: fetcherFrom(scenario.responses)
    });
    ran += 1;
    if (result.ok !== scenario.expectOk) {
      findings.push(
        `verifier-inert: faux scenario "${scenario.name}" expected ok=${scenario.expectOk} and the verifier returned ` +
          `ok=${result.ok}. A verifier that returns the same answer whatever the live site does is not a verifier. ` +
          `Failures reported: ${JSON.stringify(result.failures)}`
      );
      continue;
    }
    if (scenario.expectCode && !result.failures.some((failure) => failure.startsWith(scenario.expectCode))) {
      findings.push(
        `verifier-misdiagnoses: faux scenario "${scenario.name}" failed as expected but reported ` +
          `${JSON.stringify(result.failures)} instead of ${scenario.expectCode}; an on-call reader would be sent the wrong way.`
      );
    }
  }
  if (!ran) fail('no-scenarios: the faux-data trace executed zero scenarios and proved nothing.');

  if (findings.length) fail(findings);

  console.log(
    `Live publication verification is wired and live (${callers.length} workflow(s) invoke ${VERIFIER_REL}; ` +
      `${scheduled.join(', ')} runs it on a daily schedule after the ${publishAt}-minute release cron, not on push, ` +
      `which a GITHUB_TOKEN release commit would never trigger; ${ran} faux scenario(s) traced through the verifier's ` +
      'own check(), 1 healthy and 6 broken, each producing the diagnosis it should).'
  );
})().catch((error) => fail(`validator-errored: ${error && error.stack ? error.stack : error}`));
