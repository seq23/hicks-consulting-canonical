#!/usr/bin/env node
/*
 * The one place a system removal's reason is written.
 *
 * Nothing may leave the site without a recorded reason a non-technical reader
 * can understand. The 54 duplicate insight pages removed on 2026-08-08 carried
 * none: the manifest said status:"revoked" and stopped there, so the admin page
 * had no reason to show and filled the gap with the word "Revoked" -- which told
 * the client she had turned down 54 pieces she had never been asked about.
 *
 * A reason kept only in a search-engineering report is the same defect as no
 * reason. So this composes the sentence once, and every code path that removes
 * something automatically composes it from here. If a future removal reason has
 * to be written, it gets written HERE, in this register, or the page has nothing
 * honest to say.
 *
 * Register: past tense, names the specific cause, and tells the reader what
 * happens to anyone holding the old link. No jargon: no "canonical", no "301",
 * no "consolidation", no similarity scores. Those stay in the site-owner record.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// UTC, deliberately. This sentence is generated once and committed, so reading
// it off the machine's local clock would make the same input produce "7 August"
// here and "8 August" in CI -- a build-determinism failure hiding inside a
// sentence, and a date that disagrees with the report it came from.
function plainDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Why a duplicate page was taken out of search results, in plain language.
 *
 * @param {object} facts
 * @param {string} facts.parentTitle  Title of the article this page repeated.
 * @param {string} facts.redirectsTo  Route the old link now lands on.
 * @param {string} facts.removedAt    ISO timestamp of the removal.
 * @returns {string}
 */
function duplicateRemovalReason({ parentTitle, redirectsTo, removedAt }) {
  const when = plainDate(removedAt);
  const parent = String(parentTitle || '').trim();
  const target = String(redirectsTo || '').trim();
  const parts = [];
  parts.push(`Removed automatically${when ? ` on ${when}` : ''} because it repeated the article ${parent ? `"${parent}"` : 'it was written from'} almost word for word, so search engines were seeing the same piece twice.`);
  parts.push(`Nothing was rewritten and nothing was lost${parent ? ` -- "${parent}" is still on your site` : ''}.`);
  if (target) parts.push(`Anyone who follows the old link now lands on ${target}.`);
  return parts.join(' ');
}

/**
 * Every automated removal must arrive here with a reason. A removal with no
 * reason is refused rather than written, because an unexplained removal is what
 * produced the "Revoked 54" defect in the first place.
 */
function requireRemovalReason(id, reason) {
  const text = String(reason || '').trim();
  if (!text) throw new Error(`Refusing to record a removal with no reason: ${id}. Every removal must say why, in plain language.`);
  return text;
}

module.exports = { duplicateRemovalReason, requireRemovalReason, plainDate };
