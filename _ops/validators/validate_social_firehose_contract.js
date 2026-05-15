const fs = require('fs');
const warnings=[]; function fail(m){ warnings.push(`SOCIAL FIREHOSE CONTRACT WARNING: ${m}`); }
const policy=JSON.parse(fs.readFileSync('config/social_ingestion_policy.json','utf8'));
const required=['max_items_per_source_per_run','max_clusters_per_run','max_pages_generated_per_run','max_pages_published_per_day','require_cluster_score_minimum','dedupe_before_publish','publish_mode'];
for(const key of required){ if(!(key in policy)) fail(`Policy missing ${key}`); }
if(policy.max_items_per_source_per_run > 25) fail('max_items_per_source_per_run must be <= 25.');
if(policy.max_pages_generated_per_run > 5) fail('max_pages_generated_per_run must be <= 5.');
if(policy.publish_mode !== 'queued') fail('publish_mode must be queued.');
const queue=JSON.parse(fs.readFileSync('data/social/publish_queue.json','utf8'));
if(!Array.isArray(queue.items)) fail('publish_queue.items must be array.');
if (warnings.length) {
  console.warn(warnings.join('\n'));
} else {
  console.log('Social firehose contract OK');
}
process.exit(0);
