'use strict';
/**
 * SEARCH LOOP CALLER PIN
 *
 * .github/workflows/search-loop.yml calls the shared engine seq23/search-loop.
 * PR #65 passed open_loops_business and BOSS_OPEN_LOOPS_TOKEN (engine v1.7.0
 * features) while the pin stayed at v1.5.1, so the site kept running an engine
 * that turns a run with an exhausted target queue into a red
 * NAMED STOP [NOTHING_DONE] (fixed in v1.6.2: a CHECK that measured live pages
 * is not NOTHING_DONE; old-gate drops are retried). Red daily from 5 Nov 2026.
 *
 * This check fails when:
 *   1. the caller is missing, or names no `uses: ...@vX.Y.Z` pin (zero items);
 *   2. the `uses:` tag and `engine_ref:` differ (workflow and engine code drift);
 *   3. the pin is below FLOOR, or below the version an input/secret it passes needs.
 */
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');

const CALLER = process.env.SEARCH_LOOP_CALLER || '.github/workflows/search-loop.yml';
const FLOOR = '1.6.2';
// An input or secret the caller passes -> the first engine version that reads it.
const NEEDS = { open_loops_business: '1.7.0', BOSS_OPEN_LOOPS_TOKEN: '1.7.0' };

const full = path.resolve(process.cwd(), CALLER);
if (!fs.existsSync(full)) fail(`SEARCH LOOP PIN: ${CALLER} is missing; nothing to check.`);
const text = fs.readFileSync(full, 'utf8');

const uses = text.match(/uses:\s*seq23\/search-loop\/\.github\/workflows\/search-loop\.yml@v(\d+\.\d+\.\d+)/);
if (!uses) fail(`SEARCH LOOP PIN: ${CALLER} has no "uses: seq23/search-loop/.github/workflows/search-loop.yml@vX.Y.Z" pin.`);
const ref = text.match(/engine_ref:\s*v(\d+\.\d+\.\d+)/);
if (!ref) fail(`SEARCH LOOP PIN: ${CALLER} has no "engine_ref: vX.Y.Z".`);

const cmp = (a, b) => {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const problems = [];
const pin = uses[1];
if (ref[1] !== pin) problems.push(`uses@v${pin} but engine_ref v${ref[1]}: the workflow and the engine code must be the same release`);
if (cmp(pin, FLOOR) < 0) problems.push(`pin v${pin} is below v${FLOOR}, the first engine that does not turn an exhausted target queue into NAMED STOP [NOTHING_DONE]`);
for (const [name, need] of Object.entries(NEEDS)) {
  if (new RegExp(`^\\s*${name}:`, 'm').test(text) && cmp(pin, need) < 0) problems.push(`passes ${name}, which the engine reads from v${need}, but is pinned at v${pin}`);
}
if (problems.length) fail(problems.map((p) => `SEARCH LOOP PIN: ${CALLER}: ${p}`));
console.log(`search-loop caller pin OK: v${pin} (floor v${FLOOR}; ${Object.keys(NEEDS).filter((n) => text.includes(n)).length} version-gated input(s) checked)`);
