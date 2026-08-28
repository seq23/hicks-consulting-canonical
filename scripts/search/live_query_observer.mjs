import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic, nowIso, routeToSourceFile } from '../autonomy/lib/io.mjs';

const SITE_HOST='hicksconsulting.org';
function cleanText(v){return String(v||'').replace(/\s+/g,' ').trim();}
function hostOf(u){try{return new URL(u).hostname.replace(/^www\./,'').toLowerCase();}catch{return '';}}
function attributedHost(c){const title=String(c?.title||'').trim().toLowerCase().replace(/^www\./,'');if(/^[a-z0-9.-]+\.[a-z]{2,}$/.test(title))return title;return hostOf(c?.url||'');}function isSiteCitation(c){const h=attributedHost(c);return h===SITE_HOST||h.endsWith('.'+SITE_HOST)||String(c?.title||'').toLowerCase().includes(SITE_HOST);}
function stripHtml(html){return cleanText(String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '));}
function ownPageFeatures(route){const rel=routeToSourceFile(route);const full=path.resolve(process.cwd(),rel);if(!fs.existsSync(full))return {route,sourceFile:rel,status:'missing'};const html=fs.readFileSync(full,'utf8');const pick=(re)=>cleanText((html.match(re)||[])[1]||'');return {route,sourceFile:rel,status:'ok',title:pick(/<title[^>]*>([\s\S]*?)<\/title>/i),description:pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)||pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),h1:pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i),textChars:stripHtml(html).length,internalLinks:(html.match(/href=["']\//g)||[]).length,canonical:pick(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)};}
async function fetchFeature(url){try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 HicksSearchHealth/1.0'},redirect:'follow',signal:AbortSignal.timeout(12000)});const html=await r.text();if(!r.ok)return {url,status:'http_error',httpStatus:r.status};const pick=(re)=>cleanText((html.match(re)||[])[1]||'');return {url,resolvedUrl:r.url,status:'ok',httpStatus:r.status,title:pick(/<title[^>]*>([\s\S]*?)<\/title>/i),h1:pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i),headings:[...html.matchAll(/<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/gi)].slice(0,20).map(m=>stripHtml(m[1])),textChars:stripHtml(html).length};}catch(e){return {url,status:'fetch_failed',error:e.message};}}
// OpenRouter's web plugin returns its sources as message.annotations[].url_citation.
//
// This observer used to call Gemini with tools:[{google_search:{}}]. That path is
// hard-blocked for this project: plain generateContent returns 200, but any request
// carrying the google_search tool returns 429 RESOURCE_EXHAUSTED, reproduced across
// three models and persistent. Every observation therefore came back as a provider
// error, which is indistinguishable at a glance from a site that is genuinely never
// cited. The provider is pinned to OpenRouter so the observations are real.
const OPENROUTER_ENDPOINT='https://openrouter.ai/api/v1/chat/completions';
// OpenRouter bills the web plugin per REQUEST on the parallel engine with 10
// results included - measured at $0.00127/call on this account against ~$0.04
// on the default engine's per-result billing. Identical url_citation schema.
const WEB_ENGINE=process.env.OPENROUTER_WEB_ENGINE||'parallel';
const WEB_MODE=process.env.OPENROUTER_WEB_MODE||'turbo';
function openRouterCitations(body){
 const message=body?.choices?.[0]?.message||{};
 const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(part=>part?.text||'').join('\n'):'';
 const chunks=(Array.isArray(message.annotations)?message.annotations:[])
  .map(annotation=>annotation?.url_citation||(annotation?.type==='url_citation'?annotation:null))
  .filter(citation=>citation&&citation.url)
  .map(citation=>({url:citation.url,title:citation.title||''}));
 return {text,searchQueries:[],chunks};
}
async function openRouterObserve(query,primaryPage,env){
 const model=env.OPENROUTER_SEARCH_MODEL||'openai/gpt-4o-mini';
 const endpoint=env.OPENROUTER_API_URL||OPENROUTER_ENDPOINT;
 const prompt=`Use web search to investigate this exact local search query: ${JSON.stringify(query)}. We are evaluating https://www.hicksconsulting.org${primaryPage}. Identify which public web sources a live web search surfaces for this query, whether Hicks Consulting is among the cited sources, and the strongest competing pages or directories. Do not invent organic rank. Keep the answer factual and concise.`;
 const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${env.OPENROUTER_API_KEY}`},body:JSON.stringify({model,plugins:[{id:'web',engine:WEB_ENGINE,mode:WEB_MODE,max_results:Number(env.OPENROUTER_WEB_MAX_RESULTS||10)}],messages:[{role:'user',content:prompt}]}),signal:AbortSignal.timeout(Number(env.OPENROUTER_SEARCH_TIMEOUT_MS||45000))});
 const text=await r.text();
 if(!r.ok)throw new Error(`${r.status}: ${text.slice(0,500)}`);
 const body=JSON.parse(text);
 if(body?.error)throw new Error(`provider error: ${String(body.error.message||body.error).slice(0,500)}`);
 return {model,...openRouterCitations(body)};
}
function diagnosis(query,own,citations,siteSurfaced,competitors=[]){const q=query.toLowerCase();const combined=`${own.title||''} ${own.description||''} ${own.h1||''}`.toLowerCase();const reasons=[];if(own.status!=='ok')reasons.push('TARGET_PAGE_MISSING');if(!combined.includes(q))reasons.push('EXACT_QUERY_NOT_IN_PRIMARY_SEARCH_SURFACES');if((own.description||'').length<80)reasons.push('WEAK_META_DESCRIPTION');if((own.internalLinks||0)<3)reasons.push('WEAK_INTERNAL_AUTHORITY');if(!siteSurfaced)reasons.push('SITE_NOT_SURFACED_IN_GROUNDED_OBSERVATION');if(citations.length===0)reasons.push('NO_GROUNDED_CITATIONS_RETURNED');const healthy=competitors.filter(c=>c.status==='ok');if(healthy.some(c=>(c.textChars||0)>(own.textChars||0)*1.35))reasons.push('COMPETITOR_BROADER_VISIBLE_COVERAGE');if(healthy.some(c=>(c.headings||[]).length>8))reasons.push('COMPETITOR_DEEPER_ANSWER_STRUCTURE');return reasons;}
export async function runLiveQueryObservation(env=process.env,clock=new Date()){
 const targets=readJson('data/search/target_queries.json',{queries:[]});
 const configured=Boolean(env.OPENROUTER_API_KEY);
 const limit=Math.max(1,Math.min(25,Number(env.LIVE_QUERY_LIMIT||targets.queries.length||7)));
 const observations=[];
 if(configured){
  for(const target of targets.queries.slice(0,limit)){
   const own=ownPageFeatures(target.primaryPage);
   try{
    const g=await openRouterObserve(target.query,target.primaryPage,env);
    const citations=g.chunks;
    const siteSurfaced=citations.some(isSiteCitation);
    const competitorCitations=citations.filter(c=>!isSiteCitation(c)).slice(0,5);
    const competitorFeatures=[];
    for(const item of competitorCitations.slice(0,3))competitorFeatures.push(await fetchFeature(item.url));
    observations.push({query:target.query,primaryPage:target.primaryPage,status:'ok',observedAt:nowIso(clock),provider:'openrouter_web_search',model:g.model,observationType:'LIVE_WEB_SURFACING',rankVerified:false,providerAnswered:true,citationCount:citations.length,siteSurfaced,citations,searchQueries:g.searchQueries,competitors:competitorFeatures,ownPage:own,diagnosis:diagnosis(target.query,own,citations,siteSurfaced,competitorFeatures)});
   }catch(e){
    // A provider failure is NOT evidence of zero citations. siteSurfaced and
    // citationCount stay null so nothing downstream can read this observation as a
    // measured 0% citation rate; only providerAnswered:true observations carry that.
    observations.push({query:target.query,primaryPage:target.primaryPage,status:'provider_error',observedAt:nowIso(clock),provider:'openrouter_web_search',model:env.OPENROUTER_SEARCH_MODEL||'openai/gpt-4o-mini',rankVerified:false,providerAnswered:false,citationCount:null,siteSurfaced:null,citations:[],error:e.message,ownPage:own,diagnosis:['PROVIDER_ERROR']});
   }
  }
 }
 const answered=observations.filter(o=>o.status==='ok');
 const state=configured?(answered.length?'CONNECTED':'DEGRADED'):'NOT_CONFIGURED';
 // Rule 0: this stage never exits having quietly done nothing. When it cannot observe,
 // it names the stop and the reason instead of reporting an empty, healthy-looking run.
 let stop=null;
 if(!configured)stop={name:'SEARCH_PROVIDER_NOT_CONFIGURED',reason:'OPENROUTER_API_KEY is not set, so no live query observation was attempted. No citation rate was recorded.'};
 else if(!targets.queries.length)stop={name:'NO_GOVERNED_TARGET_QUERIES',reason:'data/search/target_queries.json carries no queries to observe.'};
 else if(!answered.length)stop={name:'SEARCH_PROVIDER_UNAVAILABLE',reason:`All ${observations.length} query observation(s) returned a provider error. Error states were recorded; no citation rate was recorded.`};
 const out={schemaVersion:'2.1.0',generatedAt:nowIso(clock),providerState:state,provider:'openrouter_web_search',stop,queriesAnswered:answered.length,truthBoundary:'These are live web-search observations and citations returned by OpenRouter\'s web plugin. They are not literal organic SERP positions, and a citation rate is only meaningful for observations where providerAnswered is true. Use GSC for Google-owned impressions, clicks, CTR, and average position.',observations};
 writeJsonAtomic('data/search/query_observations.json',out);
 const hist=readJson('data/search/query_observation_history.json',{schemaVersion:'1.0.0',observations:[]});
 hist.observations=[...(hist.observations||[]),...observations].slice(-1000);
 hist.updatedAt=nowIso(clock);
 writeJsonAtomic('data/search/query_observation_history.json',hist);
 return out;
}
if(import.meta.url===`file://${process.argv[1]}`)runLiveQueryObservation().then(x=>{
 console.log(JSON.stringify({ok:true,provider:x.provider,providerState:x.providerState,observed:x.observations.length,answered:x.queriesAnswered,surfaced:x.observations.filter(o=>o.status==='ok'&&o.siteSurfaced).length,stop:x.stop},null,2));
 if(x.stop)console.error(`NAMED_STOP ${x.stop.name}: ${x.stop.reason}`);
}).catch(e=>{console.error(e);process.exit(1)});
