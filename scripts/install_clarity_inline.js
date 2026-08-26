'use strict';
/**
 * Install the Microsoft Clarity tag into the built site.
 *
 * The Clarity project for hicksconsulting.org existed but no tag was ever
 * installed, so it sat on "Almost there!" and recorded nothing. Idempotent, so
 * it can run on every build.
 *
 * This touches the built output only. No content, no source page, and no
 * publishing cadence changes.
 */
const fs = require('fs');
const path = require('path');

const PROJECT = 'y7l3sgr1el';
const MARKER = 'data-clarity-loader';
const SNIPPET = `<script ${MARKER}>(function(w,d,i){w.clarity=w.clarity||function(){(w.clarity.q=w.clarity.q||[]).push(arguments)};var s=d.createElement("script");s.async=1;s.src="https://www.clarity.ms/tag/"+i;var f=d.getElementsByTagName("script")[0];f.parentNode.insertBefore(s,f)})(window,document,${JSON.stringify(PROJECT)})</script>`;

module.exports = function install(dist) {
  let touched = 0;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.name.endsWith('.html')) continue;
      const html = fs.readFileSync(abs, 'utf8');
      if (html.includes(MARKER) || !/<\/head>/i.test(html)) continue;
      fs.writeFileSync(abs, html.replace(/<\/head>/i, `${SNIPPET}</head>`));
      touched += 1;
    }
  })(dist);
  console.log(`clarity: installed on ${touched} page(s)`);
};
