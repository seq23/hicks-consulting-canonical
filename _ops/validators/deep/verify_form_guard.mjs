// Behaviour proof for the form bot/flood guard (worker/form_guard.mjs) on both
// shipped runtimes: worker/_worker.js (live, Advanced Mode) and
// functions/api/_lib/form-database.js.
//
//   node _ops/validators/deep/verify_form_guard.mjs                 run every case
//   node _ops/validators/deep/verify_form_guard.mjs --write-golden  record what the
//        CURRENT code forwards to the Apps Script webhook (run once, on main's code)
//
// Registered in validate:all through _ops/validators/validate_form_guard.js.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const GOLDEN = '_ops/validators/deep/fixtures/form_forward_golden.json';
const fileUrl = (p) => JSON.stringify(pathToFileURL(path.resolve(p)).href);
const load = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const workerSource = fs.readFileSync('worker/_worker.js', 'utf8')
  .replace("'./admin_runtime.mjs'", fileUrl('worker/admin_runtime.mjs'))
  .replace("'./form_guard.mjs'", fileUrl('worker/form_guard.mjs'));
const functionsSource = fs.readFileSync('functions/api/_lib/form-database.js', 'utf8')
  .replace("'../../../worker/form_guard.mjs'", fileUrl('worker/form_guard.mjs'));
const worker = (await load(workerSource)).default;
const functions = await load(functionsSource);

const FORMS = [
  { type: 'training', route: '/api/training-inquiry', page: '/organizational-training-inquiry/', fields: { firstName: 'Fixture', lastName: 'Person', company: 'Fixture Org', email: 'fixture@example.invalid', services: 'Keynote Speaker', eventDate: '2027-02-10', honorarium: '1500', referral: 'Website', eventDetails: 'Fixture event details only.' } },
  { type: 'groups', route: '/api/groups-inquiry', page: '/groups/', fields: { firstName: 'Fixture', lastName: 'Person', email: 'fixture@example.invalid', phone: '555-0100', groupInterest: 'Fixture group', supportNeed: 'Fixture support need', availability: 'Weekday evenings', message: 'Fixture message.' } },
  { type: 'lead-magnet', route: '/api/lead-magnet', page: '/stress-management-worksheet/', fields: { leadMagnet: 'stress-management-made-simple', firstName: 'Fixture', email: 'fixture@example.invalid', stressContext: 'work-burnout', consent: 'yes' } }
];
const RUNTIMES = [
  ['worker', (request, env) => worker.fetch(request, env, {})],
  ['functions', (request, env, formType) => functions.handleFormRequestPost({ request, env, formType })]
];
const BASE_ENV = {
  FORM_DATABASE_WEBHOOK_URL: 'https://script.invalid/form-database',
  FORM_DATABASE_SHARED_SECRET: 'fixture-form-secret',
  LEAD_MAGNET_WEBHOOK_URL: 'https://script.invalid/lead-magnet',
  LEAD_MAGNET_SHARED_SECRET: 'fixture-lead-secret',
  TRAINING_INQUIRY_WEBHOOK_URL: 'https://script.invalid/legacy'
};
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function memoryKv() {
  const map = new Map();
  return { map, async get(k) { return map.has(k) ? map.get(k) : null; }, async put(k, v) { map.set(k, String(v)); } };
}

// siteverify: 'pass' | 'forged' | 'expired' | 'down' | 'http500'
let siteverify = 'pass';
const webhookCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === SITEVERIFY) {
    if (siteverify === 'down') throw new TypeError('fetch failed');
    if (siteverify === 'http500') return new Response('oops', { status: 500 });
    if (siteverify === 'forged') return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
    if (siteverify === 'expired') return Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    return Response.json({ success: true, hostname: 'www.hicksconsulting.org' });
  }
  webhookCalls.push({ url, method: init.method || 'GET', contentType: init.headers?.['content-type'] || null, body: init.body });
  return Response.json({ ok: true });
};
const originalWarn = console.warn;
const originalLog = console.log;
console.warn = () => {};
console.log = () => {};

function normalizeForward(call) {
  const parsed = JSON.parse(call.body);
  assert.ok(parsed.submissionId, 'forward has a submission id');
  assert.ok(!Number.isNaN(Date.parse(parsed.submittedAt)), 'forward has a timestamp');
  const raw = call.body.replace(JSON.stringify(parsed.submissionId), '"<id>"').replace(JSON.stringify(parsed.submittedAt), '"<time>"');
  return { url: call.url, method: call.method, contentType: call.contentType, body: raw };
}

