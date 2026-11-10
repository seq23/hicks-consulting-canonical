// validate:velocity-immutability (restored 10 Nov 2026, hostile review: identity only; the cadence
// wording pins are dropped). The 227 baseline records in data/system/source_preservation_manifest.json
// keep their slug and scheduledAt in data/admin/content_manifest.json, and no new item takes a
// type/date slot a baseline or another new item already holds.
const fs=require('fs');
const { fail }=require('../../validation/protocol');
const preserved=JSON.parse(fs.readFileSync('data/system/source_preservation_manifest.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('data/admin/content_manifest.json','utf8'));
const errors=[];
const baseline=preserved.contentManifest.items||[];
if(baseline.length!==227||preserved.contentManifest.records!==227) errors.push(`locked-record-count:${baseline.length}`);
const current=new Map(manifest.map(x=>[x.id,x]));
for(const base of baseline){ const item=current.get(base.id); if(!item){errors.push(`missing-baseline:${base.id}`);continue;} if(item.slug!==base.slug)errors.push(`slug-drift:${base.id}`); if(item.scheduledAt!==base.scheduledAt)errors.push(`date-drift:${base.id}`); }
const baselineIds=new Set(baseline.map(x=>x.id)); const occupied=new Set(manifest.filter(x=>baselineIds.has(x.id)&&x.scheduledAt).map(x=>`${x.contentType||x.type}|${x.scheduledAt}`)); const newSlots=new Set();
for(const item of manifest.filter(x=>!baselineIds.has(x.id))){ if(!item.scheduledAt)continue; const key=`${item.contentType||item.type}|${item.scheduledAt}`; if(occupied.has(key)||newSlots.has(key))errors.push(`new-item-slot-collision:${key}:${item.id}`); newSlots.add(key); }
if(errors.length) fail(errors.slice(0,60));
console.log(`Publishing velocity immutability OK (${baseline.length} baseline items keep slug and scheduledAt; no new type/date slot collisions).`);
