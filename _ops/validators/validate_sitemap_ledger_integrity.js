'use strict';
/**
 * sitemap.xml and data/cadence/lastmod_ledger.json are one artefact. Assert they
 * were committed together, and that every lane that can separate them cannot.
 *
 * The defect this closes, reproduced before it was fixed. site_build.js writes
 * both files on every build: the ledger holds a per-URL content hash so a page
 * whose content did not change keeps the <lastmod> it already had, and the
 * sitemap is stamped from it. No workflow committed the ledger. So each daily
 * release committed the relinked pages and the new sitemap, threw the ledger
 * away, and the next build compared the current pages against a ledger frozen at
 * the last hand-authored PR - every page the release had touched looked changed
 * again, and got the build date again.
 *
 * Four simulated daily runs using Content Publish's exact `git add` scope moved
 * one sibling insight through 2026-08-31, 09-01, 09-02, 09-03 with no content
 * change after the first day. Repeating the simulation with the ledger staged
 * held it at 2026-08-31. That rolling bump is the uniform_lastmod pattern
 * scripts/cadence_gate.js exists to flag, and it destroys the freshness signal
 * that is the strongest single correlate of an answer-engine citation.
 *
 * Two assertions, both behavioural:
 *
 *   A. State. Every <lastmod> in the committed sitemap.xml equals the committed
 *      ledger's date for that URL. If a release commits a sitemap without its
 *      ledger, the two disagree the moment anything is rebuilt, and this fails.
 *
 *   B. Reachability. The rule is derived, not a hard-coded list of workflows: any
 *      workflow that runs a site build AND stages a path the ledger describes
 *      (pages, or sitemap.xml) must also stage the ledger. A new lane that builds
 *      and commits pages inherits the requirement without anyone remembering to
 *      add it here.
 *
 * Hard-fails if it examines zero sitemap URLs or zero workflows, so an empty or
 * moved input can never read as a pass.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const ROOT = process.cwd();
const LEDGER_PATH = path.join(ROOT, 'data', 'cadence', 'lastmod_ledger.json');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');
const LEDGER_REL = 'data/cadence/lastmod_ledger.json';

// A step that regenerates sitemap.xml and the ledger. `npm run build` is the
// direct form; the composite scripts are the indirect ones, and they are read
// out of package.json rather than listed, so a new composite that includes the
// build is caught too.
function buildingScripts() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  const direct = new Set();
  for (const [name, body] of Object.entries(scripts)) {
    if (/scripts\/site_build\.js/.test(body)) direct.add(name);
  }
  // Transitively: a script that runs `npm run <a building script>`.
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of Object.entries(scripts)) {
      if (direct.has(name)) continue;
      for (const inner of direct) {
        if (new RegExp(`npm run ${inner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|&)`).test(body)) {
          direct.add(name);
          grew = true;
          break;
        }
      }
    }
  }
  return direct;
}

const findings = [];

// ---------------------------------------------------------------- A. state
if (!fs.existsSync(LEDGER_PATH)) fail(`ledger-missing: ${LEDGER_REL} does not exist; sitemap lastmod cannot survive a rebuild.`);
if (!fs.existsSync(SITEMAP_PATH)) fail('sitemap-missing: sitemap.xml does not exist.');

let ledger;
try {
  ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
} catch (error) {
  fail(`ledger-unreadable: ${LEDGER_REL} is not valid JSON (${error.message}).`);
}
const entries = (ledger && ledger.entries) || {};
if (!Object.keys(entries).length) fail(`ledger-empty: ${LEDGER_REL} carries no entries; nothing to verify.`);

const sitemapXml = fs.readFileSync(SITEMAP_PATH, 'utf8');
const rows = [...sitemapXml.matchAll(/<url><loc>(.*?)<\/loc>(?:<lastmod>(.*?)<\/lastmod>)?<\/url>/g)];
if (!rows.length) fail('sitemap-has-no-urls: sitemap.xml parsed to zero <url> entries; the parity check examined nothing.');

let dated = 0;
const disagreements = [];
const unledgered = [];
for (const [, url, lastmod] of rows) {
  if (!lastmod) continue;
  dated += 1;
  const entry = entries[url];
  if (!entry) {
    unledgered.push(`${url} carries <lastmod>${lastmod}</lastmod> but has no ledger entry`);
  } else if (String(entry.lastmod) !== String(lastmod)) {
    disagreements.push(`${url}: sitemap says ${lastmod}, ledger says ${entry.lastmod}`);
  }
}
if (!dated) fail('sitemap-has-no-lastmod: no <lastmod> in sitemap.xml, so the ledger governs nothing.');

if (unledgered.length) {
  findings.push(
    `ledger-behind-sitemap: ${unledgered.length} dated sitemap URL(s) are absent from the committed ledger. A release ` +
      'committed sitemap.xml without data/cadence/lastmod_ledger.json; the next build will re-stamp those pages with ' +
      'the build date instead of the date their content changed.'
  );
  findings.push(...unledgered.slice(0, 10).map((line) => `  - ${line}`));
}
if (disagreements.length) {
  findings.push(`ledger-disagrees-with-sitemap: ${disagreements.length} URL(s) carry a different date in each file.`);
  findings.push(...disagreements.slice(0, 10).map((line) => `  - ${line}`));
}

// -------------------------------------------------------- B. reachability
const builders = buildingScripts();
if (!builders.size) fail('no-build-script: package.json declares no script that runs scripts/site_build.js.');

const workflowFiles = fs.existsSync(WORKFLOW_DIR)
  ? fs.readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name)).sort()
  : [];
if (!workflowFiles.length) fail('no-workflows: .github/workflows contains no workflow files; the reachability rule examined nothing.');

const governed = [];
for (const name of workflowFiles) {
  const body = fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');
  const runsBuild =
    /scripts\/site_build\.js/.test(body) ||
    [...builders].some((script) => new RegExp(`npm run ${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'm').test(body));
  if (!runsBuild) continue;

  // Only the `git add` lines matter - a comment mentioning a path stages nothing.
  const addLines = body.split('\n').filter((line) => /^\s*git add\s/.test(line));
  if (!addLines.length) continue;
  const staged = addLines.join(' ');
  const stagesLedgerDescribedPaths = /(^|\s)pages(\/\S*)?(\s|$)/.test(staged) || /(^|\s)sitemap\.xml(\s|$)/.test(staged);
  if (!stagesLedgerDescribedPaths) continue;

  governed.push(name);
  if (!staged.includes(LEDGER_REL)) {
    findings.push(
      `ledger-not-committed: .github/workflows/${name} runs a site build and stages pages/ or sitemap.xml, but does ` +
        `not stage ${LEDGER_REL}. Every release it makes will re-stamp the pages it touched with the build date on ` +
        'the following build. Add the ledger to its git add scope.'
    );
  }
  if (!/(^|\s)sitemap\.xml(\s|$)/.test(staged)) {
    findings.push(
      `sitemap-not-committed: .github/workflows/${name} runs a site build and commits page content without staging ` +
        'sitemap.xml, so the committed sitemap stops describing the committed pages.'
    );
  }
}

if (!governed.length) {
  fail(
    'no-governed-workflows: no workflow both runs a site build and commits pages/ or sitemap.xml. Either the release ' +
      'lanes moved or this rule stopped matching them; a rule that governs nothing is worse than no rule.'
  );
}

if (findings.length) fail(findings);

console.log(
  `Sitemap/lastmod-ledger integrity OK (${rows.length} sitemap URL(s), ${dated} dated, all agreeing with the ` +
    `${Object.keys(entries).length}-entry committed ledger; ${governed.length} build-and-commit workflow(s) governed - ` +
    `${governed.join(', ')} - each staging both sitemap.xml and ${LEDGER_REL}).`
);
