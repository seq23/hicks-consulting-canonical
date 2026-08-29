#!/usr/bin/env node
/**
 * Guard the three self-heal defects so none of them can return silently.
 *
 * (1) ORPHANED LOOP. _ops/selfheal/heal_until_clean.js runs the validation
 *     matrix, runs the `repair_command` each failing check declares, and
 *     re-validates. It worked - and nothing automated ever called it. It had two
 *     npm scripts, no workflow, no aggregate caller and no runbook reference, so
 *     the 8 registered repair commands were dead weight in CI. This asserts a
 *     scheduled workflow reaches it, that the workflow keeps the report even when
 *     the run fails, and that it commits what it repaired - a repair that dies
 *     with the runner is the same defect as one that never ran.
 *
 * (2) UNGUARDED <title>. No validator anywhere required a <title> element: a
 *     published page with the title deleted passed the entire gate, and the
 *     self-heal MISSING_TITLE repair was the only title guard in the repo - and
 *     it is skipped entirely when the page also carries a hard finding. This
 *     asserts the metadata contract checks <title> and that it uses the SAME
 *     minimum length as the repairer, so the contract and the repair cannot
 *     drift into disagreeing about what "has a title" means.
 *
 * (3) A COMMIT MESSAGE THAT LIED. The self-heal lane committed "apply bounded
 *     validated repairs" on every run, including runs that repaired nothing: the
 *     `git diff --cached --quiet` guard fired on the state file the script
 *     rewrites unconditionally. This asserts the run emits a machine-readable
 *     receipt carrying the commit subject, and that the lane uses it instead of
 *     a hardcoded claim.
 *
 * Hard-fails if it examines zero workflows or zero registered repairs. A
 * validator that passes on an empty loop is the same "exists but proves nothing"
 * defect it is here to prevent.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const problems = [];
const problem = (message) => problems.push(message);
const readText = (file) => {
  if (!fs.existsSync(file)) { problem(`missing ${file}`); return ''; }
  return fs.readFileSync(file, 'utf8');
};
const readJson = (file) => {
  try { return JSON.parse(readText(file)); } catch (error) { problem(`unreadable JSON: ${file} (${error.message})`); return null; }
};

const LOOP = '_ops/selfheal/heal_until_clean.js';
const CYCLE = 'scripts/autonomy/run_self_heal_cycle.mjs';
const REPAIRER = 'scripts/autonomy/lib/self_heal.mjs';
const METADATA = '_ops/validators/validate_seo_metadata_contract.js';
const SELF_HEAL_LANE = '.github/workflows/autonomy-self-heal.yml';
const RECEIPT = 'reports/self-heal-outcome.json';
const WF_DIR = '.github/workflows';

const pkg = readJson('package.json') || {};
const scripts = pkg.scripts || {};
const registry = readJson('_repo_validation_registry.json') || { checks: [] };

const loopSource = readText(LOOP);
const cycleSource = readText(CYCLE);
const repairerSource = readText(REPAIRER);
const metadataSource = readText(METADATA);

// ------------------------------------------------- (1) the loop has a real caller
const loopBasename = path.basename(LOOP);
const directScripts = Object.entries(scripts)
  .filter(([, body]) => String(body).includes(loopBasename))
  .map(([name]) => name);
if (!directScripts.length) {
  problem(`${LOOP} has no npm script invoking it - an orphaned repair loop is indistinguishable from no repair loop.`);
}

// Which npm scripts reach the loop, directly or through composition.
const reaching = new Set(directScripts);
for (let pass = 0; pass < 5; pass += 1) {
  for (const [name, body] of Object.entries(scripts)) {
    for (const target of [...reaching]) {
      if (new RegExp(`npm run ${target}(\\s|$|&)`).test(String(body))) reaching.add(name);
    }
  }
}

const workflowFiles = fs.existsSync(WF_DIR)
  ? fs.readdirSync(WF_DIR).filter((file) => /\.ya?ml$/.test(file))
  : [];
if (!workflowFiles.length) {
  problem(`${WF_DIR} holds no workflows - refusing to conclude anything about invocation from an empty directory.`);
}

const workflows = workflowFiles.map((file) => ({ file, text: fs.readFileSync(path.join(WF_DIR, file), 'utf8') }));
const invoking = workflows.filter(({ text }) => {
  for (const match of text.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
    if (reaching.has(match[1])) return true;
  }
  return false;
});

if (!invoking.length) {
  problem(`no workflow invokes ${LOOP} (directly or through a composing npm script) - the loop and the ${registry.checks.filter((c) => c.repair_command).length} registered repair commands never run in CI.`);
}

for (const { file, text } of invoking) {
  if (!/^\s*schedule:/m.test(text)) {
    problem(`${file} runs the self-heal loop but has no schedule - a lane that only runs when a human remembers it is not automation.`);
  }
  if (!/upload-artifact/.test(text)) {
    problem(`${file} does not upload the loop report; an UNRESOLVED report is the most useful artifact this lane produces.`);
  } else {
    const upload = text.slice(text.indexOf('upload-artifact'));
    const uploadBlock = text.slice(Math.max(0, text.indexOf('upload-artifact') - 400), text.indexOf('upload-artifact') + 400);
    if (!/if:\s*always\(\)/.test(uploadBlock)) {
      problem(`${file} uploads the loop report without \`if: always()\`, so the report is lost on exactly the runs that needed it.`);
    }
    if (!/if-no-files-found:\s*error/.test(upload)) {
      problem(`${file} uploads the loop report without \`if-no-files-found: error\`, so a missing report passes as a silent no-op.`);
    }
  }
  if (!/git commit/.test(text) || !/git push/.test(text)) {
    problem(`${file} does not commit and push the repaired artifacts, so every repair dies with the runner and the next run repairs the same breakage.`);
  }
  if (/git add[^\n]*data\/admin/.test(text)) {
    problem(`${file} stages data/admin; no registered repair writes it and staging it races the admin surface.`);
  }
  if (!/group:\s*hicks-consulting-content-automation/.test(text)) {
    problem(`${file} is a writer lane outside the shared hicks-consulting-content-automation concurrency group.`);
  }
}

// ------------------------------------------- (1b) the registered repairs are real
const repairs = (registry.checks || []).filter((check) => check.repair_command);
if (!repairs.length) {
  problem('the validation registry declares zero repair_command entries - refusing to pass on an empty loop.');
}
for (const check of repairs) {
  const match = String(check.repair_command).match(/^npm run ([A-Za-z0-9:_-]+)$/);
  if (!match) {
    problem(`check ${check.id} declares a repair_command that is not a plain npm script: ${check.repair_command}`);
    continue;
  }
  if (!scripts[match[1]]) {
    problem(`check ${check.id} declares repair_command "${check.repair_command}" but no such npm script exists.`);
  }
}

// -------------------------------------------------------- (2) the <title> contract
const repairerBar = (repairerSource.match(/<title>\[\^<\]\{(\d+),\}<\\?\/title>/) || [])[1];
const contractBar = (metadataSource.match(/TITLE_MIN_LENGTH\s*=\s*(\d+)/) || [])[1];
if (!/<title>/.test(metadataSource)) {
  problem(`${METADATA} does not check for a <title> element; a page can ship untitled and pass the whole gate.`);
}
if (!contractBar) {
  problem(`${METADATA} does not declare TITLE_MIN_LENGTH, so the title bar is not stated anywhere it can be compared.`);
}
if (!repairerBar) {
  problem(`${REPAIRER} no longer raises MISSING_TITLE from a minimum-length <title> pattern.`);
}
if (repairerBar && contractBar && repairerBar !== contractBar) {
  problem(`the metadata contract requires a <title> of ${contractBar} characters but the self-heal repairer raises MISSING_TITLE below ${repairerBar}; a page can sit permanently between the two, failing the contract with nothing willing to repair it.`);
}
if (!/examined zero public pages/.test(metadataSource)) {
  problem(`${METADATA} has no zero-page guard, so it would pass on an unreadable pages tree.`);
}

// ------------------------------------------------ (3) the lane reports honestly
if (!cycleSource.includes(RECEIPT)) {
  problem(`${CYCLE} does not write ${RECEIPT}; without a receipt the lane has to guess what the run did.`);
}
if (!/commitMessage/.test(cycleSource)) {
  problem(`${CYCLE} does not emit a commitMessage, so the lane cannot name what actually happened.`);
}
// The paused/stopped branch returns before the state file is written. If it does
// not also write the receipt, the lane reads a stale message from a previous run.
const pausedBranch = cycleSource.slice(0, cycleSource.indexOf('process.exit(0)') + 1);
if (pausedBranch && !/writeOutcome\(/.test(pausedBranch)) {
  problem(`${CYCLE} does not write the receipt on the paused/stopped path, so a paused run would be committed under the previous run's message.`);
}

const laneText = readText(SELF_HEAL_LANE);
if (/git commit -m ["']Self-heal: apply bounded validated repairs["']/.test(laneText)) {
  problem(`${SELF_HEAL_LANE} still hardcodes "Self-heal: apply bounded validated repairs"; a run that repaired nothing commits a message claiming repairs it did not make.`);
}
if (laneText && !laneText.includes(RECEIPT)) {
  problem(`${SELF_HEAL_LANE} does not read ${RECEIPT}, so its commit subject is not derived from what the run actually did.`);
}
if (/git add[^\n]*data\/admin/.test(laneText)) {
  problem(`${SELF_HEAL_LANE} stages data/admin, which the self-heal cycle only reads and never writes.`);
}

// ------------------------------------------------------------------- verdict
if (problems.length) {
  fail(['Self-heal integrity contract failed:', ...problems.map((message) => `- ${message}`)]);
}

console.log(
  `Self-heal integrity OK (${LOOP} reached by ${invoking.map((entry) => entry.file).join(', ')} on a schedule, report kept on failure and repairs committed; `
  + `${repairs.length} registered repair commands all resolve to real npm scripts; `
  + `<title> required at ${contractBar} characters by the metadata contract and repaired at the same bar; `
  + `the self-heal lane derives its commit subject from ${RECEIPT}).`
);
