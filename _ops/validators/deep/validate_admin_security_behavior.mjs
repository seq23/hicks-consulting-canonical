#!/usr/bin/env node
// Admin auth behaviour, where it lives (worker/admin_runtime.mjs):
//   - a client-sent password hash is never accepted (the old leak: the hash was the credential);
//   - the typed password signs in (legacy SHA-256 secret and PBKDF2 secret);
//   - ADMIN_LOCKOUT_MAX_FAILURES wrong passwords from one IP lock it out, other IPs unaffected;
//   - a missing secret is a NAMED STOP (503 ADMIN_AUTH_SECRET_MISSING), never open;
//   - no password hash is hard-coded in the runtime or any admin script.
// Test-only password and secrets below; the real ones are Cloudflare Pages secrets.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { handleAdminRequest, requireAdminSession, ADMIN_LOCKOUT_MAX_FAILURES } from '../../../worker/admin_runtime.mjs';
import { emitFinding } from '../../validation/protocol.js';
const errors=[];
const gate=fs.readFileSync('assets/js/shared-admin-gate.js','utf8');
for(const token of ['window.HicksAdminGate','/api/admin/login','x-admin-session'])if(!gate.includes(token))errors.push(`shared-gate-missing:${token}`);
for(const page of ['pages/admin/index.html','pages/agency/index.html','pages/admin/digitalproducts/index.html']){const html=fs.readFileSync(page,'utf8');if(!html.includes('/assets/js/shared-admin-gate.js'))errors.push(`page-missing-shared-gate:${page}`);}
const authSources=['worker/admin_runtime.mjs','worker/_worker.js','functions/api/content/_shared.js','functions/api/digital-products/_shared.js','assets/js/shared-admin-gate.js','assets/js/admin.js','assets/js/admin-digital-products.js','assets/js/admin-operations.js','assets/js/agency-dashboard.js'];
let scanned=0;
for(const file of authSources){const src=fs.readFileSync(file,'utf8');scanned+=1;if(/['"`][0-9a-f]{64}['"`]/i.test(src))errors.push(`hard-coded-hash:${file}`);if(src.includes('x-admin-password-hash'))errors.push(`client-hash-header:${file}`);}
if(scanned!==authSources.length)errors.push('auth-source-scan-incomplete');
const config=JSON.parse(fs.readFileSync('data/system/config.json','utf8'));
if(config.admin&&'passwordHint' in config.admin)errors.push('config-password-hint-present');

const adminPage=fs.readFileSync('pages/admin/index.html','utf8');
for(const token of ['GitHub connection','Create restricted token','Test GitHub connection','Every action is allowlisted and returns a receipt'])if(!adminPage.includes(token))errors.push(`admin-operations-guidance-missing:${token}`);
// The operations controls must be reachable directly, not buried behind a disclosure
// heading. Assert the wiring, not the wording: prose on a client-facing page is not
// a contract, and requiring a specific heading blocked a client-requested redesign.
if(!adminPage.includes('/assets/js/admin-operations.js'))errors.push('admin-operations-script-not-loaded');
if(/<details[^>]*>(?:(?!<\/details>)[\s\S])*admin-operations\.js/.test(adminPage))errors.push('admin-operations-hidden-in-disclosure');
const agencyPage=fs.readFileSync('pages/agency/index.html','utf8');
for(const token of ['Connect Google Search Console and Bing Webmaster Tools','Run GSC + Bing connection test','GSC_SITE_URL','BING_WEBMASTER_API_KEY'])if(!agencyPage.includes(token))errors.push(`agency-connection-guidance-missing:${token}`);
const operations=fs.readFileSync('assets/js/admin-operations.js','utf8');
for(const token of ['SETUP_REQUIRED','Connection required','Operation accepted','HicksAdminOperations'])if(!operations.includes(token))errors.push(`admin-operations-client-missing:${token}`);
for(const source of [adminPage,agencyPage,operations])if(source.includes('Action failed'))errors.push('stale-action-failed-copy');

const fixtures={'/data/autonomy/state.json':{runtimeMode:'FULL_SAFE_AUTONOMY',paused:false},'/data/autonomy/queue.json':{items:[]},'/data/autonomy/exceptions.json':{items:[]},'/data/admin/content_manifest.json':[],'/data/agency/dashboard.json':{},'/data/search/free_wins.json':{items:[]},'/data/search/competitor_observations.json':{observations:[]},'/data/autonomy/notification_queue.json':{items:[]},'/data/system/publishing_velocity_contract.json':{},'/data/system/provider_capabilities.json':{},'/data/autonomy/self_heal_state.json':{}};
const ASSETS={fetch:async(req)=>{const p=new URL(req.url).pathname;return fixtures[p]?new Response(JSON.stringify(fixtures[p]),{status:200}):new Response('not found',{status:404});}};
function memoryKv(){const m=new Map();return{get:async(k,t)=>{const v=m.get(k);return v==null?null:(t==='json'?JSON.parse(v):v);},put:async(k,v)=>{m.set(k,v);},delete:async(k)=>{m.delete(k);}};}
const TEST_PASSWORD='test-only-password-not-real';
const legacyHash=crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');
const salt=crypto.randomBytes(16);
const pbkdf2Hash=`pbkdf2-sha256$100000$${salt.toString('base64')}$${crypto.pbkdf2Sync(TEST_PASSWORD,salt,100000,32,'sha256').toString('base64')}`;
const SESSION_SECRET=crypto.randomBytes(32).toString('hex');
const mkEnv=(hash)=>({ASSETS,DIGITAL_PRODUCTS_KV:memoryKv(),ADMIN_PASSWORD_HASH:hash,ADMIN_SESSION_SECRET:SESSION_SECRET});
const url=(path)=>new URL(`https://example.com${path}`);
const call=(env,path,init={})=>handleAdminRequest(new Request(`https://example.com${path}`,init),env,url(path));
const login=(env,password,ip='198.51.100.1')=>call(env,'/api/admin/login',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':ip},body:JSON.stringify({password})});

// 1. Missing secret: named stop, never open.
const realConsoleError=console.error;const namedStops=[];console.error=(...args)=>namedStops.push(args.join(' '));
for(const env of [{ASSETS},{ASSETS,ADMIN_PASSWORD_HASH:legacyHash},{ASSETS,ADMIN_SESSION_SECRET:SESSION_SECRET}]){
  let r=await call(env,'/api/admin/status',{headers:{'x-admin-password-hash':legacyHash}});const b=await r.json();
  if(r.status!==503||b.status!=='ADMIN_AUTH_SECRET_MISSING')errors.push(`missing-secret-status:${r.status}:${b.status}`);
  r=await login(env,TEST_PASSWORD);if(r.status!==503)errors.push(`missing-secret-login:${r.status}`);
}
console.error=realConsoleError;
if(!namedStops.length||!namedStops.every((line)=>line.startsWith('ADMIN_AUTH_SECRET_MISSING')))errors.push('missing-secret-not-logged-as-named-stop');
const env=mkEnv(legacyHash);
// 2. The stored hash sent by a client is not a credential.
let response=await call(env,'/api/admin/status');if(response.status!==401)errors.push(`no-credential-status:${response.status}`);
response=await call(env,'/api/admin/status',{headers:{'x-admin-password-hash':legacyHash}});if(response.status!==401)errors.push(`old-hash-header-status:${response.status}`);
response=await call(env,'/api/admin/action',{method:'POST',headers:{'x-admin-password-hash':legacyHash,'content-type':'application/json'},body:JSON.stringify({action:'pause'})});if(response.status!==401)errors.push(`old-hash-header-action:${response.status}`);
response=await call(env,'/api/admin/status',{headers:{'x-admin-session':legacyHash}});if(response.status!==401)errors.push(`hash-as-session-status:${response.status}`);
if(await requireAdminSession(new Request('https://example.com/api/content/approve',{method:'POST',headers:{'x-admin-password-hash':legacyHash}}),env)===null)errors.push('content-gate-accepts-old-hash');
response=await login(env,legacyHash);if(response.status!==401)errors.push(`hash-as-password-login:${response.status}`);
// 3. The password signs in; the token opens admin.
response=await login(env,TEST_PASSWORD,'198.51.100.2');const signed=await response.json();
if(response.status!==200||!signed.token)errors.push(`legacy-login-status:${response.status}`);
const sessionHeaders={'x-admin-session':signed.token||''};
response=await call(env,'/api/admin/status',{headers:sessionHeaders});if(response.status!==200)errors.push(`session-status:${response.status}`);
const body=await response.text();if(body.includes('GITHUB_ADMIN_TOKEN')||body.includes(legacyHash)||body.includes(SESSION_SECRET))errors.push('provider-secret-leak');
const tampered=(signed.token||'').replace(/.$/,(c)=>c==='A'?'B':'A');
response=await call(env,'/api/admin/status',{headers:{'x-admin-session':tampered}});if(response.status!==401)errors.push(`tampered-session-status:${response.status}`);
response=await call({...env,ADMIN_SESSION_SECRET:crypto.randomBytes(32).toString('hex')},'/api/admin/status',{headers:sessionHeaders});if(response.status!==401)errors.push(`rotated-secret-session-status:${response.status}`);
const expired=`v1.${Math.floor(Date.now()/1000)-10}.x.y`;
response=await call(env,'/api/admin/status',{headers:{'x-admin-session':expired}});if(response.status!==401)errors.push(`expired-session-status:${response.status}`);
response=await call(env,'/api/admin/action',{method:'POST',headers:{...sessionHeaders,'content-type':'application/json'},body:JSON.stringify({action:'test-github-admin'})});
if(response.status!==409)errors.push(`github-setup-status:${response.status}`);
const setupBody=await response.json();
if(setupBody.status!=='SETUP_REQUIRED')errors.push(`github-setup-state:${setupBody.status}`);
if(setupBody.message?.includes('provider is not configured'))errors.push('stale-provider-not-configured-error');
response=await call(env,'/api/admin/status',{headers:sessionHeaders});
const statusBody=await response.json();
if(statusBody.connections?.githubAdmin?.state!=='CONNECTION_REQUIRED')errors.push(`github-status-state:${statusBody.connections?.githubAdmin?.state}`);
// 4. PBKDF2 secret (after rotation).
const penv=mkEnv(pbkdf2Hash);
response=await login(penv,TEST_PASSWORD);if(response.status!==200)errors.push(`pbkdf2-login-status:${response.status}`);
response=await login(penv,'wrong-password',"203.0.113.9");if(response.status!==401)errors.push(`pbkdf2-wrong-status:${response.status}`);
// 5. Lockout: N failures from one IP lock it, even for the right password; another IP is unaffected.
const lenv=mkEnv(legacyHash);const statuses=[];
for(let i=0;i<ADMIN_LOCKOUT_MAX_FAILURES;i+=1){const r=await login(lenv,`wrong-${i}`,'192.0.2.7');statuses.push(r.status);const b=await r.json();if(/hash|secret|ADMIN_/i.test(b.error||''))errors.push('lockout-error-not-generic');}
if(statuses.slice(0,-1).some((s)=>s!==401)||statuses.at(-1)!==429)errors.push(`lockout-sequence:${statuses.join(',')}`);
response=await login(lenv,TEST_PASSWORD,'192.0.2.7');if(response.status!==429)errors.push(`locked-ip-correct-password:${response.status}`);
response=await login(lenv,TEST_PASSWORD,'192.0.2.8');if(response.status!==200)errors.push(`other-ip-login:${response.status}`);
if(ADMIN_LOCKOUT_MAX_FAILURES<1)errors.push('lockout-disabled');

if(errors.length){emitFinding(errors);process.exit(1);}console.log(`Admin auth behavior OK (${scanned} auth sources scanned; client-sent hash refused; password, PBKDF2, lockout after ${ADMIN_LOCKOUT_MAX_FAILURES}, and fail-closed missing secret proven).`);
