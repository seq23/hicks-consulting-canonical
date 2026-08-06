const fs = require('fs');
const path = require('path');
const root = process.cwd();
const outDir = path.join(root, 'data', 'intake');
fs.mkdirSync(outDir, { recursive: true });
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(path.join(root,file),'utf8')); } catch { return fallback; } }
function slugify(text){ return String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70) || 'content'; }
const policy = readJson('config/content_generation_policy.json', { contentTypes: {}, humanizationChecklist: [] });
const clusters = readJson('data/intake/query_clusters.json', { clusters: [] }).clusters || [];
const conversion = readJson('data/system/config.json', {}).forms || {};
const previousBriefPayload = readJson('data/intake/content_brief_candidates.json', { candidates: [] });
const previousQueue = readJson('data/social/publish_queue.json', { publishMode: 'queued', items: [] });
const typeOrder = ['whitepaper','article','insight','faq','fanout'];
function chooseType(cluster, index){
  if (cluster.score >= 80 || /workplace|authority|training/i.test(cluster.title)) return index === 0 ? 'whitepaper' : 'guide';
  if (/how|what|why|burnout|boundaries|healing|therapy/i.test(cluster.title)) return index % 2 ? 'article' : 'insight';
  return typeOrder[index % typeOrder.length];
}
function baseSections(contentType){
  const shared = ['Short answer', 'Who this is for', 'Why this matters', 'Decision criteria', 'Common mistakes', 'Next step'];
  if (contentType === 'whitepaper') return ['Executive summary','Context and signal source','Core problem','Audience analysis','Framework','Implementation guidance','Risks and limitations','Recommended next steps'];
  if (contentType === 'faq') return ['Short answer','Question set','Decision criteria','When to seek support','Approved next step'];
  return shared;
}
function repair(candidate){
  const typePolicy = policy.contentTypes[candidate.contentType] || policy.contentTypes.insight || { targetWords: 900, minimumWords: 720 };
  candidate.targetWords = candidate.targetWords || typePolicy.targetWords;
  candidate.minimumWords = candidate.minimumWords || typePolicy.minimumWords || Math.floor(candidate.targetWords * 0.8);
  candidate.autonomyStatus = candidate.autonomyStatus || candidate.state || 'DISCOVERED';
  candidate.publishMode = 'full_safe_autonomy';
  candidate.routineApprovalRequired = false;
  candidate.publicOnlyAfterApproval = false;
  delete candidate.approvalStatus;
  if (candidate.status === 'queued_for_owner_approval') delete candidate.status;
  candidate.humanizationChecklist = candidate.humanizationChecklist && candidate.humanizationChecklist.length ? candidate.humanizationChecklist : policy.humanizationChecklist;
  candidate.conversionPath = candidate.conversionPath || conversion.therapy || 'https://monika-hicks.clientsecure.me/';
  candidate.sections = candidate.sections && candidate.sections.length ? candidate.sections : baseSections(candidate.contentType);
  candidate.llmPrompt = candidate.llmPrompt || [
    `Create a humanized ${candidate.contentType} draft for Hicks Consulting.`,
    `Title: ${candidate.title}`,
    `Cluster: ${candidate.clusterTitle}`,
    `Minimum words: ${candidate.minimumWords}. Target words: ${candidate.targetWords}.`,
    'Write in a warm, grounded, specific voice. Do not diagnose. Do not guarantee outcomes. Do not invent client stories.',
    `Include these sections: ${candidate.sections.join('; ')}.`,
    `Approved conversion path after value is delivered: ${candidate.conversionPath}`
  ].join('\n');
  return candidate;
}
function validate(candidate){
  const required = policy.prewriteGate?.requiredFields || [];
  const missing = required.filter(key => !candidate[key] || (Array.isArray(candidate[key]) && !candidate[key].length));
  if (missing.length) return `missing fields: ${missing.join(', ')}`;
  if (candidate.targetWords < candidate.minimumWords) return 'targetWords below minimumWords';
  if (!policy.prewriteGate.allowedAutonomyStatuses.includes(candidate.autonomyStatus)) return `invalid autonomyStatus: ${candidate.autonomyStatus}`;
  return null;
}
const active = clusters.filter(c => (c.queryCount || 0) > 0).sort((a,b) => (b.score||0)-(a.score||0));
const generated = active.slice(0, 8).map((cluster, index) => {
  const contentType = chooseType(cluster, index);
  const typePolicy = policy.contentTypes[contentType] || policy.contentTypes.insight;
  return repair({
    id: `brief-${cluster.id}-${contentType}`,
    clusterId: cluster.id,
    clusterTitle: cluster.title,
    contentType,
    title: `${cluster.title}: what people are asking and what to do next`,
    suggestedRoute: `/resources/${contentType === 'whitepaper' ? 'white-papers' : contentType === 'article' ? 'articles' : contentType === 'guide' ? 'guides' : 'insights'}/${slugify(cluster.title)}-${contentType}/`,
    targetWords: typePolicy.targetWords,
    minimumWords: typePolicy.minimumWords,
    sourceSignalCount: cluster.queryCount,
    score: cluster.score,
    publishMode: 'full_safe_autonomy',
    autonomyStatus: 'DISCOVERED',
    routineApprovalRequired: false,
    llmGeneratedRequired: true,
    publicOnlyAfterApproval: false,
    createdAt: new Date().toISOString()
  });
});

