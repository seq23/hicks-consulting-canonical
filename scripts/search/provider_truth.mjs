import { readJson, writeJsonAtomic, nowIso } from '../autonomy/lib/io.mjs';

function state(ok, configured, error='') {
  if (ok) return 'CONNECTED';
  if (!configured) return 'NOT_CONFIGURED';
  return error ? 'DEGRADED' : 'DISCONNECTED';
}

export function buildProviderHealth(env=process.env, clock=new Date()) {
  const gsc=readJson('data/agency/gsc_snapshot.json',{status:'not_connected'});
  const bing=readJson('data/agency/bing_snapshot.json',{status:'not_connected'});
  const query=readJson('data/search/query_observations.json',{providerState:'NOT_CONFIGURED'});
  const providers={
    // Pinned to OpenRouter. Gemini grounded search is hard-blocked for this project:
    // plain generateContent returns 200 but any request carrying the google_search
    // tool returns 429 RESOURCE_EXHAUSTED, reproduced across three models and
    // persistent, so every grounded observation failed and no citation evidence was
    // ever produced.
    openrouter_web_search:{state:String(query.providerState||'NOT_CONFIGURED'),configured:Boolean(env.OPENROUTER_API_KEY),capabilities:{liveWeb:true,groundedCitations:true,literalOrganicRank:false,paaLiteral:false},model:env.OPENROUTER_SEARCH_MODEL||'openai/gpt-4o-mini',queriesAnswered:Number(query.queriesAnswered||0),lastStop:query.stop||null,costBoundary:'Paid per request on OpenRouter; the workflow enforces a bounded daily query panel via LIVE_QUERY_LIMIT.'},
    gsc:{state:state(gsc.status==='ok',Boolean(env.GSC_ACCESS_TOKEN||(env.GSC_SERVICE_ACCOUNT_EMAIL&&env.GSC_PRIVATE_KEY)),gsc.status==='warning'?gsc.message:''),configured:Boolean(env.GSC_ACCESS_TOKEN||(env.GSC_SERVICE_ACCOUNT_EMAIL&&env.GSC_PRIVATE_KEY)),capabilities:{ownedGooglePerformance:true,averagePosition:true,indexInspection:true,forceIndexing:false}},
    bing:{state:state(bing.status==='ok',Boolean(env.BING_WEBMASTER_API_KEY),bing.status==='warning'?bing.message:''),configured:Boolean(env.BING_WEBMASTER_API_KEY),capabilities:{bingPerformance:true,crawlStats:true,indexSignals:true}},
    legacy_serp_provider:{state:Boolean(env.SEARCH_API_URL&&env.SEARCH_PROVIDER_API_KEY)?'CONFIGURED_OPTIONAL':'NOT_CONFIGURED',configured:Boolean(env.SEARCH_API_URL&&env.SEARCH_PROVIDER_API_KEY),capabilities:{literalOrganicRank:'provider_dependent'}}
  };
  const output={schemaVersion:'2.0.0',generatedAt:nowIso(clock),truthBoundary:'Live web-search observations are evidence of web surfacing/citations, not verified organic rank, and a 0% citation rate is only meaningful for queries the provider actually answered. GSC average position is the authoritative Google-owned performance metric available to this system.',providers};
  writeJsonAtomic('data/search/provider_health.json',output);
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(buildProviderHealth(process.env, new Date()), null, 2));
}
