const { fs, read, fail } = require('./util');
const adminHtml = read('pages/admin/index.html');
const adminJs = read('assets/js/admin.js');
const requiredHtml = [
  'generated-content-panel',
  'generated-candidates-tbody',
  'Generated content candidates from ingestion loop',
  'Nothing in this table publishes automatically'
];
for (const token of requiredHtml) {
  if (!adminHtml.includes(token)) fail(`Admin page missing generated content queue surface: ${token}`);
}
const requiredJs = [
  '/data/intake/content_brief_candidates.json',
  '/data/social/publish_queue.json',
  'renderGeneratedCandidates',
  'approved_for_drafting',
  'publicOnlyAfterApproval'
];
for (const token of requiredJs) {
  if (!adminJs.includes(token)) fail(`Admin JS missing generated content queue wiring: ${token}`);
}
const briefs = JSON.parse(read('data/intake/content_brief_candidates.json'));
if (!Array.isArray(briefs.candidates) || briefs.candidates.length === 0) fail('No content brief candidates available for admin queue.');
const queue = JSON.parse(read('data/social/publish_queue.json'));
if (!Array.isArray(queue.items) || queue.items.length === 0) fail('No social publish queue items available for admin queue.');
for (const candidate of briefs.candidates) {
  if (!candidate.id || !candidate.title || !candidate.contentType || !candidate.llmPrompt) fail(`Candidate missing required admin fields: ${candidate.id || 'unknown'}`);
  if (candidate.publicOnlyAfterApproval !== true) fail(`Candidate must remain approval-gated: ${candidate.id}`);
  if (candidate.llmGeneratedRequired !== true) fail(`Candidate must require LLM-generated/humanized drafting: ${candidate.id}`);
}
console.log(`Admin generated content queue OK (${briefs.candidates.length} candidates, ${queue.items.length} queue items).`);
