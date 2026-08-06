const { read, fail } = require('./util');
const adminHtml = read('pages/admin/index.html');
const adminJs = read('assets/js/admin.js');
for (const token of ['autonomy-panel','autonomy-queue-tbody','Full Safe Autonomy','Routine approval is not required']) {
  if (!adminHtml.includes(token)) fail(`Admin page missing autonomous control-room surface: ${token}`);
}
for (const token of ['/api/admin/status','renderAutonomyQueue','SCHEDULED','SKIPPED_UNSUPPORTED_CLAIM']) {
  if (!adminJs.includes(token)) fail(`Admin JS missing autonomy control-room wiring: ${token}`);
}
const briefs = JSON.parse(read('data/intake/content_brief_candidates.json'));
const queue = JSON.parse(read('data/social/publish_queue.json'));
if (!Array.isArray(briefs.candidates) || briefs.candidates.length === 0) fail('No content brief candidates available.');
if (!Array.isArray(queue.items) || queue.items.length === 0) fail('No autonomous publish queue items available.');
for (const candidate of briefs.candidates) {
  if (!candidate.id || !candidate.title || !candidate.contentType || !candidate.llmPrompt) fail(`Candidate missing required fields: ${candidate.id || 'unknown'}`);
  if (candidate.publicOnlyAfterApproval !== false || candidate.routineApprovalRequired !== false) fail(`Candidate still has a routine approval gate: ${candidate.id}`);
  if (candidate.llmGeneratedRequired !== true) fail(`Candidate must require structured LLM drafting: ${candidate.id}`);
}
console.log(`Admin autonomous content queue OK (${briefs.candidates.length} candidates, ${queue.items.length} queue items).`);
