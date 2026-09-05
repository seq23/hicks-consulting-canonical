#!/usr/bin/env node
import protocolModule from '../../_ops/validation/protocol.js';
const { emitFinding } = protocolModule;
import fs from 'node:fs';
const errors = [];
const required = [
  '.build/authority_distribution/indexnow-batch.txt',
  '.build/authority_distribution/distribution-manifest.json',
  '.github/workflows/indexnow-submit.yml',
  'scripts/distribution/run_post_publish_distribution.mjs'
];
for (const file of required) if (!fs.existsSync(file)) errors.push(`missing:${file}`);
const manifest = JSON.parse(fs.readFileSync('.build/authority_distribution/distribution-manifest.json', 'utf8'));
const batch = fs.readFileSync('.build/authority_distribution/indexnow-batch.txt', 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const workflow = fs.readFileSync('.github/workflows/indexnow-submit.yml', 'utf8');
const runner = fs.readFileSync('scripts/distribution/run_post_publish_distribution.mjs', 'utf8');
if (manifest.provider_success_claimed !== false) errors.push('provider-truth');
if (manifest.url_count !== batch.length) errors.push(`count:${manifest.url_count}/${batch.length}`);
if (!workflow.includes('workflow_run:') || !workflow.includes('workflows: ["Content Publish"]')) errors.push('workflow-not-post-publish');
if (!workflow.includes("github.event.workflow_run.conclusion == 'success'")) errors.push('workflow-success-gate');
for (const command of ['npm run build','npm run indexnow:emit','npm run distribution:post-publish','npm run validate:authority-modernization']) if (!workflow.includes(command)) errors.push(`workflow-command:${command}`);
if (!workflow.includes('git add data/distribution')) errors.push('workflow-durable-commit');
for (const token of ['api.indexnow.org/indexnow','webmasters/v3/sites/','searchconsole.googleapis.com/v1/urlInspection/index:inspect','data/distribution/provider_receipt.json','data/distribution/receipts/','data/distribution/observation_feedback.json']) if (!runner.includes(token)) errors.push(`runner:${token}`);
if (fs.existsSync('data/distribution/provider_receipt.json')) {
  const receipt = JSON.parse(fs.readFileSync('data/distribution/provider_receipt.json', 'utf8'));
  if (receipt.verified_external_citations_delta !== 0) errors.push('receipt-citation-truth');
  if (receipt.provider_success_claimed === true && !['SUCCESS'].includes(receipt.indexnow?.status) && !['SUCCESS'].includes(receipt.gsc_sitemap_submission?.status) && !['SUCCESS'].includes(receipt.priority_url_inspection?.status)) errors.push('receipt-provider-truth');
}
console.log(JSON.stringify({ ok: !errors.length, url_count: batch.length, provider_success_claimed: manifest.provider_success_claimed, errors }, null, 2));
if (errors.length) { emitFinding(errors.map((e)=>`- ${e}`), { summary: `distribution-manifest-error(s)=${errors.length}` }); process.exit(1); }
