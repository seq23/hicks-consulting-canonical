// Guard for the copy-cat insight canonicals (owner approval 3 Nov 2026;
// scripts/publishing/canonicalize_copy_insights.mjs, list in data/editorial/canonical_to_parent.json).
// Every listed insight stays live, names its parent article as canonical, the parent is itself a
// published page that names itself, and the insight is absent from sitemap.xml.
// Hard-fails on an empty list (rule 0).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const errors = [];
const ORIGIN = 'https://www.hicksconsulting.org';
const file = (route) => path.join(ROOT, 'pages', route.replace(/^\/+|\/+$/g, ''), 'index.html');
const canonicalOf = (html) => ((html.match(/<link\b[^>]*rel="canonical"[^>]*>/i) || [''])[0].match(/href="([^"]+)"/) || [])[1];
const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/editorial/canonical_to_parent.json'), 'utf8')).items || [];
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/admin/content_manifest.json'), 'utf8'));
const published = new Set(manifest.filter((x) => x.status === 'published').map((x) => x.publicPath || x.slug));
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
if (!list.length) errors.push('examined-no-items -- the canonical list is empty, so this check proves nothing');
for (const { route, parent } of list) {
  if (!published.has(route)) errors.push(`${route} is not published: it must stay live for readers`);
  if (!published.has(parent)) errors.push(`${route}: parent ${parent} is not a published page`);
  if (!fs.existsSync(file(route)) || canonicalOf(fs.readFileSync(file(route), 'utf8')) !== `${ORIGIN}${parent}`) errors.push(`${route}: canonical does not name its parent ${parent}`);
  if (fs.existsSync(file(parent)) && canonicalOf(fs.readFileSync(file(parent), 'utf8')) !== `${ORIGIN}${parent}`) errors.push(`${parent}: the parent does not name itself as canonical`);
  if (sitemap.includes(`<loc>${ORIGIN}${route}</loc>`)) errors.push(`${route} is in sitemap.xml while its canonical names another page`);
}
if (errors.length) {
  console.log('VALIDATION_FINDING check=copy-insight-canonicals');
  console.error(`HARD FAIL  copy-insight-canonicals (${errors.length})`);
  for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`Copy-insight canonicals OK (${list.length} insights name their parent article and are out of the sitemap).`);
