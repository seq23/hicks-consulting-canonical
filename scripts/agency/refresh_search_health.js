const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.cwd();
const outDir = path.join(root, 'data', 'agency');
fs.mkdirSync(outDir, { recursive: true });
const now = new Date();
const site = (process.env.LIVE_SITE_URL || 'https://www.hicksconsulting.org').replace(/\/$/, '');
function write(name, value) { fs.writeFileSync(path.join(outDir, `${name}_snapshot.json`), JSON.stringify(value, null, 2) + '\n'); }
function base64url(value) { return Buffer.from(value).toString('base64url'); }
function dateOnly(d) { return d.toISOString().slice(0,10); }
function shiftDays(days) { const d = new Date(now); d.setUTCDate(d.getUTCDate()+days); return dateOnly(d); }
async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal:AbortSignal.timeout(20000) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw:text.slice(0,1000) }; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(body).slice(0,600)}`);
  return body;
}
async function gscToken() {
  if (process.env.GSC_ACCESS_TOKEN) return process.env.GSC_ACCESS_TOKEN;
  const email = process.env.GSC_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GSC_PRIVATE_KEY || '').replace(/\\n/g,'\n');
  if (!email || !key) return null;
  const header = base64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const iat = Math.floor(Date.now()/1000);
  const payload = base64url(JSON.stringify({iss:email,scope:'https://www.googleapis.com/auth/webmasters.readonly',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600}));
  const input = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
  const assertion = `${input}.${signature}`;
  const token = await fetchJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  return token.access_token;
}
async function refreshGsc() {
  const siteUrl = process.env.GSC_SITE_URL || 'https://www.hicksconsulting.org/';
  try {
    const token = await gscToken();
    if (!token) return write('gsc',{provider:'gsc',status:'not_connected',checkedAt:now.toISOString(),siteUrl,message:'Add GSC_SITE_URL plus GSC service-account secrets or GSC_ACCESS_TOKEN to enable automatic Search Console monitoring.'});
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const query = async (startDate,endDate,dimensions,rowLimit=25) => fetchJson(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({startDate,endDate,dimensions,rowLimit,type:'web',dataState:'final'})});
    const currentStart=shiftDays(-30), currentEnd=shiftDays(-3), previousStart=shiftDays(-58), previousEnd=shiftDays(-31);
    const [summary, previous, topQueries, topPages, byDate] = await Promise.all([
      query(currentStart,currentEnd,[]), query(previousStart,previousEnd,[]), query(currentStart,currentEnd,['query'],20), query(currentStart,currentEnd,['page'],20), query(currentStart,currentEnd,['date'],60)
    ]);
    const cur=(summary.rows||[{}])[0], prev=(previous.rows||[{}])[0];
    write('gsc',{provider:'gsc',status:'ok',checkedAt:now.toISOString(),siteUrl,dateRange:{currentStart,currentEnd,previousStart,previousEnd},metrics:{clicks:cur.clicks||0,impressions:cur.impressions||0,ctr:cur.ctr||0,position:cur.position||0,previousClicks:prev.clicks||0,previousImpressions:prev.impressions||0,previousCtr:prev.ctr||0,previousPosition:prev.position||0},topQueries:topQueries.rows||[],topPages:topPages.rows||[],daily:byDate.rows||[],message:'Search Console API connected and refreshed.'});
  } catch (err) { write('gsc',{provider:'gsc',status:'warning',checkedAt:now.toISOString(),message:err.message}); }
}
async function bingCall(method, params={}) {
  const key=process.env.BING_WEBMASTER_API_KEY;
  const url=new URL(`https://ssl.bing.com/webmaster/api.svc/json/${method}`);
  url.searchParams.set('apikey',key);
  for(const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  const body=await fetchJson(url.toString());
  return body.d ?? body;
}
async function refreshBing() {
  const siteUrl=process.env.BING_SITE_URL || 'https://www.hicksconsulting.org/';
  if (!process.env.BING_WEBMASTER_API_KEY) return write('bing',{provider:'bing',status:'not_connected',checkedAt:now.toISOString(),siteUrl,message:'Add BING_WEBMASTER_API_KEY and BING_SITE_URL to enable automatic Bing Webmaster monitoring.'});
  try {
    const [sites,rank,queries,crawl] = await Promise.all([
      bingCall('GetUserSites'), bingCall('GetRankAndTrafficStats',{siteUrl}), bingCall('GetQueryStats',{siteUrl}), bingCall('GetCrawlStats',{siteUrl})
    ]);
    const siteInfo=(Array.isArray(sites)?sites:[]).find((s)=>String(s.Url||s.SiteUrl||'').replace(/\/$/,'')===siteUrl.replace(/\/$/,''));
    write('bing',{provider:'bing',status:'ok',checkedAt:now.toISOString(),siteUrl,site:siteInfo||null,metrics:{rankAndTraffic:Array.isArray(rank)?rank.slice(-90):rank,crawl:Array.isArray(crawl)?crawl.slice(-90):crawl},topQueries:Array.isArray(queries)?queries.slice(0,30):queries,message:'Bing Webmaster API connected and refreshed.'});
  } catch (err) { write('bing',{provider:'bing',status:'warning',checkedAt:now.toISOString(),siteUrl,message:err.message}); }
}
async function refreshLive() {
  const routes=['/','/therapy/','/coaching/','/groups/','/corporate-speaking/','/about/','/resources/','/sitemap.xml','/robots.txt','/agency/'];
  const checks=[];
  for(const route of routes){
    const started=Date.now();
    try { const res=await fetch(site+route,{redirect:'follow',signal:AbortSignal.timeout(15000)}); checks.push({route,status:res.status,ok:res.ok,ms:Date.now()-started,contentType:res.headers.get('content-type')||''}); }
    catch(err){ checks.push({route,status:0,ok:false,ms:Date.now()-started,error:err.message}); }
  }
  const failures=checks.filter((x)=>!x.ok);
  const environmentUnavailable = failures.length === checks.length && failures.every((x) => x.status === 0 && /fetch failed/i.test(x.error || ''));
  const status = environmentUnavailable ? 'environment_unavailable' : failures.length ? 'warning' : 'ok';
  const message = environmentUnavailable
    ? 'This execution environment could not reach the public internet. The scheduled GitHub monitor will retry without treating this as a site failure.'
    : failures.length ? `${failures.length} live check(s) need attention.` : 'All monitored live routes returned successful responses.';
  write('live',{provider:'live',status,checkedAt:now.toISOString(),siteUrl:site,checks,summary:{checked:checks.length,passed:checks.length-failures.length,failed:failures.length},message});
}
(async()=>{ await Promise.all([refreshGsc(),refreshBing(),refreshLive()]); console.log('Agency monitoring snapshots refreshed (warnings never block).'); })().catch((err)=>{ console.error(`AGENCY MONITOR WARNING: ${err.stack||err.message}`); process.exitCode=0; });
