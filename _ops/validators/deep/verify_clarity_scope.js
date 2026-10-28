'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const install = require('../../../scripts/install_clarity_inline');

// Exercise the production build step on reader-visible conversion surfaces,
// including stale tags and misleading strings that must not enable recording.
module.exports = function verifyClarityScope(dist) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hicks-clarity-'));
  const fixtures = [
    ['index.html', '<a href="/groups/">Join a group</a>', false],
    ['terms/index.html', '<p>Terms of use</p>', false],
    ['article/index.html', '<!-- <form></form> --><script>const x="<form>"</script><template><form></form></template>', false],
    ['mention/index.html', '<p>Buy on gumroad.com</p><a href="https://gumroad.com.invalid/">Elsewhere</a>', false],
    ['groups/index.html', '<form action="/api/groups-inquiry"><input name="firstName"></form>', true],
    ['product/index.html', '<a href="https://hicksconsulting.gumroad.com/l/worksheet">Buy</a>', true],
    ['stripe/index.html', "<a href='https://buy.stripe.com/test'>Buy</a>", true],
    ['checkout/index.html', '<a href=/checkout/>Checkout</a>', true],
    ['admin/index.html', '<form><input name="password"></form>', false],
    ['preview/product/index.html', '<a href="https://hicksconsulting.gumroad.com/l/worksheet">Buy</a>', false],
    ['agency/index.html', '<form></form>', false],
    ['404.html', '<form></form>', false],
  ];
  try {
    for (const [rel, body] of fixtures) {
      const file = path.join(temp, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `<html><head><script data-clarity-loader>oldTag()</script></head><body>${body}</body></html>`);
    }
    install(temp);
    const first = new Map();
    for (const [rel, , expected] of fixtures) {
      const html = fs.readFileSync(path.join(temp, rel), 'utf8');
      assert.equal(html.includes('https://www.clarity.ms/tag/'), expected, `Clarity scope: ${rel}`);
      assert.equal((html.match(/data-clarity-loader/g) || []).length, expected ? 1 : 0, `Stale/duplicate loader: ${rel}`);
      first.set(rel, html);
    }
    install(temp);
    for (const [rel, html] of first) assert.equal(fs.readFileSync(path.join(temp, rel), 'utf8'), html, `Non-idempotent Clarity output: ${rel}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  let examined = 0, recording = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.html')) continue;
      examined++;
      const rel = path.relative(dist, full).split(path.sep).join('/');
      const html = fs.readFileSync(full, 'utf8');
      const loading = /clarity\.ms|data-clarity-loader/i.test(html);
      const privatePage = /^(admin|preview|agency|assets|data)(\/|$)/.test(rel) || rel === '404.html';
      assert.ok(!privatePage || !loading, `Clarity records a private/error page: ${rel}`);
      if (privatePage) continue;
      // Independent output check: the shipped public page must carry a real
      // form or purchase anchor, not a CTA to a different page containing one.
      const markup = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
      const conversion = /<form\b/i.test(markup) || [...markup.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].some((match) => {
        const url = new URL(match[1], 'https://www.hicksconsulting.org');
        return /^https?:$/.test(url.protocol) && (
          /(^|\.)gumroad\.com$/.test(url.hostname) || /^(buy|checkout)\.stripe\.com$/.test(url.hostname) ||
          (url.hostname === 'www.hicksconsulting.org' && /^\/(cart|checkout)(\/|$)/.test(url.pathname))
        );
      });
      assert.equal(loading, conversion, `Clarity must load exactly on public form/buy pages: ${rel}`);
      if (loading) recording++;
    }
  }
  walk(dist);
  assert.ok(examined > 0 && recording > 0, 'Clarity scope examined no pages or found no conversion tags');
  return `Clarity scope OK: ${examined} built pages, ${recording} public form/buy pages, ${fixtures.length} behavioral fixtures and idempotency`;
};
