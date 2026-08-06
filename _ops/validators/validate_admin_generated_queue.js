const { read, fail } = require('./util');
const adminHtml = read('pages/admin/index.html');
const adminJs = read('assets/js/admin.js');
const operationsJs = read('assets/js/admin-operations.js');

// The restored client-facing admin remains the primary surface. Full-safe-autonomy
// status and controls live in the approved generated-candidates and optional
// operations panels; validation follows that product architecture rather than
// requiring the discarded command-center markup.
for (const token of ['optional-operations-panel','generated-content-panel']) {
  if (!adminHtml.includes(token)) fail(`Admin page missing approved autonomous support surface: ${token}`);
}
if (!/full safe autonomy/i.test(adminHtml)) fail('Admin page missing Full Safe Autonomy explanation.');
if (!/Routine client approval is not required/i.test(adminHtml)) fail('Admin page missing routine-approval boundary.');
for (const token of ['renderGeneratedCandidates','autonomyStatus','generated-candidates-tbody']) {
  if (!adminJs.includes(token)) fail(`Admin JS missing autonomous candidate rendering: ${token}`);
}
for (const token of ['/api/admin/status','/api/admin/action','runAction','SETUP_REQUIRED']) {
  if (!operationsJs.includes(token)) fail(`Optional operations client missing runtime wiring: ${token}`);
}
const briefs = JSON.parse(read('data/intake/content_brief_candidates.json'));
const queue = JSON.parse(read('data/social/publish_queue.json'));
if (!Array.isArray(briefs.candidates) || briefs.candidates.length === 0) fail('No content brief candidates available.');
if (!Array.isArray(queue.items) || queue.items.length === 0) fail('No autonomous publish queue items available.');
for (const candidate of briefs.candidates) {
  if (!candidate.id || !candidate.title || !candidate.contentType || !candidate.llmPrompt) fail(`Candidate missing required fields: ${candidate.id || 'not-labeled'}`);
  if (candidate.publicOnlyAfterApproval !== false || candidate.routineApprovalRequired !== false) fail(`Candidate still has a routine approval gate: ${candidate.id}`);
  if (candidate.llmGeneratedRequired !== true) fail(`Candidate must require structured LLM drafting: ${candidate.id}`);
}
console.log(`Admin autonomous content queue OK (${briefs.candidates.length} candidates, ${queue.items.length} queue items; original client admin preserved with optional operations).`);
