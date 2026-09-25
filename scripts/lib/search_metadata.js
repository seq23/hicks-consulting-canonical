'use strict';
/**
 * Search metadata: the one definition of a page's <title> and meta description.
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * 78 published resource pages shipped a <title> that was not their title. The
 * snapshot they came from had chopped each one to about 45 characters by
 * dropping the leading question word and cutting mid-phrase, so
 * "What Boundary Problems Really Sound Like in Professional Women" became
 * "Boundary Problems Really Sound Like in | Hicks Consulting" - and so did its
 * five insight pages. Bing's audit (25 Sep 2026) found 14 duplicate-title groups
 * on hicksconsulting.org, every one of them this truncation.
 *
 * Descriptions had the same shape: one sentence per topic family, shared by up
 * to six pages ("A practical guide to <topic>, what it can cost, ..."), some of
 * them cut at 160 characters mid-word ("... with more cla."). 22 duplicate groups.
 *
 * THE RULE
 * --------
 *  - A manifest page's <title> is its manifest title, whole, plus the site
 *    suffix. og:title and twitter:title say the same thing. Never shortened: a
 *    long whole title is better than a short broken one, and the manifest title
 *    is already unique (validate_title_uniqueness_contract.js).
 *  - A description is 110-160 characters, ends on a whole sentence or clause,
 *    and is drawn from the page's own copy (its short answer first), so two
 *    pages cannot share one unless they share their opening.
 *
 * _ops/validators/validate_search_metadata_contract.js asserts all of it against
 * every sitemap page; scripts/search/apply_search_metadata.js repairs pages/ from
 * the manifest; scripts/autonomy/lib/render_resource.mjs renders new pages with
 * the same functions, so a new page cannot be born wrong.
 */

const SITE_SUFFIX = ' | Hicks Consulting';
const TITLE_MIN = 30;
const DESC_MIN = 110;
const DESC_MAX = 160;

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** The <title> a manifest page must carry. */
function resourceTitle(title) {
  return `${String(title || '').trim()}${SITE_SUFFIX}`;
}

// Meta tags appear with either attribute first; match both.
function metaPattern(attr, key) {
  return new RegExp(`<meta\\s+(?:content="([^"]*)"\\s+${attr}="${key}"|${attr}="${key}"\\s+content="([^"]*)")\\s*/?>`, 'i');
}
const META = {
  description: metaPattern('name', 'description'),
  ogTitle: metaPattern('property', 'og:title'),
  ogDescription: metaPattern('property', 'og:description'),
  twitterTitle: metaPattern('name', 'twitter:title'),
  twitterDescription: metaPattern('name', 'twitter:description'),
};

function readMeta(html) {
  const out = {};
  const t = html.match(/<title>([^<]*)<\/title>/i);
  out.title = t ? decodeEntities(t[1]).trim() : null;
  for (const [key, re] of Object.entries(META)) {
    const m = html.match(re);
    out[key] = m ? decodeEntities(m[1] ?? m[2]).trim() : null;
  }
  return out;
}

