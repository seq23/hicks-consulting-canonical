const {spawnSync}=require('child_process');
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const { fail }=require('../../validation/protocol');
function hashTree(root){const rows=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name);const st=fs.statSync(p);if(st.isDirectory())walk(p);else rows.push(`${path.relative(root,p)}:${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`);}}walk(root);return crypto.createHash('sha256').update(rows.join('\n')).digest('hex');}
function build(){const r=spawnSync('node',['scripts/site_build.js'],{encoding:'utf8'});if(r.status!==0)fail(`build-failed:${r.stderr||r.stdout}`);return hashTree('dist');}
const first=build();const second=build();if(first!==second)fail(`clean-build-parity:${first}:${second}`);console.log(`Deterministic build OK (${first}; two isolated consecutive builds produced identical dist trees).`);
