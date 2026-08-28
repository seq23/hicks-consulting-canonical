import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-autonomy-e2e-'));
const fail = (message) => { console.error(`VALIDATION_FINDING ${message}`); process.exitCode = 1; };
const copyDir = (src, dest) => fs.cpSync(path.join(repo, src), path.join(temp, dest), { recursive: true });
const writeJson = (rel, value) => { const full = path.join(temp, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`); };
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

try {
  copyDir('scripts/autonomy', 'scripts/autonomy');
  copyDir('pages/resources/articles/why-high-achieving-women-sometimes-mistake-numbness-for-maturity', 'pages/resources/articles/why-high-achieving-women-sometimes-mistake-numbness-for-maturity');

  writeJson('data/system/runtime_contract.json', { runtimeMode: 'FULL_SAFE_AUTONOMY' });
  writeJson('data/system/config.json', { canonicalDomain: 'https://www.hicksconsulting.org/' });
  writeJson('data/system/ownership_manifest.json', { protectedFacts: ['credentials','fees','insurance','availability','testimonials','physical locations'] });
  writeJson('data/system/publishing_velocity_contract.json', {
    authority: 'UNCHANGED_EXISTING_CLIENT_SYSTEM', lockedRecordCount: 1,
    cadence: { insightsPerBusinessWeek: 5, articlesPerWeek: 1, guidesPerMonth: 1, whitePapersPerQuarter: 1 }
  });
  writeJson('data/entities/author_profile.json', { name: 'Monika Hicks, LCSW', identity: 'Black woman therapist' });
  writeJson('data/entities/org_profile.json', { name: 'Hicks Consulting' });
  writeJson('data/intake/source_health.json', { status: 'fixture' });
  writeJson('data/autonomy/state.json', { paused: false, emergencyStop: false, currentPhase: 'IDLE', counts: {} });
  writeJson('data/autonomy/exceptions.json', { schemaVersion: '1.0.0', items: [] });
  writeJson('data/autonomy/revision_registry.json', { schemaVersion: '1.0.0', revisions: [] });
  writeJson('data/admin/content_manifest.json', [{
    id: 'baseline-article', title: 'Baseline Article', type: 'weekly', contentType: 'articles',
    slug: '/resources/articles/baseline-article/', status: 'approved', scheduledAt: '2026-08-04T13:00:00.000Z'
  }]);
  writeJson('data/autonomy/queue.json', { schemaVersion: '1.0.0', items: [{
    id: 'fixture-candidate', state: 'SCORED', score: 95, contentType: 'articles',
    title: 'A Grounded Way to Notice Overload Before It Builds', query: 'how to notice emotional overload',
    clusterId: 'fixture-cluster', minimumWords: 220, targetWords: 420,
    suggestedRoute: '/resources/articles/notice-overload-before-it-builds/'
  }] });

  const body = [
    'Overload can build quietly when someone is carrying several responsibilities at once. It may show up as irritability, mental fog, avoidance, or the sense that even ordinary decisions require too much effort. Noticing these signs is not the same as diagnosing yourself. It is a practical way to pause, gather information, and decide what kind of support would be useful.',
    'A grounded check-in begins with observable details. Notice what has changed in sleep, concentration, patience, appetite, boundaries, and recovery time. Then separate the facts from the story you are telling yourself. The fact may be that you have answered messages late every night this week. The story may be that a capable person should be able to keep going without rest.',
    'Small adjustments can create useful information. You might reduce one optional commitment, ask for a clearer deadline, take a short transition between meetings, or write down the decision that is using the most mental energy. The goal is not to solve your whole life in one afternoon. The goal is to make the next step easier to see.',
    'Support can take different forms. A trusted friend may help you name what has changed. Coaching may help with a non-clinical goal or decision. Therapy may provide space to understand patterns, emotions, and coping in greater depth. Virtual therapy through Hicks Consulting is available to eligible clients located in Tennessee, including people in Memphis.',
    'When overload feels intense, persistent, or connected to safety concerns, seek appropriate professional or crisis support. An educational article cannot assess an individual situation. It can only offer general reflection questions and encourage a thoughtful next step.'
  ].join('\n\n');
  writeJson('fixtures/safe-draft.json', {
    title: 'A Grounded Way to Notice Overload Before It Builds',
    description: 'A practical, non-diagnostic reflection on noticing overload and choosing a manageable next step.',
    shortAnswer: 'Notice observable changes, separate facts from self-judgment, reduce one source of pressure, and choose the next form of support that fits the situation.',
    sections: [
      { heading: 'Start with what you can observe', body },
      { heading: 'Choose one manageable adjustment', body },
      { heading: 'Know when another kind of support may help', body }
    ],
    sources: [], internalLinks: ['/therapy/', '/resources/', '/about/'],
    disclaimer: 'This educational resource does not provide diagnosis, crisis care, individualized treatment, or a guarantee of outcomes.'
  });

  const baselineManifest = fs.readFileSync(path.join(temp, 'data/admin/content_manifest.json'), 'utf8');
  const baselineHash = crypto.createHash('sha256').update(baselineManifest).digest('hex');
  const result = spawnSync(process.execPath, ['scripts/autonomy/run_cycle.mjs'], {
    cwd: temp,
    env: {
      ...process.env,
      LLM_FIXTURE_PATH: 'fixtures/safe-draft.json',
      AUTONOMY_CLOCK: '2026-08-06T22:00:00.000Z',
      AUTONOMY_MAX_ITEMS: '1',
      AUTONOMY_MINIMUM_WORD_OVERRIDE: '220'
    },
    encoding: 'utf8', timeout: 30000
  });
  if (result.status !== 0) fail(`end-to-end autonomy cycle exited ${result.status}: ${result.stderr || result.stdout}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'data/admin/content_manifest.json'), 'utf8'));
  const baseline = manifest.find((item) => item.id === 'baseline-article');
  const created = manifest.find((item) => item.id === 'auto-fixture-candidate');
  if (!baseline || baseline.scheduledAt !== '2026-08-04T13:00:00.000Z') fail('baseline scheduled content changed during autonomous scheduling.');
  if (!created) fail('autonomous candidate was not added to the content manifest.');
  if (created?.scheduledAt !== '2026-08-11T13:00:00.000Z') fail(`candidate was not assigned the next existing Tuesday article slot: ${created?.scheduledAt}`);
  if (created?.status !== 'approved' || created?.source !== 'full_safe_autonomy') fail('generated item does not carry the expected safe autonomous publication state.');
  if ('requiresApproval' in (created || {}) || created?.autonomy?.decision === 'APPROVAL_REQUIRED') fail('routine approval leaked into the autonomous manifest item.');

  const generated = path.join(temp, 'pages/resources/articles/notice-overload-before-it-builds/index.html');
  if (!fs.existsSync(generated)) fail('autonomy cycle did not render the public resource page.');
  else {
    const html = fs.readFileSync(generated, 'utf8');
    if (!html.includes('<h1>A Grounded Way to Notice Overload Before It Builds</h1>')) fail('rendered resource is missing its public H1.');
    if (!html.includes('Monika Hicks, LCSW')) fail('rendered resource is missing authorship identity.');
  }

  const queue = JSON.parse(fs.readFileSync(path.join(temp, 'data/autonomy/queue.json'), 'utf8'));
  const candidate = queue.items.find((item) => item.id === 'fixture-candidate');
  if (candidate?.state !== 'SCHEDULED') fail(`candidate did not complete the lifecycle: ${candidate?.state}`);
  if (!candidate?.revisionId || !candidate?.freeze?.frozenFile) fail('accepted output was not versioned and frozen.');
  if (candidate?.freeze?.frozenFile && !fs.existsSync(path.join(temp, candidate.freeze.frozenFile))) fail('frozen accepted-output blob is missing.');

  const receiptsDir = path.join(temp, 'data/autonomy/receipts');
  if (!fs.existsSync(receiptsDir) || fs.readdirSync(receiptsDir).length !== 1) fail('autonomy cycle receipt was not written exactly once.');
  const exceptions = JSON.parse(fs.readFileSync(path.join(temp, 'data/autonomy/exceptions.json'), 'utf8'));
  if (exceptions.items.length !== 0) fail('safe fixture unexpectedly produced an exception.');

  if (!process.exitCode) console.log('Autonomy cycle E2E OK (draft -> Safe Harbor -> next legal slot -> render -> manifest -> freeze -> receipt; baseline schedule preserved).');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Repair must not destroy the draft it is meant to fix.
