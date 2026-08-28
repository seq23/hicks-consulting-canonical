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
    gemini_grounded_search:{state:String(query.providerState||'NOT_CONFIGURED'),configured:Boolean(env.GEMINI_API_KEY),capabilities:{liveWeb:true,groundedCitations:true,literalOrganicRank:false,paaLiteral:false},model:env.GEMINI_SEARCH_MODEL||'gemini-flash-lite-latest',costBoundary:'Designed for the Gemini Developer API free tier when available; the workflow enforces a bounded daily query panel.'},
    gsc:{state:state(gsc.status==='ok',Boolean(env.GSC_ACCESS_TOKEN||(env.GSC_SERVICE_ACCOUNT_EMAIL&&env.GSC_PRIVATE_KEY)),gsc.status==='warning'?gsc.message:''),configured:Boolean(env.GSC_ACCESS_TOKEN||(env.GSC_SERVICE_ACCOUNT_EMAIL&&env.GSC_PRIVATE_KEY)),capabilities:{ownedGooglePerformance:true,averagePosition:true,indexInspection:true,forceIndexing:false}},
    bing:{state:state(bing.status==='ok',Boolean(env.BING_WEBMASTER_API_KEY),bing.status==='warning'?bing.message:''),configured:Boolean(env.BING_WEBMASTER_API_KEY),capabilities:{bingPerformance:true,crawlStats:true,indexSignals:true}},
    legacy_serp_provider:{state:Boolean(env.SEARCH_API_URL&&env.SEARCH_PROVIDER_API_KEY)?'CONFIGURED_OPTIONAL':'NOT_CONFIGURED',configured:Boolean(env.SEARCH_API_URL&&env.SEARCH_PROVIDER_API_KEY),capabilities:{literalOrganicRank:'provider_dependent'}}
  };
  const output={schemaVersion:'2.0.0',generatedAt:nowIso(clock),truthBoundary:'Grounded Google Search observations are evidence of live web surfacing/citations, not verified organic rank. GSC average position is the authoritative Google-owned performance metric available to this system.',providers};
  writeJsonAtomic('data/search/provider_health.json',output);
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(buildProviderHealth(process.env, new Date()), null, 2));
}