/** Rewrite title + description and their og/twitter mirrors. Tags that are absent stay absent. */
function writeMeta(html, { title, description }) {
  let out = html;
  const swap = (re, attr, key, value) => {
    out = out.replace(re, `<meta content="${escapeAttr(value)}" ${attr}="${key}"/>`);
  };
  if (title) {
    out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(title)}</title>`);
    swap(META.ogTitle, 'property', 'og:title', title);
    swap(META.twitterTitle, 'name', 'twitter:title', title);
  }
  if (description) {
    swap(META.description, 'name', 'description', description);
    swap(META.ogDescription, 'property', 'og:description', description);
    swap(META.twitterDescription, 'name', 'twitter:description', description);
  }
  return out;
}

function descriptionInRange(text) {
  const n = String(text || '').length;
  return n >= DESC_MIN && n <= DESC_MAX;
}

/** A description must end on a whole sentence, not on a chopped word. */
function endsWhole(text) {
  return /[.?!]["”’)]?$/.test(String(text || '').trim());
}

function sentencesOf(text) {
  return (String(text || '').replace(/\s+/g, ' ').trim().match(/[^.?!]+[.?!]+["”’)]?(\s|$)/g) || [])
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Fit one passage of page copy into DESC_MIN..DESC_MAX without breaking a
 * phrase. Tries, in order: the passage as is; whole leading sentences; the
 * first sentence cut back to its last clause boundary (comma, semicolon, colon,
 * dash) and closed with a full stop. Returns null when none of those fit.
 */
function fitPassage(passage) {
  const text = String(passage || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const closed = endsWhole(text) ? text : `${text.replace(/[,;:\s—–-]+$/, '')}.`;
  if (descriptionInRange(closed)) return closed;

  const sentences = sentencesOf(closed);
  let acc = '';
  for (const sentence of sentences) {
    const next = acc ? `${acc} ${sentence}` : sentence;
    if (next.length > DESC_MAX) break;
    acc = next;
    if (descriptionInRange(acc)) return acc;
  }

  const first = sentences[0] || closed;
  if (first.length > DESC_MAX) {
    const boundary = /[,;:—–]\s|\s[—–-]\s/g;
    let best = null;
    let m;
    while ((m = boundary.exec(first))) {
      const cut = first.slice(0, m.index).replace(/[\s,;:—–-]+$/, '');
      const candidate = `${cut}.`;
      if (candidate.length > DESC_MAX) break;
      if (candidate.length >= DESC_MIN) best = candidate;
    }
    if (best) return best;
  }
  return null;
}

/**
 * Derive a description from a list of passages (most specific first). A
 * passage that is too short is joined with the passages after it, whole
 * sentence by whole sentence, until it reaches the range.
 */
function fitDescription(passages) {
  const list = passages.map((p) => String(p || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (let i = 0; i < list.length; i += 1) {
    const direct = fitPassage(list[i]);
    if (direct) return direct;
    // Too short on its own: extend with whole sentences from what follows.
    let acc = endsWhole(list[i]) ? list[i] : `${list[i]}.`;
    if (acc.length >= DESC_MIN) continue;
    for (const sentence of list.slice(i + 1).flatMap(sentencesOf)) {
      const next = `${acc} ${sentence}`;
      if (next.length > DESC_MAX) break;
      acc = next;
      if (descriptionInRange(acc)) return acc;
    }
  }
  return null;
}

/** The page's own copy, most specific first: short answer, hero copy, then body paragraphs. */
function pagePassages(html) {
  const passages = [];
  const short = html.match(/<div class="short-answer">([\s\S]*?)<\/div>/i);
  if (short) passages.push(stripTags(short[1]));
  const hero = html.match(/<p class="hero-copy">([\s\S]*?)<\/p>/i);
  if (hero) passages.push(stripTags(hero[1]));
  const bodyStart = html.search(/class="[^"]*article-body[^"]*"/i);
  if (bodyStart >= 0) {
    const body = html.slice(bodyStart);
    for (const m of body.matchAll(/<p>([\s\S]*?)<\/p>/gi)) {
      passages.push(stripTags(m[1]));
      if (passages.length >= 40) break;
    }
  }
  return passages.filter(Boolean);
}

/** Visible page text (title, headings, body copy), for the whole-word check. */
function visibleText(html) {
  const body = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return stripTags(body);
}

function wordsOf(text) {
  return (String(text || '').toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9']+/g) || []);
}

/**
 * A description chopped at a character count ends on a fragment ("with more
 * cla.", "move forward w."). The final word is judged a fragment when the page
 * never uses it and it is either very short or the start of a longer word the
 * page does use.
 */
function finalWordIsWhole(description, html) {
  const words = wordsOf(description);
  const last = words[words.length - 1];
  if (!last) return false;
  const pageWords = new Set(wordsOf(visibleText(html)));
  if (pageWords.has(last)) return true;
  if (last.length <= 3) return false;
  for (const w of pageWords) if (w.length > last.length && w.startsWith(last)) return false;
  return true;
}

const SHINGLE = 8;
function shinglesOf(text) {
  const words = wordsOf(text);
  const out = new Set();
  for (let i = 0; i + SHINGLE <= words.length; i += 1) out.add(words.slice(i, i + SHINGLE).join(' '));
  return out;
}

/**
 * Boilerplate: an 8-word run shared by the descriptions of more than
 * BOILERPLATE_MAX_PAGES pages. That is one sentence appended to or templated
 * into many pages, which is a duplicate description with the nouns swapped.
 * Returns Map(shingle -> routes) for every run over the limit.
 */
const BOILERPLATE_MAX_PAGES = 2;
function boilerplateRuns(descByRoute) {
  const owners = new Map();
  for (const [route, desc] of descByRoute) {
    for (const sh of shinglesOf(desc)) {
      if (!owners.has(sh)) owners.set(sh, []);
      owners.get(sh).push(route);
    }
  }
  return new Map([...owners].filter(([, routes]) => routes.length > BOILERPLATE_MAX_PAGES));
}

module.exports = {
  SHINGLE,
  BOILERPLATE_MAX_PAGES,
  visibleText,
  finalWordIsWhole,
  shinglesOf,
  boilerplateRuns,
  SITE_SUFFIX,
  TITLE_MIN,
  DESC_MIN,
  DESC_MAX,
  resourceTitle,
  readMeta,
  writeMeta,
  descriptionInRange,
  endsWhole,
  fitPassage,
  fitDescription,
  pagePassages,
  stripTags,
};
