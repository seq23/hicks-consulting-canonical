const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { FINDING_MARKER } = require('./protocol');

const root = process.cwd();

function fatal(message, details = '') {
  console.error(`VALIDATION ORCHESTRATOR HARD FAIL: ${message}`);
  if (details) console.error(details);
  process.exit(1);
}

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) fatal(`${relativePath} is missing.`);
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    fatal(`${relativePath} is invalid JSON.`, error.message);
  }
}

function clean(text) {
  return String(text || '').trim();
}

function githubAnnotation(level, title, message) {
  if (!process.env.GITHUB_ACTIONS) return;
  const escaped = String(message || '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
  console.log(`::${level} title=${title}::${escaped}`);
}

const registry = readJson('_repo_validation_registry.json');
const matrix = readJson('_repo_validation_matrix.json');

const bootstrapCheck = Array.isArray(registry.checks)
  ? registry.checks.find((entry) => entry.id === 'validation-registry')
  : null;
if (!bootstrapCheck) fatal('Registry bootstrap check validation-registry is missing.');
if (bootstrapCheck.severity !== 'HARD_FAIL' || bootstrapCheck.blocksRelease !== true) {
  fatal('Registry bootstrap check must remain a release-blocking HARD_FAIL.');
}
if (bootstrapCheck.entrypoint !== '_ops/validators/validate_validation_registry.js') {
  fatal('Registry bootstrap entrypoint is invalid.');
}
if (matrix.registry !== '_repo_validation_registry.json') {
  fatal('Validation matrix does not reference the canonical registry.');
}

const args = process.argv.slice(2);
const profileIndex = args.indexOf('--profile');
const checkIndex = args.indexOf('--check');
const profileName = profileIndex >= 0 ? args[profileIndex + 1] : 'all';
const requestedCheck = checkIndex >= 0 ? args[checkIndex + 1] : null;

if (profileIndex >= 0 && !profileName) fatal('--profile requires a profile name.');
if (checkIndex >= 0 && !requestedCheck) fatal('--check requires a registered check id.');
if (requestedCheck && profileIndex >= 0) fatal('Use either --profile or --check, not both.');

const checksById = new Map((registry.checks || []).map((entry) => [entry.id, entry]));
let selectedIds;
let selectionLabel;

if (requestedCheck) {
  if (!checksById.has(requestedCheck)) fatal(`Unknown registered check: ${requestedCheck}`);
  selectedIds = requestedCheck === 'validation-registry'
    ? ['validation-registry']
    : ['validation-registry', requestedCheck];
  selectionLabel = `check=${requestedCheck}`;
} else {
  const profile = matrix.profiles && matrix.profiles[profileName];
  if (!profile || !Array.isArray(profile.checks)) fatal(`Unknown or invalid validation profile: ${profileName}`);
  selectedIds = ['validation-registry', ...profile.checks];
  selectionLabel = `profile=${profileName}`;
}
selectedIds = [...new Set(selectedIds)];

const checks = selectedIds.map((id) => {
  const entry = checksById.get(id);
  if (!entry) fatal(`Validation matrix references unregistered check: ${id}`);
  return entry;
}).filter((entry) => entry.enabled !== false);

const totals = {
  PASS: 0,
  HARD_FAIL: 0,
  EXECUTION_HARD_FAIL: 0,
  STRONG_WARNING: 0,
  SOFT_WARNING: 0,
  INFO: 0
};
const findings = [];

function recordExecutionFailure(entry, reason, details) {
  totals.EXECUTION_HARD_FAIL += 1;
  findings.push({ id: entry.id, severity: 'EXECUTION_HARD_FAIL', reason, details });
  console.error(`EXECUTION HARD FAIL  ${entry.id} — ${reason}`);
  if (details) console.error(details);
  githubAnnotation('error', `EXECUTION HARD FAIL: ${entry.id}`, `${reason}\n${details || ''}`);
}

console.log(`Validation registry: ${registry.repo} (${checks.length} checks, ${selectionLabel})`);

for (const entry of checks) {
  const entrypoint = path.join(root, entry.entrypoint);
  if (!fs.existsSync(entrypoint)) {
    recordExecutionFailure(entry, 'Registered validator entrypoint is missing.', entry.entrypoint);
    continue;
  }

  const syntax = spawnSync(process.execPath, ['--check', entrypoint], {
    cwd: root,
    encoding: 'utf8'
  });
  if (syntax.error || syntax.signal || syntax.status !== 0) {
    recordExecutionFailure(
      entry,
      'Validator syntax check failed.',
      [clean(syntax.stderr), clean(syntax.stdout), syntax.error?.message, syntax.signal ? `signal=${syntax.signal}` : ''].filter(Boolean).join('\n')
    );
    continue;
  }

  const result = spawnSync(process.execPath, [entrypoint], {
    cwd: root,
    env: {
      ...process.env,
      VALIDATION_MATRIX_MODE: '1',
      VALIDATION_CHECK_ID: entry.id
    },
    encoding: 'utf8'
  });

  const stdout = clean(result.stdout);
  const stderr = clean(result.stderr);
  const combined = [stderr, stdout].filter(Boolean).join('\n');
  const hasFindingMarker = combined.includes(FINDING_MARKER);

  if (result.error || result.signal || result.status === null) {
    recordExecutionFailure(
      entry,
      'Validator process did not complete normally.',
      [combined, result.error?.message, result.signal ? `signal=${result.signal}` : ''].filter(Boolean).join('\n')
    );
    continue;
  }

  if (hasFindingMarker && ![0, 1].includes(result.status)) {
    recordExecutionFailure(entry, `Validator emitted a finding marker with unsupported exit code ${result.status}.`, combined);
    continue;
  }

  if (!hasFindingMarker && (result.status !== 0 || stderr.length > 0)) {
    recordExecutionFailure(
      entry,
      result.status !== 0
        ? `Validator exited ${result.status} without the registered finding protocol.`
        : 'Validator wrote unexpected stderr without the registered finding protocol.',
      combined
    );
    continue;
  }

  if (!hasFindingMarker) {
    totals.PASS += 1;
    console.log(`PASS  ${entry.id} — ${stdout || 'completed without findings'}`);
    continue;
  }

  totals[entry.severity] += 1;
  findings.push({ id: entry.id, severity: entry.severity, details: combined });

  if (entry.severity === 'HARD_FAIL') {
    console.error(`HARD FAIL  ${entry.id}\n${combined}`);
    githubAnnotation('error', `HARD FAIL: ${entry.id}`, combined);
  } else if (entry.severity === 'STRONG_WARNING') {
    console.warn(`STRONG WARNING  ${entry.id}\n${combined}`);
    githubAnnotation('warning', `STRONG WARNING: ${entry.id}`, combined);
  } else if (entry.severity === 'SOFT_WARNING') {
    console.warn(`SOFT WARNING  ${entry.id}\n${combined}`);
    githubAnnotation('notice', `SOFT WARNING: ${entry.id}`, combined);
  } else {
    console.log(`INFO FINDING  ${entry.id}\n${combined}`);
    githubAnnotation('notice', `INFO: ${entry.id}`, combined);
  }
}

console.log('\nVALIDATION REGISTRY SUMMARY');
console.log(`Pass: ${totals.PASS}`);
console.log(`Hard fail findings: ${totals.HARD_FAIL}`);
console.log(`Execution hard fail: ${totals.EXECUTION_HARD_FAIL}`);
console.log(`Strong warning: ${totals.STRONG_WARNING}`);
console.log(`Soft warning: ${totals.SOFT_WARNING}`);
console.log(`Info finding: ${totals.INFO}`);

if (totals.HARD_FAIL > 0 || totals.EXECUTION_HARD_FAIL > 0) {
  console.error('VALIDATION RESULT: BLOCKED');
  process.exit(1);
}

if (findings.length > 0) {
  console.log('VALIDATION RESULT: PASS WITH NON-BLOCKING FINDINGS');
} else {
  console.log('VALIDATION RESULT: PASS');
}
process.exit(0);