//
// The generator can legitimately return a good draft that is still short of the
// brief's minimum word count. Safe Harbor then asks the provider to repair it. The
// repair return value used to be assigned into `draft` with no shape check, so a
// wrapped or partial answer replaced the good draft outright; localRepairDraft
// backfilled the remains with its defaults and Safe Harbor reported MISSING_TITLE,
// MISSING_SECTIONS and GUARANTEE against content that had actually been written.
// The retry counter only advanced in run_cycle's catch block, so the candidate
// re-failed identically forever.
//
// Both scenarios below drive the REAL run_cycle against an out-of-process stub
// standing in for the provider. spawnSync blocks the event loop, so the stub must
// not live in this process.
// ---------------------------------------------------------------------------
const PARAGRAPH = 'Overload can build quietly when someone is carrying several responsibilities at once. It may show up as irritability, mental fog, avoidance, or the sense that even ordinary decisions require too much effort. Noticing these signs is not the same as diagnosing yourself. It is a practical way to pause, gather information, and decide what kind of support would be useful. A grounded check-in begins with observable details, such as what has changed in sleep, concentration, patience, and recovery time. ';
const goodDraft = (sectionCount) => ({
  title: 'A Grounded Way to Notice Overload Before It Builds',
  description: 'A practical, non-diagnostic reflection on noticing overload and choosing a manageable next step.',
  shortAnswer: 'Notice observable changes, separate facts from self-judgment, reduce one source of pressure, and choose the next form of support that fits the situation.',
  sections: Array.from({ length: sectionCount }, (unused, index) => ({ heading: `Grounded step ${index + 1}`, body: PARAGRAPH.repeat(2) })),
  sources: [],
  internalLinks: ['/therapy/', '/resources/', '/about/'],
  disclaimer: 'This educational resource is for general information only.'
});
// A wrapper object: valid JSON, plausible from a provider, and not a draft.
const malformedRepair = { draft: { repaired: true }, notes: 'expanded the draft' };

