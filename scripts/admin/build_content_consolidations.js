#!/usr/bin/env node
/*
 * Write down, in one place, what actually happened to the 54 insight pages that
 * left the site on 8 August 2026.
 *
 * The manifest records them as status:"revoked" and nothing else -- no reason,
 * no name. The admin page read that word and told Monika 54 of her pieces were
 * "Revoked", which reads as 54 things she decided against. She decided against
 * none of them: they were near-duplicates of articles already on her site
 * (>=0.85 similarity, duplicate <title>), pulled out of the public sitemap by an
 * automated index-quality pass and 301-redirected to the article each one
 * duplicated. No text was merged and no text was rewritten.
 *
 * The evidence for that lives in reports/BING_INDEXATION_CONSOLIDATION_REPORT.json,
 * which is a search-engineering artefact nobody reads on a Tuesday. This turns it
 * into a record the admin surface can load and describe honestly, and that
 * validate_client_decision_attribution.js can check has not drifted.
 *
 * Regenerate with: npm run build:content-consolidations
 */
const fs = require('fs');
const path = require('path');
const { duplicateRemovalReason, requireRemovalReason } = require('./removal_reasons.js');

const root = path.resolve(__dirname, '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const REPORT_PATH = 'reports/BING_INDEXATION_CONSOLIDATION_REPORT.json';
const OUT_PATH = 'data/admin/content_consolidations.json';

const report = read(REPORT_PATH);
const manifest = read('data/admin/content_manifest.json');
const byId = new Map(manifest.map((item) => [item.id, item]));

// The parent an insight duplicated is identified by route, not by guesswork:
// the report's `target` is the article's slug and the manifest gives its title.
const byRoute = new Map(manifest.map((item) => [String(item.publicPath || item.slug || ''), item]));

const entries = (report.mappings || []).map((mapping) => {
  const item = byId.get(mapping.insightId) || {};
  const parent = byRoute.get(String(mapping.target)) || {};
  const removedAt = item.revokedAt || report.generatedAt;
  const reason = duplicateRemovalReason({
    parentTitle: parent.title || '',
    redirectsTo: mapping.target,
    removedAt
  });
  return {
    id: mapping.insightId,
    title: item.title || '',
    // The reason is the point of this file. It is written per item, names the
    // specific article this one repeated, and says where the old link goes --
    // so a person can read one row and know exactly what happened.
    reason: requireRemovalReason(mapping.insightId, reason),
    removedBy: 'system',
    parentTitle: parent.title || '',
    removedFrom: mapping.source,
    redirectsTo: mapping.target,
    similarity: mapping.similarity,
    duplicateHtmlTitle: mapping.duplicateHtmlTitle === true,
    removedAt
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const out = {
  schemaVersion: '1.0.0',
  note: 'Pages an automated index-quality pass took out of the public sitemap because they duplicated an article already on the site. No person decided this and no writing was changed: each one 301-redirects to the article it duplicated, and that article is still live. Every entry carries the plain-language reason shown to the client under "Removed automatically" in /admin/. These are shown as the system\'s decision, never as hers.',
  decidedBy: 'automated-index-quality-pass',
  humanDecision: false,
  editorialContentRewritten: report.editorialContentRewritten === true,
  similarityThreshold: report.similarityThreshold,
  sourceReport: REPORT_PATH,
  generatedAt: report.generatedAt,
  count: entries.length,
  consolidations: entries
};

fs.writeFileSync(path.join(root, OUT_PATH), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${OUT_PATH}: ${entries.length} consolidation(s) recorded from ${REPORT_PATH}.`);
