#!/usr/bin/env node
// The only way an item becomes publishable on hicksconsulting.org.
//
// It requires a named human. There is deliberately no --all, no --by-filter, no
// --auto and no environment-variable fallback for the approver: every convenience
// of that kind is a way for a scheduled job to approve on a person's behalf, which
// is the exact failure this closes. One id, one name, one line in the record.
//
// Usage:
//   node scripts/admin/approve_publication.mjs --id <manifest id> --by "<person>" [--note "<why>"]
//   node scripts/admin/approve_publication.mjs --list
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const APPROVALS = path.join(root, 'data/admin/publication_approvals.json');
const MANIFEST = path.join(root, 'data/admin/content_manifest.json');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const doc = JSON.parse(fs.readFileSync(APPROVALS, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

if (args.includes('--list')) {
  const approved = new Set(doc.approvals.map((a) => a.id));
  const due = manifest.filter((i) => i.status === 'approved' && i.validationPassed === true && i.scheduledAt);
  console.log(`${doc.approvals.length} approval(s) on record.`);
  console.log(`${due.filter((i) => !approved.has(i.id)).length} validated item(s) awaiting a human decision:`);
  for (const item of due.filter((i) => !approved.has(i.id)).slice(0, 40)) {
    console.log(`  ${item.id}  ${String(item.scheduledAt).slice(0, 10)}  ${item.slug}`);
  }
  process.exit(0);
}

const id = flag('id');
const by = flag('by');
if (!id || !by || !by.trim()) {
  console.error('Both --id and --by are required. --by must name the person approving; it is a record of who decided, not a formality.');
  console.error('  node scripts/admin/approve_publication.mjs --id <manifest id> --by "<person>" [--note "<why>"]');
  process.exit(1);
}
if (/^(ci|bot|automation|github-actions|system|auto)$/i.test(by.trim())) {
  console.error(`--by "${by}" names an automation, not a person. This gate exists precisely to stop a machine approving its own output.`);
  process.exit(1);
}

const item = manifest.find((i) => i.id === id);
if (!item) { console.error(`No manifest item with id "${id}" in data/admin/content_manifest.json.`); process.exit(1); }
if (item.status === 'published') { console.error(`"${id}" is already published; approving it again would do nothing.`); process.exit(1); }
if (doc.approvals.some((a) => a.id === id)) { console.error(`"${id}" is already approved by ${doc.approvals.find((a) => a.id === id).approvedBy}.`); process.exit(1); }

doc.approvals.push({
  id,
  route: item.slug,
  title: item.title,
  approvedBy: by.trim(),
  approvedAt: new Date().toISOString(),
  note: flag('note') || null,
});
fs.writeFileSync(APPROVALS, JSON.stringify(doc, null, 2) + '\n');
console.log(`Approved ${id} (${item.slug}) for release, by ${by.trim()}.`);
console.log('It publishes on the next Content Publish run at or after its scheduledAt.');
