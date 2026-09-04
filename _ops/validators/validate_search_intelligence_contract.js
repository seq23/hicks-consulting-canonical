const { emitFinding } = require('../validation/protocol');
const fs=require('fs');
const required=['scripts/search/live_query_observer.mjs','scripts/search/build_search_action_queue.mjs','scripts/search/apply_bounded_search_repairs.mjs','scripts/search/provider_truth.mjs','scripts/search/run_provider_audit.mjs','data/search/target_queries.json','.github/workflows/agency-seo-monitor.yml'];
const fail=[];for(const f of required)if(!fs.existsSync(f))fail.push(`missing ${f}`);
const read=(f)=>fs.existsSync(f)?fs.readFileSync(f,'utf8'):'';
const obs=read('scripts/search/live_query_observer.mjs');
const truth=read('scripts/search/provider_truth.mjs');
const audit=read('scripts/search/run_provider_audit.mjs');
const queue=read('scripts/search/build_search_action_queue.mjs');
const wf=read('.github/workflows/agency-seo-monitor.yml');

// Live observations are web surfacing evidence, never literal organic rank.
if(!obs.includes('rankVerified:false'))fail.push('grounded observations must explicitly deny literal rank verification');

// The observation provider is pinned to OpenRouter. Gemini GROUNDED search is
// hard-blocked for this project: plain generateContent returns 200, but any request
// carrying tools:[{google_search:{}}] returns 429 RESOURCE_EXHAUSTED, reproduced
// across three models and persistent. Preferring it produced nothing but provider
// errors, so the pin is part of the contract rather than a preference.
if(!obs.includes('openrouter.ai/api/v1/chat/completions'))fail.push('live query observer does not call the OpenRouter chat completions endpoint');
if(!/plugins:\[\{id:'web'/.test(obs))fail.push('live query observer does not request the OpenRouter web plugin');
if(!obs.includes('url_citation'))fail.push('live query observer does not read OpenRouter url_citation annotations');
if(!obs.includes('OPENROUTER_API_KEY'))fail.push('live query observer does not gate on OPENROUTER_API_KEY');
// Comments are stripped first: these files are required to EXPLAIN why Gemini
// grounded search is barred, so only executable code is searched for it.
const code=(text)=>text.split('\n').filter((line)=>!/^\s*\/\//.test(line)).join('\n');
for(const [file,name,text] of [['scripts/search/live_query_observer.mjs','observer',obs],['scripts/search/provider_truth.mjs','provider truth',truth]]){
  if(/google_search|generativelanguage\.googleapis\.com|GEMINI_API_KEY/.test(code(text)))fail.push(`${name} (${file}) still reaches for hard-blocked Gemini grounded search`);
}
if(!truth.includes('openrouter_web_search')||!audit.includes('openrouter_web_search'))fail.push('provider health and the provider audit must report the pinned openrouter_web_search provider');
if(/GEMINI_API_KEY|GEMINI_SEARCH_MODEL/.test(wf))fail.push('agency monitor still injects Gemini grounded-search configuration');
if(!wf.includes('OPENROUTER_API_KEY'))fail.push('agency monitor does not inject OPENROUTER_API_KEY');

// A 0% citation rate may only be recorded when the provider actually answered. An
// observation that errored must carry an error state, not a measured zero.
if(!obs.includes("status:'provider_error'"))fail.push('live query observer does not record an error state when the provider fails');
if(!obs.includes('providerAnswered:true')||!obs.includes('providerAnswered:false'))fail.push('observations must state whether the provider actually answered');
if(!/siteSurfaced:null/.test(obs)||!/citationCount:null/.test(obs))fail.push('a failed observation must not record a measured zero for citations or surfacing');
if(!/groundedSiteSurfaced:obs\?\.status==='ok'\?/.test(queue))fail.push('the search action queue must not record grounded surfacing as false for a query the provider never answered');

// Rule 0: this stage either observes or emits a named stop with a reason.
for(const stopName of ['SEARCH_PROVIDER_NOT_CONFIGURED','NO_GOVERNED_TARGET_QUERIES','SEARCH_PROVIDER_UNAVAILABLE']){
  if(!obs.includes(stopName))fail.push(`live query observer does not emit the named legitimate stop ${stopName}`);
}
if(!obs.includes('NAMED_STOP'))fail.push('live query observer does not surface its named stop on the console');

if(fail.length){emitFinding(fail.map((f)=>`- ${f}`),{summary:`search-intelligence-defect(s)=${fail.length}`});process.exit(1)}console.log(`Search intelligence contract structurally OK (provider pinned to OpenRouter web search, Gemini grounding barred, error states separated from measured zeros, named stops present).`);
