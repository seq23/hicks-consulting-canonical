import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
