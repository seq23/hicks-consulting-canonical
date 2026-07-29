#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';

function sha(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }
function canonicalHash(obj, mutableFields){
  const clean={};
  for(const [k,v] of Object.entries(obj)) if(!mutableFields.has(k)) clean[k]=v;
  return sha(Buffer.from(JSON.stringify(clean,Object.keys(clean).sort())));
}
function nativePublicationTransitionVariants(obj){
  const variants=[obj];
  if(obj && obj.status === 'published' && !Object.prototype.hasOwnProperty.call(obj,'previewPath') && obj.publicPath){
    const reconstructed={...obj,previewPath:`/preview${String(obj.publicPath).startsWith('/') ? obj.publicPath : `/${obj.publicPath}`}`};
    variants.push(reconstructed);
  }
  return variants;
}
const manifest=JSON.parse(fs.readFileSync('data/protected_core/protected_editorial_core.json','utf8'));
const state=JSON.parse(fs.readFileSync('data/protected_core/protected_editorial_state.json','utf8'));
const errors=[];
for(const x of manifest.files){
  if(!fs.existsSync(x.path)){ errors.push(`missing:${x.path}`); continue; }
  const h=sha(fs.readFileSync(x.path));
  if(h!==x.sha256) errors.push(`drift:${x.path}`);
}
const current=JSON.parse(fs.readFileSync('data/admin/content_manifest.json','utf8'));
const byId=new Map(current.map(x=>[x.id,x]));
const mutable=new Set(state.mutable_fields||[]);
for(const rec of state.records||[]){
  const item=byId.get(rec.id);
  if(!item){ errors.push(`missing-baseline-editorial-record:${rec.id}`); continue; }
  const hashes=nativePublicationTransitionVariants(item).map(x=>canonicalHash(x,mutable));
  if(!hashes.includes(rec.sha256)) errors.push(`baseline-editorial-identity-drift:${rec.id}`);
}
console.log(JSON.stringify({ok:!errors.length,repo:manifest.repo,protected_files:manifest.files.length,baseline_editorial_records:state.baseline_count,current_editorial_records:current.length,policy:manifest.policy,state_policy:state.policy,errors},null,2));
if(errors.length) process.exit(1);
