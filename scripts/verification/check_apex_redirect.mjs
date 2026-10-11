#!/usr/bin/env node
// Live proof that the apex folds into www (11 Oct 2026). Run after a deploy:
//   node scripts/verification/check_apex_redirect.mjs
// For each path: HEAD https://hicksconsulting.org<path> must answer 301 with
// location https://www.hicksconsulting.org<path>, query preserved, and the www
// URL must answer 200 itself. Exits 1 on any miss. APEX_CHECK_WAIT_SECONDS
// (default 0) retries every 15 s while a fresh deploy propagates.
const WWW = 'https://www.hicksconsulting.org';
const paths = (process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/black-therapist-memphis/', '/therapy/?ref=apex-check', '/sitemap.xml']);
async function check() {
  const misses = [];
  for (const p of paths) {
    const apex = `https://hicksconsulting.org${p}`;
    const res = await fetch(apex, { method: 'HEAD', redirect: 'manual' });
    const loc = res.headers.get('location');
    const ok = res.status === 301 && loc === `${WWW}${p}`;
    console.log(`${ok ? 'OK  ' : 'MISS'} ${apex} -> ${res.status} ${loc || ''}`);
    if (!ok) misses.push(apex);
    const www = await fetch(`${WWW}${p}`, { method: 'HEAD', redirect: 'manual' });
    if (www.status !== 200) { console.log(`MISS ${WWW}${p} -> ${www.status}`); misses.push(`${WWW}${p}`); }
  }
  return misses;
}
const deadline = Date.now() + Number(process.env.APEX_CHECK_WAIT_SECONDS || 0) * 1000;
let misses = await check();
while (misses.length && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 15000));
  misses = await check();
}
if (misses.length) { console.error(`apex redirect: ${misses.length} miss(es)`); process.exit(1); }
console.log(`apex redirect: ${paths.length} path(s) 301 to www with path and query preserved`);
