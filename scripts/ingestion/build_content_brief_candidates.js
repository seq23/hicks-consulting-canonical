const fs = require('fs');
const path = require('path');
const {
  TitleRegistry, buildDemandPool, takenTitles, grandfatheredKeys, sectionsForForm,
} = require('../lib/demand_titles.js');
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
  // A demand-grounded candidate always gets its prompt rebuilt from its CURRENT
  // title. Keeping a stale prompt would tell the writer to answer the old
  // composed title while the page shipped under the new question.
  if (candidate.demandPhrasing) candidate.llmPrompt = null;
  candidate.llmPrompt = candidate.llmPrompt || [
    `Create a humanized ${candidate.contentType} draft for Hicks Consulting.`,
    `Title: ${candidate.title}`,
    candidate.demandPhrasing
      ? `This page exists to answer exactly one real question a person typed or said: "${candidate.title}". Answer THAT question, in that person's words, in the first two sentences. Do not broaden it into a general overview of ${candidate.clusterTitle}; other pages on this site cover other questions in the same area and this one must not overlap them.`
      : `Cluster: ${candidate.clusterTitle}`,
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
// ---------------------------------------------------------------- titles
//
// Titles used to be COMPOSED here: `${cluster.title}: what people are asking and
// what to do next`. Every brief off a cluster therefore carried the cluster title
// plus one interchangeable suffix - the same defect that put duplicateHtmlTitle
// on all 54 mappings in reports/BING_INDEXATION_CONSOLIDATION_REPORT.json.
//
// Titles are now DRAWN from config/demand_phrasings.json, which is grounded in
// the live clusters and the measured GSC target queries, and claimed through a
// registry seeded with every title the repo already owns. There is no suffix
// because there is no composition step.
const registry = new TitleRegistry(takenTitles(root), { grandfathered: grandfatheredKeys(root) });
const pool = buildDemandPool(root, { registry });
const poolByFamily = new Map();
for (const entry of pool) {
  if (!poolByFamily.has(entry.familyId)) poolByFamily.set(entry.familyId, []);
  poolByFamily.get(entry.familyId).push(entry);
}
const spillover = pool.slice();
function drawFor(clusterId) {
  const preferred = poolByFamily.get(clusterId) || [];
  while (preferred.length) {
    const entry = preferred.shift();
    if (registry.claim(entry.title)) { const i = spillover.indexOf(entry); if (i >= 0) spillover.splice(i, 1); return entry; }
  }
  while (spillover.length) {
    const entry = spillover.shift();
    const fam = poolByFamily.get(entry.familyId);
    if (fam) { const i = fam.indexOf(entry); if (i >= 0) fam.splice(i, 1); }
    if (registry.claim(entry.title)) return entry;
  }
  return null;
}

const active = clusters.filter(c => (c.queryCount || 0) > 0).sort((a,b) => (b.score||0)-(a.score||0));
// A candidate that already has a demand-grounded title keeps it. Re-drawing on
// every ingestion run would churn titles and routes under approved work.
const priorById = new Map([...(previousBriefPayload.candidates || []), ...(previousQueue.items || [])]
  .filter(x => x && x.id).map(x => [x.id, x]));
const exhausted = [];
const generated = active.slice(0, 8).map((cluster, index) => {
  const contentType = chooseType(cluster, index);
  const typePolicy = policy.contentTypes[contentType] || policy.contentTypes.insight;
  const id = `brief-${cluster.id}-${contentType}`;
  const prior = priorById.get(id);
  let title = prior && prior.demandPhrasing ? prior.title : null;
  let demandPhrasing = prior && prior.demandPhrasing ? prior.demandPhrasing : null;
  let form = demandPhrasing ? demandPhrasing.form : null;
  if (title) registry.claim(title);
  if (!title) {
    const drawn = drawFor(cluster.id);
    if (!drawn) { exhausted.push(id); return null; }
    title = drawn.title;
    form = drawn.form;
    demandPhrasing = { source: 'config/demand_phrasings.json', familyId: drawn.familyId, clusterId: drawn.clusterId, form: drawn.form, groundedIn: drawn.groundedIn, evidence: drawn.evidence };
  }
  const dir = contentType === 'whitepaper' ? 'white-papers' : contentType === 'article' ? 'articles' : contentType === 'guide' ? 'guides' : 'insights';
  return repair({
    id,
    clusterId: cluster.id,
    clusterTitle: cluster.title,
    contentType,
    title,
    // The route now follows the title, so the URL reads like the question too.
    suggestedRoute: (prior && prior.demandPhrasing && prior.suggestedRoute) || `/resources/${dir}/${slugify(title)}/`,
    sections: sectionsForForm(form, contentType),
    demandPhrasing,
    targetWords: typePolicy.targetWords,
    minimumWords: typePolicy.minimumWords,
    sourceSignalCount: cluster.queryCount,
    score: cluster.score,
    publishMode: 'full_safe_autonomy',
    autonomyStatus: 'DISCOVERED',
    routineApprovalRequired: false,
    llmGeneratedRequired: true,
    publicOnlyAfterApproval: false,
    createdAt: (prior && prior.createdAt) || new Date().toISOString()
  });
}).filter(Boolean);

if (exhausted.length) {
  // NAMED STOP, never a silent skip: the phrasing bank ran dry for these clusters
  // and the fix is to replenish config/demand_phrasings.json from new research,
  // not to fall back to a template.
  console.error(`DEMAND_POOL_EXHAUSTED for ${exhausted.length} brief(s): ${exhausted.join(', ')}`);
}
if (!generated.length && active.length) {
  console.error('DEMAND_POOL_EXHAUSTED: no brief could be titled from config/demand_phrasings.json. Replenish the phrasing bank from research before the next ingestion run.');
  process.exit(1);
}

// Preserve rolling-continuity candidates across the existing twice-weekly ingestion refresh.
// They remain autonomous backlog candidates; cadence assignment and publication authority belong to the Safe Harbor runtime.
const continuityMap = new Map();
for (const item of [...(previousBriefPayload.candidates || []), ...(previousQueue.items || [])]) {
  if (!item?.id) continue;
  if (item.continuity_generated === true || String(item.id).startsWith('continuity-')) continuityMap.set(item.id, repair({ ...item }));
}
const mergedMap = new Map(generated.map(x => [x.id, x]));
for (const [id, item] of continuityMap) if (!mergedMap.has(id)) mergedMap.set(id, item);

// Carry-forward candidates from earlier runs kept their COMPOSED titles - and two
// of them were byte-identical to each other, because the composition was
// `${cluster.title}` plus one fixed suffix and two content types off the same
// cluster produce the same string. None of these has ever been published (they
// hold no route in the manifest), so they are retitled from the demand bank here
// rather than being left as a second, unlinked list of duplicate titles.
const manifestRoutes = new Set((readJson('data/admin/content_manifest.json', []) || []).flatMap(x => [x.slug, x.publicPath]).filter(Boolean));
const manifestTitles = new Set((readJson('data/admin/content_manifest.json', []) || []).map(x => x.title));
let retitled = 0;
for (const [id, item] of [...(previousQueue.items || []), ...(previousBriefPayload.candidates || [])].map(x => [x.id, x])) {
  if (!id || mergedMap.has(id)) continue;
  if (manifestRoutes.has(item.suggestedRoute) || manifestTitles.has(item.title)) { mergedMap.set(id, repair({ ...item })); continue; }
  const next = { ...item };
  if (!next.demandPhrasing) {
    const drawn = drawFor(next.clusterId);
    if (!drawn) { mergedMap.set(id, repair(next)); continue; }
    next.title = drawn.title;
    next.demandPhrasing = { source: 'config/demand_phrasings.json', familyId: drawn.familyId, clusterId: drawn.clusterId, form: drawn.form, groundedIn: drawn.groundedIn, evidence: drawn.evidence };
    next.sections = sectionsForForm(drawn.form, next.contentType);
    const dir = next.contentType === 'whitepaper' ? 'white-papers' : next.contentType === 'article' ? 'articles' : next.contentType === 'guide' ? 'guides' : 'insights';
    next.suggestedRoute = `/resources/${dir}/${slugify(drawn.title)}/`;
    retitled += 1;
  } else {
    registry.claim(next.title);
  }
  mergedMap.set(id, repair(next));
}
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
console.log(`Content brief candidates built: ${candidates.length} (${continuityMap.size} continuity candidates preserved; ${retitled} carry-forward candidates retitled from the demand bank)`);
