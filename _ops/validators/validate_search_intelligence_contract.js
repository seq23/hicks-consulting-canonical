const fs=require('fs');
const required=['scripts/search/live_query_observer.mjs','scripts/search/build_search_action_queue.mjs','scripts/search/apply_bounded_search_repairs.mjs','scripts/search/provider_truth.mjs','scripts/search/run_provider_audit.mjs','data/search/target_queries.json','.github/workflows/agency-seo-monitor.yml'];
const fail=[];for(const f of required)if(!fs.existsSync(f))fail.push(`missing ${f}`);
const obs=fs.existsSync('scripts/search/live_query_observer.mjs')?fs.readFileSync('scripts/search/live_query_observer.mjs','utf8'):'';
if(!obs.includes('rankVerified:false'))fail.push('grounded observations must explicitly deny literal rank verification');
if(!obs.includes('google_search'))fail.push('Gemini Google Search grounding is not wired');
const wf=fs.readFileSync('.github/workflows/agency-seo-monitor.yml','utf8');if(!wf.includes('GEMINI_API_KEY'))fail.push('agency monitor does not inject GEMINI_API_KEY');
if(fail.length){console.error(fail.join('\n'));process.exit(1)}console.log('Search intelligence contract structurally OK');
