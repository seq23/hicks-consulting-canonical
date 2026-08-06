const fs=require('fs');
const { fail }=require('../../validation/protocol');
const runtime=JSON.parse(fs.readFileSync('data/system/runtime_contract.json','utf8'));
const state=JSON.parse(fs.readFileSync('data/autonomy/state.json','utf8'));
const queue=JSON.parse(fs.readFileSync('data/autonomy/queue.json','utf8'));
const ownership=JSON.parse(fs.readFileSync('data/system/ownership_manifest.json','utf8'));
const errors=[];
if(runtime.runtimeMode!=='FULL_SAFE_AUTONOMY'||state.runtimeMode!=='FULL_SAFE_AUTONOMY')errors.push('runtime-mode');
if(runtime.routineApprovalRequired!==false)errors.push('routine-approval-enabled');
if(runtime.exceptionBehavior!=='skip_record_continue')errors.push('exception-behavior');
if(!Array.isArray(ownership.protectedFacts)||ownership.protectedFacts.length<8)errors.push('protected-facts');
const allowed=new Set(['DISCOVERED','SCORED','ADMITTED','DRAFTING','DRAFTED','VALIDATING','REPAIRING','VALIDATED_SAFE','SCHEDULED','PUBLISHED','DISTRIBUTED','MEASURED','FAILED_RETRYABLE','SKIPPED_DUPLICATE_INTENT','SKIPPED_UNSUPPORTED_CLAIM','SKIPPED_PROTECTED_OWNER','SKIPPED_PROHIBITED_ACTION','SYSTEM_BLOCKED']);
for(const item of queue.items||[]){ const s=item.state||item.autonomyStatus||item.status; if(!allowed.has(s))errors.push(`invalid-state:${item.id}:${s}`); if(item.routineApprovalRequired!==false||item.publicOnlyAfterApproval!==false)errors.push(`approval-gate:${item.id}`); }
for(const file of ['scripts/autonomy/run_cycle.mjs','scripts/publishing/run_safe_publish.mjs','scripts/autonomy/run_post_publish_email.mjs','.github/workflows/autonomy-cycle.yml','.github/workflows/autonomy-self-heal.yml']) if(!fs.existsSync(file))errors.push(`missing:${file}`);
const admin=fs.readFileSync('pages/admin/index.html','utf8');
if(!/Routine client approval is not required/i.test(admin)||!/full safe autonomy/i.test(admin)||!/optional-operations-panel/i.test(admin)||!/generated-content-panel/i.test(admin))errors.push('admin-does-not-reflect-runtime');
if(errors.length)fail(errors);
console.log(`Full Safe Autonomy contract OK (${(queue.items||[]).length} migrated candidates; approval gate removed; protected-fact and skip-record-continue boundaries present).`);
