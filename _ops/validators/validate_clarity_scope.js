'use strict';
// validate:clarity-scope (restored 10 Nov 2026 as its own blocking runner; was Search Readiness e9).
// Microsoft Clarity records only public form and purchase pages: never reading pages, admin,
// preview, agency or error pages. Exercises the real installer on fixtures (stale tags removed,
// idempotent) and then checks every built page in dist/. Rule 0: zero pages or zero recording
// pages fails (inside verify_clarity_scope).
const fs = require('fs');
const path = require('path');
const { fail } = require('../validation/protocol');
const dist = path.join(process.cwd(), 'dist');
if (!fs.existsSync(dist)) fail('CLARITY SCOPE: dist/ does not exist. Run `npm run build` before this check; it governs the built site.');
try {
  console.log(require('./deep/verify_clarity_scope')(dist));
} catch (error) {
  fail(`clarity-scope: ${error.message}`);
}
