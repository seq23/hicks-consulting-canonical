#!/usr/bin/env node
/**
 * Social Ingestion is a SCHEDULED lane. Nobody watches it; it pages the owner when
 * it goes red and it is believed when it goes green. Both of those had failed in
 * opposite directions at once:
 *
 *   A DECISION WAS REPORTED AS A FAILURE. Three sources in config/social_sources.json
 *   carry `enabled: false` and a written `reasonDisabled` - no no-auth endpoint, no
 *   credential. social_signal_ingest.js never read `enabled`, so it handed all three
 *   to fetch() anyway, and since they hold no `url` each came back
 *   `status: "degraded", error: "Failed to parse URL from undefined"`. Every
 *   committed source_health.json on main carries those three fake failures. A
 *   platform this repo deliberately does not ingest looked exactly like a feed that
 *   had gone down.
 *
 *   A TOTAL OUTAGE WAS REPORTED AS A SUCCESS. With every source unreachable the run
 *   printed "Social signal ingestion complete: 7 signals (fallback mode)" and exited
 *   0. The seven were the hard-coded seedQueries in the script. Nothing named the
 *   outage, validate_source_health.js checked only the SHAPE of source_health.json
 *   and printed "Source health contract OK" regardless of status, and the clustering,
 *   scoring and drafting downstream all ran on seven constant strings while CI stayed
 *   green. Rule 0's "runs but inert", on a lane whose entire purpose is to bring in
 *   demand nobody has seen yet.
 *
 * The contract this asserts
 * -------------------------
 *   1. A source disabled by configuration is STOPPED, by name, carrying its reason.
 *      Never fetched, never counted as degraded, never a non-zero exit.
 *   2. A run that ingests no external signal is a NAMED STOP - printed, recorded, and
 *      exit 0, because one flaky night across a set of no-auth public feeds must not
 *      page anyone.
 *   3. That named stop is COUNTED. fallbackStreak survives across runs, and at
 *      fallbackStreakLimit this check HARD-FAILS. Ten days of zero measured demand is
 *      not a stop, it is a dead ingestion, and it has to reach a human.
 *   4. Missing credentials are stops, not crashes, everywhere in the lane -
 *      ingest_gsc_evidence.mjs with no service account, and score_discovery_gap.mjs
 *      with an unusable snapshot under --allow-missing-snapshot.
 *
 * Everything below is proved by RUNNING the real scripts against synthetic trees, not
 * by reading them. Hard-fails if it runs zero probes or if the live source list is
 * empty, so it cannot pass having examined nothing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { fail } = require('../validation/protocol');

const repoRoot = process.cwd();
const INGEST = path.join(repoRoot, 'scripts', 'ingestion', 'social_signal_ingest.js');
const GSC_INGEST = path.join(repoRoot, 'scripts', 'queries', 'ingest_gsc_evidence.mjs');
const DISCOVERY = path.join(repoRoot, 'scripts', 'queries', 'score_discovery_gap.mjs');

const findings = [];
const probes = [];
function check(name, condition, detail) {
  probes.push(name);
  if (!condition) findings.push(`${name}: ${detail}`);
}

function scratch(sources, policyExtra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-stops-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'social_sources.json'), JSON.stringify({ sources }, null, 2));
  fs.writeFileSync(path.join(dir, 'config', 'social_ingestion_policy.json'), JSON.stringify({
    throttle: { delayMs: 1, maxRetries: 0, timeoutMs: 1500 },
    max_items_per_source_per_run: 25,
    ...policyExtra
  }, null, 2));
  return dir;
}

// Runs a script the way CI runs it and reports what actually happened, rather than
// throwing - an exit code is one of the things under test here.
function run(script, { cwd, args = [], env = {} }) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || '')
    };
  }
}

function health(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'intake', 'source_health.json'), 'utf8')); }
  catch { return null; }
}

const UNREACHABLE = 'http://127.0.0.1:9/feed.xml';

// ---------------------------------------------------------------- probe 1
// A source disabled by configuration is a named stop, not a degraded fetch.
{
  const dir = scratch([
    { id: 'no_endpoint_lane', name: 'Research lane', kind: 'research_lane', enabled: false, reasonDisabled: 'No no-auth endpoint approved for scheduled ingestion.' },
    { id: 'live_lane', name: 'Live', kind: 'rss', enabled: true, url: UNREACHABLE }
  ]);
  const result = run(INGEST, { cwd: dir });
  const h = health(dir);
  const stopped = (h?.sources || []).find((s) => s.id === 'no_endpoint_lane');

  check('disabled-source-exits-zero', result.code === 0,
    `a source with no credential and no endpoint took the lane down: exit ${result.code}. ${result.stderr.trim().slice(0, 300)}`);
  check('disabled-source-is-stopped-not-degraded', stopped?.status === 'stopped',
    `a source marked enabled:false was reported as "${stopped?.status}" instead of "stopped". A decision must not be indistinguishable from an outage.`);
  check('disabled-source-carries-its-reason', stopped?.namedStop === 'SOURCE_DISABLED_BY_CONFIGURATION' && String(stopped?.stopReason || '').includes('No no-auth endpoint'),
    'a stopped source did not carry SOURCE_DISABLED_BY_CONFIGURATION and its configured reasonDisabled verbatim.');
  check('disabled-source-was-never-fetched', !stopped?.error,
    `a source disabled by configuration was fetched anyway and recorded an error: ${stopped?.error}`);
  check('disabled-source-named-on-console', result.stdout.includes('SOURCE_DISABLED_BY_CONFIGURATION'),
    'the stop was recorded in the file but never printed, so nobody reading the scheduled run log would see it.');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- probe 2
// Every enabled source unreachable: green, named, counted - and NOT called complete.
{
  const dir = scratch([
    { id: 'down_a', name: 'A', kind: 'rss', enabled: true, url: UNREACHABLE },
    { id: 'down_b', name: 'B', kind: 'rss', enabled: true, url: UNREACHABLE }
  ]);
  const first = run(INGEST, { cwd: dir });
  const h1 = health(dir);

  check('total-outage-exits-zero', first.code === 0,
    `a transient total outage exited ${first.code} and would have paged the owner. A lane that ingests nothing must stop, not fail.`);
  check('total-outage-is-named', first.stdout.includes('NAMED STOP: SOCIAL_SOURCES_ALL_DEGRADED'),
    'a run that ingested no external signal printed no named stop. Green and silent is the failure this check exists to stop.');
  check('total-outage-not-called-complete', !/ingestion complete/i.test(first.stdout),
    'a run that ingested nothing still described itself as complete.');
  check('total-outage-recorded-in-file', h1?.mode === 'fallback' && Array.isArray(h1?.namedStops) && h1.namedStops.some((s) => s.stop === 'SOCIAL_SOURCES_ALL_DEGRADED'),
    'source_health.json did not record the named stop, so the outage survives only in a log GitHub deletes.');
  check('total-outage-counted', h1?.fallbackStreak === 1,
    `fallbackStreak was ${h1?.fallbackStreak} after one fallback-only run; an uncounted stop is a parking space.`);

  // probe 3: the streak survives across runs, which is what turns a stop into an escalation.
  const second = run(INGEST, { cwd: dir });
  const h2 = health(dir);
  check('streak-accumulates-across-runs', second.code === 0 && h2?.fallbackStreak === 2,
    `a second consecutive fallback-only run left fallbackStreak at ${h2?.fallbackStreak} (expected 2). Without accumulation the lane can be dead for months and never say so.`);
  check('streak-limit-is-published', Number(h2?.fallbackStreakLimit) > 0,
    'source_health.json does not publish the streak limit it is judged against.');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- probe 4
// A healthy source clears the stop and resets the count, so the escalation cannot
// latch on and cry wolf forever. Served from a data: URL rather than a socket, so
// the probe measures the ingestion and never the CI runner's network.
{
  const rss = '<?xml version="1.0"?><rss><channel>'
    + ['burnout recovery for working mothers', 'setting boundaries at work', 'therapy language gen z uses']
      .map((t) => `<item><title>${t}</title></item>`).join('')
    + '</channel></rss>';
  const dir = scratch([{ id: 'healthy', name: 'Healthy', kind: 'rss', enabled: true, url: `data:application/rss+xml,${encodeURIComponent(rss)}` }]);
  fs.mkdirSync(path.join(dir, 'data', 'intake'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'intake', 'source_health.json'), JSON.stringify({ fallbackStreak: 2 }));
  const result = run(INGEST, { cwd: dir });
  const h = health(dir);
  check('healthy-source-ingests', result.code === 0 && Number(h?.externalSignalCount) > 0,
    `a reachable source produced ${h?.externalSignalCount} external signal(s) at exit ${result.code}; this probe proves the ingestion still works, not merely that it stops well.`);
  check('healthy-source-clears-named-stop', Array.isArray(h?.namedStops) && h.namedStops.length === 0,
    'a healthy run still reported a named stop.');
  check('healthy-source-resets-streak', h?.fallbackStreak === 0,
    `a healthy run left fallbackStreak at ${h?.fallbackStreak}; an escalation that never resets becomes noise and gets ignored.`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- probe 5
// No Search Console credential is a stop. This is the specific shape that turns a
// scheduled lane red for a reason nobody can act on at 3am.
{
  const dir = scratch([]);
  const stripped = { GSC_SITE_URL: '', GSC_SERVICE_ACCOUNT_JSON: '', GSC_SERVICE_ACCOUNT_EMAIL: '', GSC_PRIVATE_KEY: '' };
  const result = run(GSC_INGEST, { cwd: dir, env: stripped });
  check('missing-gsc-credential-exits-zero', result.code === 0,
    `queries:ingest exited ${result.code} with no Search Console credential. A missing credential is a stop, not a failure.`);
  check('missing-gsc-credential-is-named', /no Search Console credentials/i.test(result.stdout + result.stderr),
    'queries:ingest exited 0 without saying why it did nothing.');
  check('missing-gsc-credential-writes-nothing', !fs.existsSync(path.join(dir, 'data', 'intake', 'query_signals_post_2027.json')),
    'a credential-less run wrote a query evidence file, which would overwrite measured demand with nothing.');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- probe 6
// An unusable Search Console snapshot stops the merge under the ingestion flag and
// fails without it - the same condition, two callers, two correct answers.
{
  const dir = scratch([]);
  fs.mkdirSync(path.join(dir, 'data', 'search'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data', 'agency'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'search', 'target_queries.json'), JSON.stringify({ queries: [] }));
  fs.writeFileSync(path.join(dir, 'data', 'agency', 'gsc_snapshot.json'), JSON.stringify({ status: 'error', error: 'credential revoked' }));

  const lenient = run(DISCOVERY, { cwd: dir, args: ['--allow-missing-snapshot'] });
  const strict = run(DISCOVERY, { cwd: dir });
  check('bad-snapshot-stops-the-ingestion-lane', lenient.code === 0 && /NAMED STOP: GSC_SNAPSHOT_NOT_OK/.test(lenient.stdout + lenient.stderr),
    `inside ingest:all an unusable snapshot exited ${lenient.code} instead of stopping by name.`);
  check('bad-snapshot-still-fails-a-direct-run', strict.code !== 0,
    'run directly, an unusable snapshot exited 0 - the flag had turned a real error into a silent one for every caller.');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------- the live tree
// Everything above proves the behaviour. This is the state it governs, and it is
// where the check refuses to pass on an empty input set.
const configPath = path.join(repoRoot, 'config', 'social_sources.json');
if (!fs.existsSync(configPath)) fail('config/social_sources.json is missing; the social ingestion lane has no governed source list at all.');
const liveSources = JSON.parse(fs.readFileSync(configPath, 'utf8')).sources || [];
if (!liveSources.length) fail('config/social_sources.json declares zero sources. A social ingestion contract that examines no sources is not passing.');

for (const source of liveSources) {
  if (source.enabled === false && !source.reasonDisabled) {
    findings.push(`config/social_sources.json: ${source.id} is disabled with no reasonDisabled. An undecided source is indistinguishable from a forgotten one.`);
  }
  if (source.enabled !== false && !source.url) {
    findings.push(`config/social_sources.json: ${source.id} is enabled but carries no url, so every run will record a fake failure for it.`);
  }
}

const liveHealthPath = path.join(repoRoot, 'data', 'intake', 'source_health.json');
if (!fs.existsSync(liveHealthPath)) {
  findings.push('data/intake/source_health.json is missing; the last scheduled ingestion left no record of what it reached.');
} else {
  const live = JSON.parse(fs.readFileSync(liveHealthPath, 'utf8'));
  const disabledIds = new Set(liveSources.filter((s) => s.enabled === false).map((s) => s.id));
  for (const source of live.sources || []) {
    if (disabledIds.has(source.id) && source.status !== 'stopped') {
      findings.push(`data/intake/source_health.json: ${source.id} is disabled in config but the last run recorded it as "${source.status}". Re-run npm run ingest:social.`);
    }
  }
  const streak = Number(live.fallbackStreak || 0);
  const limit = Number(live.fallbackStreakLimit || 3);
  if (streak >= limit) {
    findings.push(`Social ingestion has produced no external signal for ${streak} consecutive run(s), at or past its limit of ${limit}. `
      + 'This is no longer a transient outage: the clustering, scoring and drafting downstream have been running on the hard-coded seed queries. '
      + 'Repair or replace the sources in config/social_sources.json.');
  }
}

if (!probes.length) fail('validate_social_ingestion_stops ran zero probes and therefore proved nothing.');
if (probes.length < 6) fail(`validate_social_ingestion_stops ran only ${probes.length} probe(s); the behavioural suite did not execute.`);

if (findings.length) fail(findings);

const liveHealth = fs.existsSync(liveHealthPath) ? JSON.parse(fs.readFileSync(liveHealthPath, 'utf8')) : {};
const stoppedCount = liveSources.filter((s) => s.enabled === false).length;
console.log(`Social ingestion stops are named and green (${probes.length} behavioural probe(s) driving the real scripts: a source disabled by configuration is stopped rather than fetched, `
  + `a total outage exits 0 with a printed and recorded NAMED STOP, that stop is counted across runs and hard-fails at the limit, a healthy source resets it, `
  + `and both a missing Search Console credential and an unusable snapshot stop instead of failing. `
  + `Live: ${liveSources.length} source(s), ${stoppedCount} stopped by configuration each carrying a reason, fallback streak ${Number(liveHealth.fallbackStreak || 0)}/${Number(liveHealth.fallbackStreakLimit || 3)}).`);
