const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

console.log('release:prepush profile: LOCAL_FULL');
const legacyBuildDir = path.join(process.cwd(), 'scripts', 'build');
if (fs.existsSync(legacyBuildDir)) {
  fs.rmSync(legacyBuildDir, { recursive: true, force: true });
  console.log('Removed legacy scripts/build directory excluded by updater v3.1 sync policy.');
}
const env = {
  ...process.env,
  NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072'
};
for (const args of [['run', 'build'], ['run', 'validate:all']]) {
  const result = spawnSync('npm', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('release:prepush local validation passed.');
