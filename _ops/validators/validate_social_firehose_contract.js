const fs = require('fs');
const { warn: reportFindings } = require('../validation/protocol');
const warnings = [];
function finding(message) { warnings.push(`SOCIAL FIREHOSE CONTRACT WARNING: ${message}`); }
function readJson(file) {
  if (!fs.existsSync(file)) {
    finding(`${file} missing.`);
    return null;
  }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { finding(`${file} is invalid JSON: ${error.message}`); return null; }
}
const policy = readJson('config/social_ingestion_policy.json');
const required = ['max_items_per_source_per_run', 'max_clusters_per_run', 'max_pages_generated_per_run', 'max_pages_published_per_day', 'require_cluster_score_minimum', 'dedupe_before_publish', 'publish_mode'];
if (policy) {
  for (const key of required) if (!(key in policy)) finding(`Policy missing ${key}`);
  if (policy.max_items_per_source_per_run > 25) finding('max_items_per_source_per_run must be <= 25.');
  if (policy.max_pages_generated_per_run > 5) finding('max_pages_generated_per_run must be <= 5.');
  if (policy.publish_mode !== 'queued') finding('publish_mode must be queued.');
}
const queue = readJson('data/social/publish_queue.json');
if (queue && !Array.isArray(queue.items)) finding('publish_queue.items must be array.');
if (warnings.length) reportFindings(warnings, `${warnings.length}-social-firehose-warning(s)`);
else console.log('Social firehose contract OK');
process.exit(0);
