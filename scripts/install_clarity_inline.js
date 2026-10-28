'use strict';
/**
 * Install the existing project's tag only where visitors fill a form or buy
 * (Search Readiness e9). This build step is the source of the shipped tag;
 * page copy and publishing dates are unaffected. Safe to run repeatedly.
 */
const fs = require('fs');
const path = require('path');

const PROJECT = 'y7l3sgr1el';
const MARKER = 'data-clarity-loader';
const SNIPPET = `<script ${MARKER}>(function(w,d,i){w.clarity=w.clarity||function(){(w.clarity.q=w.clarity.q||[]).push(arguments)};var s=d.createElement("script");s.async=1;s.src="https://www.clarity.ms/tag/"+i;var f=d.getElementsByTagName("script")[0];f.parentNode.insertBefore(s,f)})(window,document,${JSON.stringify(PROJECT)})</script>`;

function hasConversion(html) {
  const content = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  if (/<form\b/i.test(content)) return true;
  for (const anchor of content.matchAll(/<a\b[^>]*>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(anchor[0]);
    if (!href) continue;
    let url;
    try { url = new URL(href[1] ?? href[2] ?? href[3], 'https://www.hicksconsulting.org'); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (/(^|\.)gumroad\.com$/.test(url.hostname) || /^(buy|checkout)\.stripe\.com$/.test(url.hostname)) return true;
    if (url.hostname === 'www.hicksconsulting.org' && /^\/(checkout|cart)(\/|$)/i.test(url.pathname)) return true;
  }
  return false;
}

module.exports = function install(dist) {
  let installed = 0, removed = 0;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.name.endsWith('.html')) continue;
      const html = fs.readFileSync(abs, 'utf8');
      const clean = html.replace(/<script\b[^>]*\bdata-clarity-loader\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
      const rel = path.relative(dist, abs).split(path.sep).join('/');
      const privatePage = /^(admin|preview|agency|assets|data)(\/|$)/.test(rel) || rel === '404.html';
      const eligible = !privatePage && /<\/head>/i.test(clean) && hasConversion(clean);
      const next = eligible ? clean.replace(/<\/head>/i, `${SNIPPET}</head>`) : clean;
      if (next !== html) fs.writeFileSync(abs, next);
      if (eligible) installed++;
      else if (html !== clean) removed++;
    }
  })(dist);
  console.log(`clarity: ${installed} form/buy page(s), ${removed} stale loader(s) removed`);
};
