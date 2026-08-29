const fs=require('fs');
const { fail }=require('../../validation/protocol');
const runtime=JSON.parse(fs.readFileSync('data/system/runtime_contract.json','utf8'));
const state=JSON.parse(fs.readFileSync('data/autonomy/state.json','utf8'));
const queue=JSON.parse(fs.readFileSync('data/autonomy/queue.json','utf8'));
const ownership=JSON.parse(fs.readFileSync('data/system/ownership_manifest.json','utf8'));
const errors=[];
if(runtime.runtimeMode!=='FULL_SAFE_AUTONOMY'||state.runtimeMode!=='FULL_SAFE_AUTONOMY')errors.push('runtime-mode');
if(runtime.routineApprovalRequired!==true)errors.push('routine-approval-not-required');
if(runtime.exceptionBehavior!=='skip_record_continue')errors.push('exception-behavior');
if(!Array.isArray(ownership.protectedFacts)||ownership.protectedFacts.length<8)errors.push('protected-facts');
const allowed=new Set(['DISCOVERED','SCORED','ADMITTED','DRAFTING','DRAFTED','VALIDATING','REPAIRING','VALIDATED_SAFE','SCHEDULED','PUBLISHED','DISTRIBUTED','MEASURED','FAILED_RETRYABLE','SKIPPED_DUPLICATE_INTENT','SKIPPED_UNSUPPORTED_CLAIM','SKIPPED_PROTECTED_OWNER','SKIPPED_PROHIBITED_ACTION','SYSTEM_BLOCKED']);
for(const item of queue.items||[]){ const s=item.state||item.autonomyStatus||item.status; if(!allowed.has(s))errors.push(`invalid-state:${item.id}:${s}`); if(item.routineApprovalRequired!==true||item.publicOnlyAfterApproval!==true)errors.push(`approval-gate-missing:${item.id}`); }
for(const file of ['scripts/autonomy/run_cycle.mjs','scripts/publishing/run_safe_publish.mjs','scripts/autonomy/run_post_publish_email.mjs','.github/workflows/autonomy-cycle.yml','.github/workflows/autonomy-self-heal.yml']) if(!fs.existsSync(file))errors.push(`missing:${file}`);
// The release boundary is asserted against the gate itself, not against prose on a
// client-facing page. This previously required pages/admin/index.html to contain the
// sentence "Routine client approval is not required" - which became FALSE when the
// human gate landed on 2026-08-27, so a validator was compelling a client's own site to
// state something untrue about her control over her content. It also forced internal
// vocabulary onto a page written for a non-technical reader.
if(!fs.existsSync('data/admin/publication_approvals.json'))errors.push('missing-approval-record');
if(!fs.existsSync('scripts/admin/approve_publication.mjs'))errors.push('missing-approval-mechanism');
if(errors.length)fail(errors);
console.log(`Full Safe Autonomy contract OK (${(queue.items||[]).length} candidates; human release gate REQUIRED and present; protected-fact and skip-record-continue boundaries present).`);
