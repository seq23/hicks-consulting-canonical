const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fail } = require('../validation/protocol');

const root = process.cwd();
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-orchestrator-contract-'));

function write(relativePath, content) {
  const target = path.join(sandbox, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function run(checkId) {
  return spawnSync(process.execPath, ['_ops/validation/run_validation_matrix.js', '--check', checkId], {
    cwd: sandbox,
    encoding: 'utf8'
  });
}

function assert(condition, message, result) {
  if (!condition) {
    const details = result ? `\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}` : '';
    fail(`ORCHESTRATOR CONTRACT FAIL: ${message}${details}`);
  }
}

try {
  fs.mkdirSync(path.join(sandbox, '_ops', 'validation'), { recursive: true });
  fs.copyFileSync(path.join(root, '_ops', 'validation', 'run_validation_matrix.js'), path.join(sandbox, '_ops', 'validation', 'run_validation_matrix.js'));
  fs.copyFileSync(path.join(root, '_ops', 'validation', 'protocol.js'), path.join(sandbox, '_ops', 'validation', 'protocol.js'));

  write('_ops/validators/validate_validation_registry.js', "console.log('fixture registry ok');\n");
  write('_ops/validators/warning.js', "console.warn('VALIDATION_FINDING check=warning');\nconsole.warn('fixture warning');\nprocess.exit(0);\n");
  write('_ops/validators/hard.js', "console.error('VALIDATION_FINDING check=hard');\nconsole.error('fixture hard finding');\nprocess.exit(1);\n");
  write('_ops/validators/runtime.js', "throw new Error('fixture runtime crash');\n");
  write('_ops/validators/syntax.js', "const broken = ;\n");

  const checks = [
    {
      id: 'validation-registry', npmScript: 'validate:registry', entrypoint: '_ops/validators/validate_validation_registry.js', severity: 'HARD_FAIL', blocksRelease: true, group: 'governance', owner: 'fixture', scope: 'fixture', ciInvocation: 'MATRIX_ONLY', findingProtocol: 'VALIDATION_FINDING', enabled: true, rationale: 'fixture'
    },
    {
      id: 'warning', npmScript: 'validate:warning', entrypoint: '_ops/validators/warning.js', severity: 'STRONG_WARNING', blocksRelease: false, group: 'fixture', owner: 'fixture', scope: 'fixture', ciInvocation: 'MATRIX_ONLY', findingProtocol: 'VALIDATION_FINDING', enabled: true, rationale: 'fixture'
    },
    {
      id: 'hard', npmScript: 'validate:hard', entrypoint: '_ops/validators/hard.js', severity: 'HARD_FAIL', blocksRelease: true, group: 'fixture', owner: 'fixture', scope: 'fixture', ciInvocation: 'MATRIX_ONLY', findingProtocol: 'VALIDATION_FINDING', enabled: true, rationale: 'fixture'
    },
    {
      id: 'runtime', npmScript: 'validate:runtime', entrypoint: '_ops/validators/runtime.js', severity: 'STRONG_WARNING', blocksRelease: false, group: 'fixture', owner: 'fixture', scope: 'fixture', ciInvocation: 'MATRIX_ONLY', findingProtocol: 'VALIDATION_FINDING', enabled: true, rationale: 'fixture'
    },
    {
      id: 'syntax', npmScript: 'validate:syntax', entrypoint: '_ops/validators/syntax.js', severity: 'SOFT_WARNING', blocksRelease: false, group: 'fixture', owner: 'fixture', scope: 'fixture', ciInvocation: 'MATRIX_ONLY', findingProtocol: 'VALIDATION_FINDING', enabled: true, rationale: 'fixture'
    }
  ];

  write('_repo_validation_registry.json', JSON.stringify({
    schemaVersion: 'fixture',
    repo: 'orchestrator-fixture',
    policy: { findingMarker: 'VALIDATION_FINDING', unexpectedExecutionFailure: 'HARD_FAIL', directCiLeafInvocation: 'FORBIDDEN' },
    checks
  }, null, 2));
  write('_repo_validation_matrix.json', JSON.stringify({
    schemaVersion: 'fixture',
    registry: '_repo_validation_registry.json',
    profiles: { all: { checks: checks.map((check) => check.id) } }
  }, null, 2));

  let result = run('warning');
  assert(result.status === 0, 'strong warning finding must return success', result);
  assert(`${result.stdout}\n${result.stderr}`.includes('STRONG WARNING  warning'), 'strong warning must be classified visibly', result);

  result = run('hard');
  assert(result.status === 1, 'hard finding must block', result);
  assert(`${result.stdout}\n${result.stderr}`.includes('HARD FAIL  hard'), 'hard finding must be classified visibly', result);

  result = run('runtime');
  assert(result.status === 1, 'runtime crash in warning validator must block', result);
  assert(`${result.stdout}\n${result.stderr}`.includes('EXECUTION HARD FAIL  runtime'), 'runtime crash must be classified as execution hard fail', result);

  result = run('syntax');
  assert(result.status === 1, 'syntax error in warning validator must block', result);
  assert(`${result.stdout}\n${result.stderr}`.includes('Validator syntax check failed'), 'syntax error must be identified before execution', result);

  console.log('Validation orchestrator contract OK (warning pass, hard finding block, runtime crash block, syntax crash block).');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
