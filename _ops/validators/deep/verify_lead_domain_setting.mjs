import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// Exercise both shipped runtimes. Data URLs let Node run their ESM .js sources
// without changing this otherwise CommonJS repository's package mode.
const load = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const workerSource = fs.readFileSync('worker/_worker.js', 'utf8').replace(
  "'./admin_runtime.mjs'", JSON.stringify(pathToFileURL(path.resolve('worker/admin_runtime.mjs')).href));
const worker = (await load(workerSource)).default;
const functions = await load(fs.readFileSync('functions/api/_lib/form-database.js', 'utf8'));
const forms = [
  { type: 'training', route: '/api/training-inquiry', fields: { firstName: 'Test', lastName: 'Lead', company: 'Fixture', services: 'Training', eventDate: '2026-12-01', honorarium: 'Test', eventDetails: 'Fixture only' } },
  { type: 'groups', route: '/api/groups-inquiry', fields: { firstName: 'Test', lastName: 'Lead', groupInterest: 'Test', supportNeed: 'Fixture only' } },
  { type: 'lead-magnet', route: '/api/lead-magnet', fields: { firstName: 'Test', consent: 'yes' } }
];
const runtimes = [
  ['worker', (request, env) => worker.fetch(request, env, {})],
  ['functions', (request, env, formType) => functions.handleFormRequestPost({ request, env, formType })]
];
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
let calls = 0;
let warnings = 0;
let proofs = 0;
try {
  globalThis.fetch = async () => { calls++; return Response.json({ ok: true }); };
  console.warn = () => { warnings++; };
  for (const [name, submit] of runtimes) for (const form of forms) {
    const post = (email, env, extra = {}) => submit(new Request(`https://www.hicksconsulting.org${form.route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form.fields, email, ...extra })
    }), env, form.type);
    // Reserved fixture domains only; the real policy is never in this repo.
    const domain = 'blocked.invalid';
    const setting = ` , OTHER.INVALID, ${domain.toUpperCase()} , `;
    const configured = { BLOCKED_LEAD_DOMAINS: setting, FORM_DATABASE_WEBHOOK_URL: 'https://webhook.invalid/exec', FORM_DATABASE_SHARED_SECRET: 'fixture-only' };
    const before = calls;
    const warnBefore = warnings;
    const blocked = await post(`Test@${domain.toUpperCase()}`, configured);
    assert.equal(blocked.status, 200, `${name}/${form.type}: quiet blocked success`);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.ok, true);
    assert.equal(blockedBody.queued, false);
    assert.ok(blockedBody.submissionId);
    if (form.type === 'lead-magnet') assert.equal(blockedBody.downloadPath, '/assets/downloads/stress-management-made-simple.pdf');
    assert.equal(calls, before, `${name}/${form.type}: blocked lead reached webhook`);
    assert.equal(warnings, warnBefore, 'Blocked sender must not be logged');
    assert.equal((await post(`test@${domain}`, { BLOCKED_LEAD_DOMAINS: setting })).status, 200, 'Block happens before webhook configuration');
    assert.equal(calls, before);
    for (const env of [configured, { ...configured, BLOCKED_LEAD_DOMAINS: '' }, { ...configured, BLOCKED_LEAD_DOMAINS: undefined }]) {
      for (const email of ['test@allowed.invalid', `test@sub.${domain}`, `test@not${domain}`]) {
        const callBefore = calls;
        const result = await post(email, env);
        assert.equal(result.status, 200);
        const body = await result.json();
        assert.deepEqual(Object.keys(body).sort(), Object.keys(blockedBody).sort(), 'Blocked and allowed success shapes agree');
        assert.equal(calls, callBefore + 1, `${name}/${form.type}: exact-domain match must not drop allowed leads`);
      }
    }
    assert.equal((await post('invalid', configured)).status, 400, 'Email validation remains enforced');
    if (form.type === 'lead-magnet') assert.equal((await post(`test@${domain}`, configured, { consent: 'no' })).status, 400, 'Consent remains enforced');
    const failedBefore = calls;
    globalThis.fetch = async () => { calls++; return Response.json({ ok: false }, { status: 502 }); };
    assert.equal((await post('test@allowed.invalid', configured)).status, 502, 'Allowed lead still requires confirmed receipt');
    assert.equal(calls, failedBefore + 1);
    globalThis.fetch = async () => { calls++; return Response.json({ ok: true }); };
    proofs++;
  }
  assert.equal(proofs, 6, 'Every form in both runtimes was exercised');
  console.log(`Lead-domain setting behavior OK (${proofs} runtime/form pairs; quiet blocked leads never dispatch, exact matching, empty/unset allow, consent and webhook failures preserved).`);
} finally {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
}
