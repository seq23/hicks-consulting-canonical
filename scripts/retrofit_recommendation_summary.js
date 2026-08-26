#!/usr/bin/env node
/**
 * Retrofit a recommendation_summary block, and repair the truncated answer
 * span, on resource pages that are NOT yet published.
 *
 * Scope is set by data/admin/content_manifest.json, which is this repo's
 * publication record: `published` (59) is live and in the sitemap, `revoked`
 * (54) was live and now 301s, and `approved` (114) has no publishedAt, carries
 * a previewPath, 404s on its public path and renders only under /preview/.
 * Only `approved` is touched. A page whose status is anything else - or that
 * the manifest does not describe at all - is left exactly as it is.
 *
 * Everything emitted is lifted from the page's own existing content. Nothing is
 * generated, inferred, or filled in. A page whose recommendation cannot be
 * located is reported and skipped rather than given a placeholder: a block that
 * announces a gap is worse than no block, because it is filler for readers and
 * noise for extraction. That is the same rule the sibling implementations in
 * sprylabs, authority-backlink and local-guides follow.
 *
 * Idempotent: an existing block is replaced, so re-running never stacks.
 *
 * Usage: node scripts/retrofit_recommendation_summary.js [--apply] [--limit N]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const limIdx = argv.indexOf('--limit');
const LIMIT = limIdx >= 0 ? Number(argv[limIdx + 1]) : Infinity;

const MARK = 'data-content-block="recommendation_summary"';

const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "’").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The block contains no nested div, so the first closing div after it is its
 * own. Anchoring on "not a nested <div>" rather than on a trailing "</ul></div>"
 * is deliberate: the greedy form matched to the next such pair anywhere in the
 * document, and on a page whose block had no list it swallowed everything up to
 * the next list - deleting real content, including disclosed links. Keep the
 * tempered pattern.
 */
