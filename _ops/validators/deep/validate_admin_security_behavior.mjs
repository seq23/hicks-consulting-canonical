#!/usr/bin/env node
import fs from 'node:fs';
import { handleAdminRequest, ADMIN_PASSWORD_HASH } from '../../../worker/admin_runtime.mjs';
import { emitFinding } from '../../validation/protocol.js';
const errors=[];
const expected='c7ef3319e6cf6aab9035156df95f18dfec2ba2178f733940eda688758805708b';
if(ADMIN_PASSWORD_HASH!==expected)errors.push('runtime-password-hash-mismatch');
const gate=fs.readFileSync('assets/js/shared-admin-gate.js','utf8');
for(const token of [expected,'hc_admin_password_hash_v1','x-admin-password-hash','window.HicksAdminGate'])if(!gate.includes(token))errors.push(`shared-gate-missing:${token}`);
for(const page of ['pages/admin/index.html','pages/agency/index.html','pages/admin/digitalproducts/index.html']){const html=fs.readFileSync(page,'utf8');if(!html.includes('/assets/js/shared-admin-gate.js'))errors.push(`page-missing-shared-gate:${page}`);}
const runtime=fs.readFileSync('worker/admin_runtime.mjs','utf8');
for(const forbidden of ['ADMIN_SESSION_SECRET','verifyAdminSession','verifyAdminCsrf','x-csrf-token','rateLimitLogin','HttpOnly','SameSite=Strict'])if(runtime.includes(forbidden))errors.push(`stale-server-auth:${forbidden}`);

const adminPage=fs.readFileSync('pages/admin/index.html','utf8');
for(const token of ['Alternative: Real operations','GitHub connection','Create restricted token','Test GitHub connection','Every action is allowlisted and returns a receipt'])if(!adminPage.includes(token))errors.push(`admin-operations-guidance-missing:${token}`);
const agencyPage=fs.readFileSync('pages/agency/index.html','utf8');
for(const token of ['Connect Google Search Console and Bing Webmaster Tools','Run GSC + Bing connection test','GSC_SITE_URL','BING_WEBMASTER_API_KEY'])if(!agencyPage.includes(token))errors.push(`agency-connection-guidance-missing:${token}`);
const operations=fs.readFileSync('assets/js/admin-operations.js','utf8');
for(const token of ['SETUP_REQUIRED','Connection required','Operation accepted','HicksAdminOperations'])if(!operations.includes(token))errors.push(`admin-operations-client-missing:${token}`);
for(const source of [adminPage,agencyPage,operations])if(source.includes('Action failed'))errors.push('stale-action-failed-copy');

const fixtures={'/data/autonomy/state.json':{runtimeMode:'FULL_SAFE_AUTONOMY',paused:false},'/data/autonomy/queue.json':{items:[]},'/data/autonomy/exceptions.json':{items:[]},'/data/admin/content_manifest.json':[],'/data/agency/dashboard.json':{},'/data/search/free_wins.json':{items:[]},'/data/search/competitor_observations.json':{observations:[]},'/data/autonomy/notification_queue.json':{items:[]},'/data/system/publishing_velocity_contract.json':{},'/data/system/provider_capabilities.json':{},'/data/autonomy/self_heal_state.json':{}};
const env={ASSETS:{fetch:async(req)=>{const p=new URL(req.url).pathname;return fixtures[p]?new Response(JSON.stringify(fixtures[p]),{status:200}):new Response('not found',{status:404});}}};
const url=(path)=>new URL(`https://example.com${path}`);
let response=await handleAdminRequest(new Request('https://example.com/api/admin/status'),env,url('/api/admin/status'));if(response.status!==401)errors.push(`missing-hash-status:${response.status}`);
response=await handleAdminRequest(new Request('https://example.com/api/admin/status',{headers:{'x-admin-password-hash':'wrong'}}),env,url('/api/admin/status'));if(response.status!==401)errors.push(`wrong-hash-status:${response.status}`);
response=await handleAdminRequest(new Request('https://example.com/api/admin/status',{headers:{'x-admin-password-hash':expected}}),env,url('/api/admin/status'));if(response.status!==200)errors.push(`correct-hash-status:${response.status}`);
const body=await response.text();if(body.includes('GITHUB_ADMIN_TOKEN')||body.includes('ADMIN_PASSWORD_HASH'))errors.push('provider-secret-leak');
response=await handleAdminRequest(new Request('https://example.com/api/admin/action',{method:'POST',headers:{'x-admin-password-hash':expected,'content-type':'application/json'},body:JSON.stringify({action:'test-github-admin'})}),env,url('/api/admin/action'));
if(response.status!==409)errors.push(`github-setup-status:${response.status}`);
const setupBody=await response.json();
if(setupBody.status!=='SETUP_REQUIRED')errors.push(`github-setup-state:${setupBody.status}`);
if(setupBody.message?.includes('provider is not configured'))errors.push('stale-provider-not-configured-error');
response=await handleAdminRequest(new Request('https://example.com/api/admin/status',{headers:{'x-admin-password-hash':expected}}),env,url('/api/admin/status'));
const statusBody=await response.json();
if(statusBody.connections?.githubAdmin?.state!=='CONNECTION_REQUIRED')errors.push(`github-status-state:${statusBody.connections?.githubAdmin?.state}`);

if(errors.length){emitFinding(errors);process.exit(1);}console.log('Shared lightweight admin/agency gate behavior OK (exact blackgirlmagic hash, common gate across all admin surfaces, simple hash-header compatibility, and no stale signed-session/CSRF layer).');
