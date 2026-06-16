const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const root = process.cwd();
const registryPath = path.join(root, '_repo_validation_registry.json');
const matrixPath = path.join(root, '_repo_validation_matrix.json');
const packagePath = path.join(root, 'package.json');

function readJson(file, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing.`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

const registry = readJson(registryPath, '_repo_validation_registry.json');
const matrix = readJson(matrixPath, '_repo_validation_matrix.json');
const pkg = readJson(packagePath, 'package.json');
const scripts = pkg.scripts || {};
const allowedSeverities = new Set(['HARD_FAIL', 'STRONG_WARNING', 'SOFT_WARNING', 'INFO']);
const checks = registry.checks;

if (!Array.isArray(checks) || checks.length === 0) fail('registry.checks must be a non-empty array.');
if (matrix.registry !== '_repo_validation_registry.json') fail('matrix must reference _repo_validation_registry.json.');
if (registry.policy?.findingMarker !== 'VALIDATION_FINDING') fail('registry finding marker must be VALIDATION_FINDING.');
if (registry.policy?.unexpectedExecutionFailure !== 'HARD_FAIL') fail('unexpected validator execution failures must be HARD_FAIL.');
if (registry.policy?.directCiLeafInvocation !== 'FORBIDDEN') fail('direct CI leaf invocation must be FORBIDDEN.');

const ids = new Set();
const npmScripts = new Set();
const entrypoints = new Set();
for (const check of checks) {
  if (!check.id || ids.has(check.id)) fail(`check id is missing or duplicated: ${check.id}`);
  ids.add(check.id);
  if (!check.npmScript || npmScripts.has(check.npmScript)) fail(`npmScript is missing or duplicated: ${check.npmScript}`);
  npmScripts.add(check.npmScript);
  if (!check.entrypoint || entrypoints.has(check.entrypoint)) fail(`entrypoint is missing or duplicated: ${check.entrypoint}`);
  entrypoints.add(check.entrypoint);
  if (!allowedSeverities.has(check.severity)) fail(`${check.id} has invalid severity: ${check.severity}`);
  if (check.blocksRelease !== (check.severity === 'HARD_FAIL')) fail(`${check.id} blocksRelease does not match severity.`);
  if (!check.group || !check.owner || !check.scope || !check.rationale) fail(`${check.id} must define group, owner, scope, and rationale.`);
  if (check.ciInvocation !== 'MATRIX_ONLY') fail(`${check.id} must use MATRIX_ONLY CI invocation.`);
  if (check.findingProtocol !== 'VALIDATION_FINDING') fail(`${check.id} must use the VALIDATION_FINDING protocol.`);
  const expectedCommand = `node ${check.entrypoint}`;
  if (scripts[check.npmScript] !== expectedCommand) fail(`${check.npmScript} must map exactly to ${expectedCommand}.`);
  if (!fs.existsSync(path.join(root, check.entrypoint))) fail(`${check.id} entrypoint is missing: ${check.entrypoint}`);
}

const compositeScripts = matrix.compositeScripts || {};
for (const [script, profileName] of Object.entries(compositeScripts)) {
  if (!scripts[script]) fail(`Composite script is missing from package.json: ${script}`);
  if (!matrix.profiles?.[profileName]) fail(`Composite script ${script} references unknown profile ${profileName}.`);
  const expected = `node _ops/validation/run_validation_matrix.js --profile ${profileName}`;
  if (scripts[script] !== expected) fail(`${script} must map exactly to ${expected}.`);
}

const allValidateScripts = Object.keys(scripts).filter((name) => name.startsWith('validate:'));
const allowedScripts = new Set([...npmScripts, ...Object.keys(compositeScripts)]);
for (const script of allValidateScripts) {
  if (!allowedScripts.has(script)) fail(`validate script is neither registered nor declared composite: ${script}`);
}
for (const script of allowedScripts) {
  if (!allValidateScripts.includes(script)) fail(`registry or matrix references missing package validate script: ${script}`);
}

const profileEntries = Object.entries(matrix.profiles || {});
if (!profileEntries.length) fail('matrix.profiles must be a non-empty object.');
for (const [profileName, profile] of profileEntries) {
  if (!Array.isArray(profile.checks) || profile.checks.length === 0) fail(`profile ${profileName} must contain checks.`);
  const seen = new Set();
  for (const id of profile.checks) {
    if (!ids.has(id)) fail(`profile ${profileName} references unregistered check: ${id}`);
    if (seen.has(id)) fail(`profile ${profileName} duplicates check: ${id}`);
    seen.add(id);
  }
}

const enabledIds = checks.filter((check) => check.enabled !== false).map((check) => check.id);
const allProfile = matrix.profiles?.all?.checks || [];
if (JSON.stringify(allProfile) !== JSON.stringify(enabledIds)) {
  fail('The all profile must include every enabled registered check exactly once in registry order.');
}

const workflowsDir = path.join(root, '.github', 'workflows');
for (const file of fs.readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name))) {
  const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
  for (const match of content.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
    const script = match[1];
    if (npmScripts.has(script)) {
      fail(`Workflow ${file} invokes leaf validator ${script} directly; CI must use a registered matrix profile.`);
    }
  }
}

for (const gate of registry.releaseGates || []) {
  if (!gate.id || !gate.command || gate.severity !== 'HARD_FAIL' || !gate.owner || !gate.rationale) {
    fail(`release gate is incomplete or not HARD_FAIL: ${JSON.stringify(gate)}`);
  }
}

console.log(`Validation registry contract OK (${checks.length} checks, ${profileEntries.length} profiles, ${(registry.releaseGates || []).length} release gates).`);
