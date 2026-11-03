'use strict';
/**
 * Cloudflare Web Analytics beacon on every public page.
 *
 * Why it is shipped from the build instead of left to Cloudflare's automatic
 * injection: _headers sends `Cache-Control: ... no-transform` on purpose (PR
 * #41, so Cloudflare's email-obfuscation rewrite cannot break contact links),
 * and no-transform also stops Cloudflare injecting the beacon. Result before
 * this step: no visits recorded at all, AI-tool visits included.
 *
 * The token is the public site token of the hicksconsulting.org Web Analytics
 * site (it appears in every page's HTML by design). Safe to run repeatedly.
 *
 * Guard: the build fails if zero pages get the beacon, or if the CSP in
 * _headers would block it (script-src needs static.cloudflareinsights.com,
 * connect-src needs cloudflareinsights.com).
 */
const fs = require('fs');
const path = require('path');

const TOKEN = '7193e8a9737441ab9868d45a9c4beb96';
const MARKER = 'data-cf-beacon';
const SNIPPET = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ${MARKER}='{"token": "${TOKEN}"}'></script>`;

function cspAllowsBeacon(headersText) {
  const csp = (/^\s*Content-Security-Policy:\s*(.+)$/im.exec(headersText) || [])[1] || '';
  const directive = name => (new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`).exec(csp) || [])[1] || '';
  return directive('script-src').split(/\s+/).includes('https://static.cloudflareinsights.com')
    && directive('connect-src').split(/\s+/).includes('https://cloudflareinsights.com');
}

module.exports = function install(dist, headersPath) {
  if (!cspAllowsBeacon(fs.readFileSync(headersPath, 'utf8'))) {
    throw new Error('CSP in _headers blocks the Cloudflare Web Analytics beacon (script-src https://static.cloudflareinsights.com, connect-src https://cloudflareinsights.com)');
  }
  let installed = 0;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.name.endsWith('.html')) continue;
      const rel = path.relative(dist, abs).split(path.sep).join('/');
      if (/^(admin|preview|agency|assets|data)(\/|$)/.test(rel)) continue;
      const html = fs.readFileSync(abs, 'utf8');
      if (!/<\/head>/i.test(html)) continue;
      if (!html.includes(MARKER)) fs.writeFileSync(abs, html.replace(/<\/head>/i, `${SNIPPET}</head>`));
      installed++;
    }
  })(dist);
  if (installed === 0) throw new Error('cf-beacon: 0 public pages got the Web Analytics beacon');
  console.log(`cf-beacon: ${installed} public page(s)`);
};

module.exports.cspAllowsBeacon = cspAllowsBeacon;
