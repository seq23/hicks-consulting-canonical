const fs=require('fs');
const crypto=require('crypto');
const { fail }=require('../../validation/protocol');
const contract=JSON.parse(fs.readFileSync('data/system/publishing_velocity_contract.json','utf8'));
const preserved=JSON.parse(fs.readFileSync('data/system/source_preservation_manifest.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('data/admin/content_manifest.json','utf8'));
const errors=[];
if(contract.authority!=='IMMUTABLE_EXISTING_CLIENT_SYSTEM') errors.push('velocity-authority');
const expected={daily:['insights','5 business-day reflections per week'],weekly:['articles','1 substantial article per week'],monthly:['guides','1 pillar piece per month'],quarterly:['white-papers','1 flagship guide per quarter']};
for(const [key,[type,description]] of Object.entries(expected)){ const row=contract.editorialReleaseVelocity?.[key]; if(row?.contentType!==type||row?.description!==description) errors.push(`cadence-drift:${key}`); }
if(contract.lockedRecordCount!==227||preserved.contentManifest.records!==227) errors.push('locked-record-count');
const current=new Map(manifest.map(x=>[x.id,x]));
for(const base of preserved.contentManifest.items){ const item=current.get(base.id); if(!item){errors.push(`missing-baseline:${base.id}`);continue;} if(item.slug!==base.slug)errors.push(`slug-drift:${base.id}`); if(item.scheduledAt!==base.scheduledAt)errors.push(`date-drift:${base.id}`); }
const baselineIds=new Set(preserved.contentManifest.items.map(x=>x.id)); const occupied=new Set(manifest.filter(x=>baselineIds.has(x.id)&&x.scheduledAt).map(x=>`${x.contentType||x.type}|${x.scheduledAt}`)); const newSlots=new Set();
for(const item of manifest.filter(x=>!baselineIds.has(x.id))){ if(!item.scheduledAt)continue; const key=`${item.contentType||item.type}|${item.scheduledAt}`; if(occupied.has(key)||newSlots.has(key))errors.push(`new-item-slot-collision:${key}:${item.id}`); newSlots.add(key); }
if(errors.length) fail(errors.slice(0,60));
console.log(`Publishing velocity immutability OK (${preserved.contentManifest.items.length} baseline items retain route/date identity; cadence contract unchanged; no duplicate type/date slots).`);