async function submit(runtime, form, { env, extra = {}, ip = '203.0.113.7', fields = form.fields }) {
  const request = new Request(`https://www.hicksconsulting.org${form.route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'FixtureAgent/1.0', 'cf-connecting-ip': ip },
    body: JSON.stringify({ sourcePage: form.page, submittedAtClient: '2026-11-23T15:00:00.000Z', ...fields, ...extra })
  });
  const response = await runtime(request, env, form.type);
  return { status: response.status, body: await response.json() };
}

let proofs = 0;
const ok = (cond, message) => { assert.ok(cond, message); proofs++; };

try {
  if (process.argv.includes('--write-golden')) {
    const golden = {};
    for (const [name, runtime] of RUNTIMES) for (const form of FORMS) {
      webhookCalls.length = 0;
      const result = await submit(runtime, form, { env: { ...BASE_ENV } });
      assert.equal(webhookCalls.length, 1, `${name}/${form.type}: one forward`);
      golden[`${name}/${form.type}`] = { status: result.status, responseKeys: Object.keys(result.body).sort(), downloadPath: result.body.downloadPath || null, forward: normalizeForward(webhookCalls[0]) };
    }
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n');
    originalLog(`Wrote ${Object.keys(golden).length} golden forwards to ${GOLDEN}`);
    process.exit(0);
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.equal(Object.keys(golden).length, RUNTIMES.length * FORMS.length, 'golden covers every runtime and form');
  const realDateNow = Date.now;

  for (const [name, runtime] of RUNTIMES) {
    for (const form of FORMS) {
      const tag = `${name}/${form.type}`;
      const want = golden[tag];

      // 1. Real people: the forward to the Apps Script (which picks the recipient and
      // writes the email) is byte-identical to main, verified or unchecked, and the
      // new client fields never leak into it.
      for (const [label, env, extra] of [
        ['verified', { ...BASE_ENV, TURNSTILE_SECRET_KEY: 'ts-secret', DIGITAL_PRODUCTS_KV: memoryKv() }, { website: '', turnstileToken: 'good-token' }],
        ['no token', { ...BASE_ENV, TURNSTILE_SECRET_KEY: 'ts-secret', DIGITAL_PRODUCTS_KV: memoryKv() }, { website: '' }],
        ['widget not configured', { ...BASE_ENV, DIGITAL_PRODUCTS_KV: memoryKv() }, { website: '', turnstileToken: 'anything' }]
      ]) {
        siteverify = 'pass';
        webhookCalls.length = 0;
        const result = await submit(runtime, form, { env, extra });
        assert.equal(result.status, want.status, `${tag} ${label}: status as on main`);
        assert.deepEqual(Object.keys(result.body).sort(), want.responseKeys, `${tag} ${label}: response shape as on main`);
        assert.equal(result.body.downloadPath || null, want.downloadPath, `${tag} ${label}: download path as on main`);
        assert.equal(webhookCalls.length, 1, `${tag} ${label}: exactly one forward`);
        assert.deepEqual(normalizeForward(webhookCalls[0]), want.forward, `${tag} ${label}: forward identical to main`);
        ok(true);
      }

      // 2. Outage: Turnstile down, erroring or answering "expired" still delivers.
      for (const state of ['down', 'http500', 'expired']) {
        siteverify = state;
        webhookCalls.length = 0;
        const result = await submit(runtime, form, { env: { ...BASE_ENV, TURNSTILE_SECRET_KEY: 'ts-secret', DIGITAL_PRODUCTS_KV: memoryKv() }, extra: { turnstileToken: 'good-token' } });
        assert.equal(result.status, 200, `${tag}: siteverify ${state} must still deliver`);
        ok(webhookCalls.length === 1, `${tag}: siteverify ${state} forwarded once`);
      }

      // 3. Honeypot: normal-looking success, nothing sent, nothing counted.
      siteverify = 'pass';
      webhookCalls.length = 0;
      const hpKv = memoryKv();
      const trapped = await submit(runtime, form, { env: { ...BASE_ENV, TURNSTILE_SECRET_KEY: 'ts-secret', DIGITAL_PRODUCTS_KV: hpKv }, extra: { website: 'https://spam.invalid', turnstileToken: 'good-token' } });
      assert.equal(trapped.status, 200, `${tag}: honeypot answers 200`);
      assert.equal(trapped.body.ok, true);
      assert.deepEqual(Object.keys(trapped.body).sort(), want.responseKeys, `${tag}: honeypot success looks like the real one`);
      ok(webhookCalls.length === 0, `${tag}: honeypot must send no email`);
      ok(hpKv.map.size === 0, `${tag}: honeypot does not use up a real person's cap`);

      // 4. Forged token: refused, nothing sent.
      siteverify = 'forged';
      webhookCalls.length = 0;
      const forged = await submit(runtime, form, { env: { ...BASE_ENV, TURNSTILE_SECRET_KEY: 'ts-secret', DIGITAL_PRODUCTS_KV: memoryKv() }, extra: { turnstileToken: 'forged-token' } });
      assert.equal(forged.status, 403, `${tag}: forged token refused`);
      assert.equal(forged.body.ok, false);
      ok(webhookCalls.length === 0, `${tag}: forged token sends nothing`);

      // 5. Per-IP cap: 5 in a rolling hour deliver, the 6th is capped (verified or not),
      // another IP is unaffected, and the slot frees after the hour.
      for (const tokenState of ['verified', 'unchecked']) {
        siteverify = 'pass';
        const kv = memoryKv();
        const env = { ...BASE_ENV, TURNSTILE_SECRET_KEY: 'ts-secret', DIGITAL_PRODUCTS_KV: kv };
        const extra = tokenState === 'verified' ? { turnstileToken: 'good-token' } : {};
        const t0 = Date.parse('2026-11-23T16:00:00Z');
        try {
          for (let i = 0; i < 5; i++) {
            Date.now = () => t0 + i * 60_000;
            webhookCalls.length = 0;
            const r = await submit(runtime, form, { env, extra });
            assert.equal(r.status, 200, `${tag} ${tokenState}: submission ${i + 1} delivers`);
            assert.equal(webhookCalls.length, 1);
          }
          Date.now = () => t0 + 59 * 60_000;
          webhookCalls.length = 0;
          const sixth = await submit(runtime, form, { env, extra });
          assert.equal(sixth.status, 429, `${tag} ${tokenState}: 6th from one IP within the hour is capped`);
          ok(webhookCalls.length === 0, `${tag} ${tokenState}: capped submission sends nothing`);
          const other = await submit(runtime, form, { env, extra, ip: '198.51.100.9' });
          ok(other.status === 200, `${tag} ${tokenState}: a different IP still delivers`);
          Date.now = () => t0 + 60 * 60_000 + 1;
          const later = await submit(runtime, form, { env, extra });
          ok(later.status === 200, `${tag} ${tokenState}: the first slot frees after a rolling hour`);
        } finally { Date.now = realDateNow; }
      }

      // 6. Daily cap on unchecked submissions (no token), across IPs; Turnstile-verified
      // people still get through once it is full; it resets at Central midnight.
      {
        siteverify = 'pass';
        const kv = memoryKv();
        const env = { ...BASE_ENV, TURNSTILE_SECRET_KEY: 'ts-secret', DIGITAL_PRODUCTS_KV: kv };
        const day = Date.parse('2026-11-23T23:00:00-06:00'); // 11 pm Central
        try {
          Date.now = () => day;
          for (let i = 0; i < 20; i++) {
            const r = await submit(runtime, form, { env, ip: `192.0.2.${i + 1}` });
            assert.equal(r.status, 200, `${tag}: unchecked ${i + 1}/20 delivers`);
          }
          webhookCalls.length = 0;
          const over = await submit(runtime, form, { env, ip: '192.0.2.200' });
          assert.equal(over.status, 429, `${tag}: 21st unchecked of the day is capped`);
          ok(webhookCalls.length === 0, `${tag}: daily-capped submission sends nothing`);
          const human = await submit(runtime, form, { env, ip: '192.0.2.201', extra: { turnstileToken: 'good-token' } });
          ok(human.status === 200, `${tag}: a verified person still delivers when the unchecked cap is full`);
          Date.now = () => day + 60 * 60_000 + 1; // 00:00 Central next day
          const nextDay = await submit(runtime, form, { env, ip: '192.0.2.202' });
          ok(nextDay.status === 200, `${tag}: unchecked cap resets at Central midnight`);
        } finally { Date.now = realDateNow; }
      }

      // 7. Store outage: unchecked is refused (cannot prove it is under the cap),
      // Turnstile-verified still delivers; a missing binding behaves the same.
      for (const badKv of [{ async get() { throw new Error('KV down'); }, async put() { throw new Error('KV down'); } }, undefined]) {
        siteverify = 'pass';
        webhookCalls.length = 0;
        const env = { ...BASE_ENV, TURNSTILE_SECRET_KEY: 'ts-secret', DIGITAL_PRODUCTS_KV: badKv };
        const unchecked = await submit(runtime, form, { env });
        assert.equal(unchecked.status, 503, `${tag}: unchecked with store down is refused`);
        ok(webhookCalls.length === 0, `${tag}: store down + unchecked sends nothing`);
        const verified = await submit(runtime, form, { env, extra: { turnstileToken: 'good-token' } });
        ok(verified.status === 200 && webhookCalls.length === 1, `${tag}: store down + verified still delivers`);
      }

      // 8. IP is stored only as a hash.
      {
        const kv = memoryKv();
        await submit(runtime, form, { env: { ...BASE_ENV, DIGITAL_PRODUCTS_KV: kv } });
        ok([...kv.map.keys(), ...kv.map.values()].every((s) => !String(s).includes('203.0.113.7')), `${tag}: raw IP never stored`);
      }
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  console.log = originalLog;
}

if (proofs < 100) { console.error(`Form guard proved only ${proofs} cases`); process.exit(1); }
console.log(`Form guard OK (${proofs} behaviour proofs across worker and functions runtimes, 3 forms).`);
