#!/usr/bin/env node
import fs from 'node:fs';
const report=JSON.parse(fs.readFileSync('data/continuity/editorial_continuity_report.json','utf8'));
const briefs=JSON.parse(fs.readFileSync('data/intake/content_brief_candidates.json','utf8'));
const queue=JSON.parse(fs.readFileSync('data/social/publish_queue.json','utf8'));
const errors=[];
if(report.horizon_days<90||report.horizon_days>180) errors.push('horizon');
if(report.publication_authority!=='EXISTING_HICKS_ADMIN_APPROVAL_FLOW') errors.push('authority');
if(Number(report.candidates_added||0)<0) errors.push('count');
const briefIds=(briefs.candidates||[]).map(x=>x.id).filter(Boolean);
const queueIds=(queue.items||[]).map(x=>x.id).filter(Boolean);
if(new Set(briefIds).size!==briefIds.length) errors.push('duplicate-brief-ids');
if(new Set(queueIds).size!==queueIds.length) errors.push('duplicate-queue-ids');
const briefSet=new Set(briefIds);
const continuityQueue=(queue.items||[]).filter(x=>x?.continuity_generated===true||String(x?.id||'').startsWith('continuity-'));
for(const x of continuityQueue){
  if(!briefSet.has(x.id)) errors.push(`continuity-not-admin-visible:${x.id}`);
  if(!['queued_for_owner_approval','approved_for_drafting','needs_revision'].includes(x.approvalStatus||x.status)) errors.push(`invalid-continuity-status:${x.id}`);
  if(x.publicOnlyAfterApproval!==true) errors.push(`approval-gate-missing:${x.id}`);
  if(!x.proposedScheduledAt || x.proposedScheduledAt.slice(0,10)<='2027-01-01') errors.push(`invalid-future-slot:${x.id}`);
  if(!['daily','weekly','monthly','quarterly'].includes(x.cadence)) errors.push(`invalid-cadence:${x.id}`);
}
console.log(JSON.stringify({ok:!errors.length,...report,continuity_candidates:continuityQueue.length,errors},null,2));
if(errors.length) process.exit(1);