const BLOCK_RE = /<div class="[^"]*recommendation-summary[^"]*"[^>]*>(?:(?!<div\b)[\s\S])*?<\/div>/i;

/**
 * The recommendation, kept whole.
 *
 * Prefer the entire paragraph when it is short enough to quote. Splitting on
 * the first terminator breaks these pages badly: their next-step paragraph is
 * an enumerated question series - "pause long enough to ask three things: Is
 * this mine? Do I have capacity? What would a clean yes or no sound like?" -
 * and cutting at the first "?" yields "...ask three things: Is this mine?",
 * a fragment that reads as broken the moment an answer engine quotes it.
 * Only fall back to one sentence when the paragraph is too long to carry.
 */
function leadUnit(text, max = 320) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  const m = t.match(/^(.{40,}?[.!?]["'”’)\]]?)(\s|$)/);
  const s = m ? m[1] : '';
  return s && s.length <= max ? s : '';
}

/** Find a resource-section by its heading text and return the prose inside it. */
function sectionByHeading(html, patterns) {
  const re = /<section class="resource-section"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/gi;
  let m;
  while ((m = re.exec(html))) {
    const heading = strip(m[1]).toLowerCase();
    if (!patterns.some((p) => p.test(heading))) continue;
    const paras = [...m[2].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => strip(p[1])).filter(Boolean);
    if (paras.length) return paras;
  }
  return [];
}

const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A restatement of the title is not a summary - it tells the reader nothing. */
function informative(candidate, title) {
  const c = norm(candidate);
  if (!c) return false;
  const t = norm(title);
  if (!t || c === t) return !!c && c !== t;
  return !(c.startsWith(t) && c.length - t.length < 24);
}

/**
 * The recommendation, in the page's own words. These templates state what they
 * recommend in a named next-step section; that section is authored for exactly
 * this purpose, so read it and nothing else. No fallback to the generic lede -
 * it is the same sentence on many pages and says nothing about this one.
 */
const NEXT_STEP = [
  /^a practical next step$/, /^what to try this week$/, /^choose one small move$/,
  /^choosing the right kind of support$/, /^using this guide over the next 30 days$/,
  /^what progress can look like$/
];
function recommendationOf(html, title) {
  for (const para of sectionByHeading(html, NEXT_STEP)) {
    const s = leadUnit(para);
    if (s && informative(s, title)) return s;
  }
  return '';
}

/** The page's own conversion link, kept with whatever rel it already carries. */
function primaryCta(html) {
  const body = (html.match(/<section class="resource-section"[^>]*>\s*<h2[^>]*>\s*Related support[\s\S]*?<\/section>/i) || [])[0] || '';
  const m = body.match(/<a\b([^>]*href="(\/[^"]*)"[^>]*)>([\s\S]*?)<\/a>/i);
  if (!m) return null;
  const label = strip(m[3]);
  if (!label) return null;
  const rel = (m[1].match(/rel="([^"]+)"/i) || [])[1];
  return { href: m[2], label, rel };
}

/**
 * Repair the answer span.
 *
 * Every one of these pages carries `<div class="short-answer">` holding a string
 * byte-identical to its own meta description - and the generator caps that
 * string at 156 characters for the search snippet. Reusing the capped string as
 * visible body copy is the bug: 75 of the 114 unpublished pages open with a
 * sentence cut mid-word ("...may help you move f."), which is precisely the
 * fragment an answer engine would quote.
 *
 * The tail is a fixed template, present intact on 39 sibling pages, so the
 * repair is a completion against known text rather than an invention: the
 * truncated string always ends inside TAIL. The meta description is left capped,
 * which is correct for a snippet.
 */
const TAIL = 'which kind of support may help you move forward with more clarity.';
function repairShortAnswer(text) {
  const t = String(text || '').trim();
  if (t.endsWith(TAIL)) return t;
  // The generator appends a full stop after cutting, so the string ends
  // "...move f." - a trailing period that is not part of the template. Drop it
  // before matching, or no suffix will ever line up with a prefix of TAIL.
  const base = t.replace(/\.+$/, '');
  // Longest suffix of `base` that is a proper prefix of TAIL, completed to TAIL.
  // Longest-first so a short coincidental overlap cannot win over the real cut.
  for (let cut = Math.min(base.length, TAIL.length - 1); cut > 8; cut -= 1) {
    const suffix = base.slice(base.length - cut);
    if (TAIL.startsWith(suffix)) return base.slice(0, base.length - cut) + TAIL;
  }
  return '';
}

function buildBlock(html, title) {
  const rec = recommendationOf(html, title);
  if (!rec) return null;
  const cta = primaryCta(html);
  const points = [];
  if (cta) {
    const relAttr = cta.rel ? ` rel="${esc(cta.rel)}"` : '';
    points.push(`<li><strong>Next step:</strong> <a href="${cta.href}"${relAttr}>${esc(cta.label)}</a></li>`);
  }
  return `<div class="info-panel recommendation-summary" ${MARK} id="recommendation-summary">`
    + '<h2>What this page recommends</h2>'
    + `<p class="recommendation-summary__answer">${esc(rec)}</p>`
    + (points.length ? `<ul class="recommendation-summary__points">${points.join('')}</ul>` : '')
    + '</div>';
}

/**
 * Seat the block immediately after the opening answer span. That keeps the
 * page's own lede first - it is the element the answer-shape contract is about -
 * and still lands the summary well inside the opening third, where the majority
 * of AI Overview citations are drawn from.
 */
function insert(html, block) {
  const cleaned = html.replace(BLOCK_RE, '');
  const anchor = cleaned.match(/<div class="short-answer">[\s\S]*?<\/div>/i);
  if (!anchor) return null;
  const at = cleaned.indexOf(anchor[0]) + anchor[0].length;
  return cleaned.slice(0, at) + block + cleaned.slice(at);
}

function applyToHtml(html) {
  const title = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  let out = html;
  let repaired = false;

  const sa = out.match(/(<div class="short-answer">)([\s\S]*?)(<\/div>)/i);
  if (sa) {
    const current = strip(sa[2]);
    const fixed = repairShortAnswer(current);
    if (fixed && fixed !== current) {
      out = out.replace(sa[0], `${sa[1]}${esc(fixed)}${sa[3]}`);
      repaired = true;
    }
  }

  // Read the page with any previous block stripped, so the extractor never sees
  // its own output and re-derives the summary from the block it wrote last time.
  const block = buildBlock(out.replace(BLOCK_RE, ''), title);
  if (!block) return { html: out, repaired, blocked: false };
  const seated = insert(out, block);
  return { html: seated || out, repaired, blocked: Boolean(seated) };
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/admin/content_manifest.json'), 'utf8'));
  const targets = manifest.filter((x) => x.status === 'approved').slice(0, LIMIT);
  let blocked = 0; let repaired = 0; let skipped = 0; const noRec = [];

  for (const item of targets) {
    const file = path.join(ROOT, 'pages', item.publicPath.replace(/^\//, ''), 'index.html');
    if (!fs.existsSync(file)) { skipped += 1; continue; }
    const before = fs.readFileSync(file, 'utf8');
    const res = applyToHtml(before);
    if (!res.blocked) noRec.push(item.publicPath);
    if (res.blocked) blocked += 1;
    if (res.repaired) repaired += 1;
    if (APPLY && res.html !== before) fs.writeFileSync(file, res.html);
  }

  console.log(`${APPLY ? 'applied' : 'dry run'}: ${targets.length} unpublished page(s); `
    + `${blocked} recommendation_summary block(s); ${repaired} truncated answer span(s) repaired; ${skipped} missing file(s)`);
  if (noRec.length) {
    console.log(`${noRec.length} page(s) had no locatable recommendation and were left unchanged:`);
    noRec.slice(0, 20).forEach((p) => console.log(`  ${p}`));
  }
}

module.exports = { applyToHtml, buildBlock, insert, recommendationOf, repairShortAnswer, MARK, BLOCK_RE };
if (require.main === module) main();
