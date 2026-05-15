const fs = require('fs');
const warnings = [];
function warn(m){ warnings.push(`CONTENT BRIEF WARNING: ${m}`); }
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
const policy = readJson('config/content_generation_policy.json', {});
const payload = readJson('data/intake/content_brief_candidates.json', null);
if (!payload) warn('data/intake/content_brief_candidates.json missing. Run npm run ingest:briefs.');
const candidates = payload?.candidates || [];
if (!Array.isArray(candidates) || !candidates.length) warn('No content brief candidates are queued.');
for (const c of candidates) {
  const typePolicy = policy.contentTypes?.[c.contentType];
  if (!typePolicy) warn(`${c.id || 'unknown'} has unknown contentType ${c.contentType}`);
  if (!c.llmGeneratedRequired) warn(`${c.id} must be marked llmGeneratedRequired.`);
  if (!c.publicOnlyAfterApproval) warn(`${c.id} must remain private until approval.`);
  if (typeof c.minimumWords !== 'number' || typeof c.targetWords !== 'number') warn(`${c.id} missing numeric word targets.`);
  if (typePolicy && c.minimumWords < typePolicy.minimumWords) warn(`${c.id} minimumWords below approved 20% flex floor.`);
  if (!Array.isArray(c.humanizationChecklist) || c.humanizationChecklist.length < 4) warn(`${c.id} missing humanization checklist.`);
  if (!c.llmPrompt || c.llmPrompt.length < 300) warn(`${c.id} missing detailed LLM generation prompt.`);
}
if (warnings.length) {
  console.warn(warnings.join('\n'));
} else {
  console.log('Content brief candidate advisory OK');
}
process.exit(0);