// Preserve rolling-continuity candidates across the existing twice-weekly ingestion refresh.
// They remain autonomous backlog candidates; cadence assignment and publication authority belong to the Safe Harbor runtime.
const continuityMap = new Map();
for (const item of [...(previousBriefPayload.candidates || []), ...(previousQueue.items || [])]) {
  if (!item?.id) continue;
  if (item.continuity_generated === true || String(item.id).startsWith('continuity-')) continuityMap.set(item.id, repair({ ...item }));
}
const mergedMap = new Map(generated.map(x => [x.id, x]));
for (const [id, item] of continuityMap) if (!mergedMap.has(id)) mergedMap.set(id, item);
const candidates = [...mergedMap.values()];

const errors = candidates.map(c => [c.id, validate(c)]).filter(([,err]) => err);
if (errors.length) {
  console.error('CONTENT BRIEF PREWRITE SELF-REPAIR FAIL');
  for (const [id, err] of errors) console.error(`- ${id}: ${err}`);
  process.exit(1);
}
const payload = { generatedAt: new Date().toISOString(), policy: 'full_safe_autonomy_llm_humanized_prewrite_validated', candidates };
fs.writeFileSync(path.join(outDir, 'content_brief_candidates.json'), JSON.stringify(payload, null, 2) + '\n');
const socialDir = path.join(root, 'data', 'social');
fs.mkdirSync(socialDir, { recursive: true });
const existing = new Map((previousQueue.items || []).map(item => [item.id, item]));
for (const candidate of candidates) existing.set(candidate.id, { ...candidate, queueType: 'content_brief', publishMode: 'full_safe_autonomy', autonomyStatus: candidate.autonomyStatus || 'DISCOVERED', routineApprovalRequired: false, publicOnlyAfterApproval: false });
const autonomousItems = [...existing.values()].map((item) => {
  const normalized = { ...item, publishMode: 'full_safe_autonomy', autonomyStatus: item.autonomyStatus || item.state || 'DISCOVERED', routineApprovalRequired: false, publicOnlyAfterApproval: false };
  delete normalized.approvalStatus;
  if (normalized.status === 'queued_for_owner_approval') delete normalized.status;
  return normalized;
});
fs.writeFileSync(path.join(socialDir, 'publish_queue.json'), JSON.stringify({ generatedAt: payload.generatedAt, publishMode: 'full_safe_autonomy', items: autonomousItems }, null, 2) + '\n');
console.log(`Content brief candidates built: ${candidates.length} (${continuityMap.size} continuity candidates preserved)`);