function buildRepairSandbox({ minimumWords, repairPayload }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-repair-e2e-'));
  const put = (rel, value) => { const full = path.join(dir, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`); };
  fs.cpSync(path.join(repo, 'scripts/autonomy'), path.join(dir, 'scripts/autonomy'), { recursive: true });
  fs.cpSync(path.join(repo, 'pages/resources/articles/why-high-achieving-women-sometimes-mistake-numbness-for-maturity'), path.join(dir, 'pages/resources/articles/why-high-achieving-women-sometimes-mistake-numbness-for-maturity'), { recursive: true });
  put('data/system/runtime_contract.json', { runtimeMode: 'FULL_SAFE_AUTONOMY' });
  put('data/system/config.json', { canonicalDomain: 'https://www.hicksconsulting.org/' });
  put('data/system/ownership_manifest.json', { protectedFacts: [] });
  put('data/system/publishing_velocity_contract.json', { authority: 'UNCHANGED_EXISTING_CLIENT_SYSTEM', lockedRecordCount: 1, cadence: { insightsPerBusinessWeek: 5, articlesPerWeek: 1, guidesPerMonth: 1, whitePapersPerQuarter: 1 } });
  put('data/entities/author_profile.json', { name: 'Monika Hicks, LCSW' });
  put('data/entities/org_profile.json', { name: 'Hicks Consulting' });
  put('data/intake/source_health.json', { status: 'fixture' });
  put('data/autonomy/state.json', { paused: false, emergencyStop: false, currentPhase: 'IDLE', counts: {} });
  put('data/autonomy/exceptions.json', { schemaVersion: '1.0.0', items: [] });
  put('data/autonomy/revision_registry.json', { schemaVersion: '1.0.0', revisions: [] });
  put('data/admin/content_manifest.json', []);
  put('data/autonomy/queue.json', { schemaVersion: '1.0.0', items: [{
    id: 'repair-candidate', state: 'SCORED', score: 95, contentType: 'articles',
    title: 'A Grounded Way to Notice Overload Before It Builds', query: 'notice overload',
    clusterId: 'repair-cluster', minimumWords, targetWords: minimumWords + 400,
    suggestedRoute: '/resources/articles/notice-overload-before-it-builds/'
  }] });
  // The stub discriminates on repairStructuredDraft's own system prompt, which is
  // the only text unique to the repair call.
  fs.writeFileSync(path.join(dir, 'stub_provider.mjs'), [
    "import http from 'node:http';",
    `const generated = ${JSON.stringify(JSON.stringify(goodDraft(5)))};`,
    `const repaired = ${JSON.stringify(JSON.stringify(repairPayload))};`,
    'const server = http.createServer((request, response) => {',
    "  let body = '';",
    "  request.on('data', (chunk) => { body += chunk; });",
    "  request.on('end', () => {",
    "    const content = body.includes('repaired JSON object') ? repaired : generated;",
    "    response.writeHead(200, { 'content-type': 'application/json' });",
    '    response.end(JSON.stringify({ choices: [{ message: { content } }] }));',
    '  });',
    '});',
    "server.listen(0, '127.0.0.1', () => console.log(server.address().port));",
    ''
  ].join('\n'));
  return dir;
}

async function runRepairScenario({ minimumWords, repairPayload, cycles, maxAttempts }) {
  const dir = buildRepairSandbox({ minimumWords, repairPayload });
  const stub = spawn(process.execPath, [path.join(dir, 'stub_provider.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stub provider did not start')), 10000);
      stub.stdout.once('data', (chunk) => { clearTimeout(timer); resolve(String(chunk).trim()); });
    });
    const runs = [];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      const run = spawnSync(process.execPath, ['scripts/autonomy/run_cycle.mjs'], {
        cwd: dir,
        env: {
          ...process.env,
          LLM_API_URL: `http://127.0.0.1:${port}/v1/chat/completions`,
          LLM_API_KEY: 'stub', LLM_MODEL: 'stub-model', LLM_PROVIDER: 'openai_compatible',
          LLM_FIXTURE_PATH: '', AUTONOMY_CLOCK: '2026-08-06T22:00:00.000Z',
          AUTONOMY_MAX_ITEMS: '1', AUTONOMY_MAX_ATTEMPTS: String(maxAttempts)
        },
        encoding: 'utf8', timeout: 60000
      });
      if (run.status !== 0) throw new Error(`repair-scenario cycle exited ${run.status}: ${run.stderr || run.stdout}`);
      runs.push(run);
    }
    const queue = JSON.parse(fs.readFileSync(path.join(dir, 'data/autonomy/queue.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'data/admin/content_manifest.json'), 'utf8'));
    const generated = JSON.parse(fs.readFileSync(path.join(dir, 'data/autonomy/revisions/repair-candidate-draft.json'), 'utf8'));
    return { item: queue.items[0], manifest, generated, dir };
  } finally {
    stub.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
  // Scenario A: the repair comes back malformed. The good draft must survive it, the
  // retry counter must advance every cycle, and FAILED_RETRYABLE must be bounded.
  const malformed = await runRepairScenario({ minimumWords: 2000, repairPayload: malformedRepair, cycles: 2, maxAttempts: 2 });
  const codes = (malformed.item.findings || []).map((finding) => finding.code);
  if (malformed.generated.draft?.sections?.length !== 5) fail('the generated draft was not written to the revision record intact.');
  for (const destroyed of ['MISSING_TITLE', 'MISSING_DESCRIPTION', 'MISSING_SHORTANSWER', 'MISSING_SECTIONS']) {
    if (codes.includes(destroyed)) fail(`a malformed repair destroyed the good draft: Safe Harbor reported ${destroyed} against content the generator produced.`);
  }
  if (codes.includes('GUARANTEE')) fail('the repair injected a GUARANTEE finding the repair cannot clear (default disclaimer was not sanitized).');
  if (!codes.includes('THIN_CONTENT')) fail(`the genuine finding was lost: ${codes.join(',') || 'none'}`);
  if (malformed.item.attempts !== 2) fail(`retry counter did not advance on validation failure: attempts=${malformed.item.attempts}`);
  if (malformed.item.state !== 'SYSTEM_BLOCKED') fail(`FAILED_RETRYABLE is unbounded: state after exhausting attempts is ${malformed.item.state}`);
  if (malformed.manifest.length !== 0) fail('a draft that never cleared Safe Harbor reached the content manifest.');

  // Scenario B: the repair comes back as a real, longer draft. It must be accepted,
  // clear Safe Harbor, and reach the queue as SCHEDULED - the shape check rejects
  // malformed repairs without rejecting good ones.
  const accepted = await runRepairScenario({ minimumWords: 900, repairPayload: goodDraft(9), cycles: 1, maxAttempts: 3 });
  if (accepted.item.state !== 'SCHEDULED') fail(`a valid repair did not reach the queue: state=${accepted.item.state} findings=${JSON.stringify(accepted.item.findings || [])}`);
  if (!accepted.manifest.some((entry) => entry.id === 'auto-repair-candidate')) fail('an accepted repaired draft was not added to the content manifest.');

  if (!process.exitCode) console.log('Repair-safety E2E OK (malformed repair keeps the good draft, injects no GUARANTEE, advances attempts and bounds FAILED_RETRYABLE; a valid repair still reaches SCHEDULED).');
} catch (error) {
  fail(`repair-safety end-to-end scenario failed: ${error.message}`);
}
