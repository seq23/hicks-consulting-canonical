const fs = require('fs');
const path = require('path');
const root = process.cwd();
const plan = JSON.parse(fs.readFileSync(path.join(root, 'data', 'system', 'content_plan_2026.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'admin', 'content_manifest.json'), 'utf8'));
const counts = manifest.reduce((acc, item) => { acc[item.type] = (acc[item.type] || 0) + 1; return acc; }, {});
const expected = {
  daily: plan.weekly.reduce((n, week) => n + (week.dailyAngles || []).length, 0),
  weekly: plan.weekly.length,
  monthly: plan.monthly.length,
  quarterly: plan.quarterly.length
};
for (const [type, n] of Object.entries(expected)) {
  if ((counts[type] || 0) < n) {
    console.error(`CONTENT PLAN FAIL: ${type} manifest count ${counts[type] || 0} < expected ${n}`);
    process.exit(1);
  }
}
const lastPublish = manifest.map(i => i.publishAt).filter(Boolean).sort().at(-1) || '';
if (lastPublish < '2026-12-31') {
  console.error(`CONTENT PLAN FAIL: latest publishAt ${lastPublish} does not reach 2026-12-31`);
  process.exit(1);
}
console.log(`2026 content plan loaded: daily=${counts.daily}, weekly=${counts.weekly}, monthly=${counts.monthly}, quarterly=${counts.quarterly}. Latest publishAt=${lastPublish}`);
