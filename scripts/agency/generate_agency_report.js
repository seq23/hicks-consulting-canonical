const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dist = path.join(root, 'dist');
const manifestPath = path.join(root, 'data', 'admin', 'content_manifest.json');
const agencyDir = path.join(root, 'data', 'agency');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&#8217;|&rsquo;/gi, '’').replace(/\s+/g, ' ').trim();
}
function get(html, regex) { const m = html.match(regex); return m ? String(m[1] ?? m[0] ?? '').trim() : ''; }
function words(text) { return (text.toLowerCase().match(/[a-z0-9’'-]+/g) || []).filter((w) => w.length > 2); }
function wordCount(text) { return words(text).length; }
function routeForFile(file, baseDir) {
  const rel = path.relative(baseDir, file).replaceAll(path.sep, '/').replace(/index\.html$/, '');
  return '/' + rel;
}
function tokens(text) {
  const normalized = words(text);
  const shingles = new Set();
  const width = 5;
  for (let i = 0; i <= normalized.length - width; i++) shingles.add(normalized.slice(i, i + width).join(' '));
  return shingles;
}
function jaccard(a, b) {
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}
function grade(score) { return score >= 93 ? 'A' : score >= 90 ? 'A-' : score >= 87 ? 'B+' : score >= 83 ? 'B' : score >= 80 ? 'B-' : score >= 77 ? 'C+' : score >= 73 ? 'C' : score >= 70 ? 'C-' : score >= 60 ? 'D' : 'F'; }
function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }
function scoreFromFindings(base, findings, weights) {
  let score = base;
  for (const f of findings) score -= weights[f.severity] || 1;
  return clamp(score);
}
function daysOld(value) {
  if (!value) return null;
  const ms = Date.now() - new Date(value).valueOf();
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : null;
}

function analyzePages(baseDir, includeUnpublished = false) {
  const files = walk(baseDir).filter((f) => f.endsWith('index.html'));
  const findings = [];
  const pages = [];
  for (const file of files) {
    const route = routeForFile(file, baseDir);
    if (/^\/(admin|agency|preview|llm-atlas)\//.test(route)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const title = get(html, /<title>([\s\S]*?)<\/title>/i);
    const description = get(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) || get(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
    const canonical = get(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || get(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    const body = get(html, /<div class=["']container narrow article-body["']>([\s\S]*?)<\/div><\/section><\/main>/i) || get(html, /<main[\s\S]*?<\/main>/i);
    const text = stripHtml(body || html);
    const isResource = route.startsWith('/resources/') && !/^\/resources\/(articles|insights|guides|white-papers)\/$/.test(route) && route !== '/resources/';
    const hasAuthorLink = /href=["']\/about\/["'][^>]*>\s*Monika Hicks/i.test(html) || /Monika Hicks[\s\S]{0,100}href=["']\/about\//i.test(html);
    const hasTime = /<time\b[^>]+datetime=/i.test(html);
    const hasServiceLink = /href=["']\/(therapy|coaching|groups|corporate-speaking)\//i.test(body || '');
    const hasSources = /target=["']_blank["']/i.test(body || '');
    const hasShortAnswer = /class=["'][^"']*short-answer/i.test(html);
    const hasArticleSchema = /["']@type["']\s*:\s*["']Article["']/i.test(html);
    const hasAuthorSchema = /["']author["']\s*:\s*\{[\s\S]{0,250}["']Person["']/i.test(html);
    const hasDateSchema = /["']datePublished["']/i.test(html) && /["']dateModified["']/i.test(html);
    const internalLinks = [...html.matchAll(/href=["'](\/[^"'#?]*)/gi)].map((m) => m[1]);
    const item = { route, title, titleLength: title.length, description, descriptionLength: description.length, canonical, h1Count, wordCount: wordCount(text), isResource, hasAuthorLink, hasTime, hasServiceLink, hasSources, hasShortAnswer, hasArticleSchema, hasAuthorSchema, hasDateSchema, internalLinkCount: new Set(internalLinks).size, text, tokenSet: tokens(text) };
    pages.push(item);
    const add = (severity, code, message, tip) => findings.push({ severity, code, route, message, tip });
    if (!title) add('high','missing-title','Missing title tag.','Add a concise, page-specific title.');
    else if (title.length > 68) add('low','long-title',`Title is ${title.length} characters.`, 'Shorten the search title while preserving the page H1.');
    if (!description) add('medium','missing-description','Missing meta description.','Add a distinct summary aligned to page intent.');
    else if (description.length < 80 || description.length > 165) add('low','description-length',`Description is ${description.length} characters.`, 'Keep descriptions useful and roughly 80–165 characters.');
    if (!canonical) add('high','missing-canonical','Missing canonical URL.','Add a self-referencing canonical.');
    if (h1Count !== 1) add('medium','h1-count',`Found ${h1Count} H1 elements.`, 'Use exactly one descriptive H1.');
    if (isResource) {
      if (!hasAuthorLink) add('medium','author-bio-link','Resource lacks a linked Monika Hicks author credit.','Link the author name and bio box to /about/.');
      if (!hasTime) add('low','visible-date','Resource lacks a machine-readable visible date.','Add a visible <time datetime="…"> element.');
      if (!hasServiceLink) add('medium','service-connection','Resource has no contextual service link.','Connect the topic to the most relevant therapy, coaching, group, or training page.');
      if (!hasSources) add('low','source-link','Resource has no external supporting source.','Add one or two credible sources where the topic benefits from them.');
      if (!hasShortAnswer) add('medium','short-answer','Resource lacks a concise answer summary.','Add a direct summary near the top for users and answer engines.');
      if (!hasArticleSchema || !hasAuthorSchema || !hasDateSchema) add('medium','article-schema','Article schema is incomplete.','Include Article, author, datePublished, dateModified, publisher, and mainEntityOfPage.');
      if (item.internalLinkCount < 5) add('low','thin-internal-links',`Only ${item.internalLinkCount} unique internal links found.`, 'Add relevant contextual links without forcing them.');
    }
  }
  const resourcePages = pages.filter((p) => p.isResource && p.wordCount > 150);
  const duplicatePairs = [];
  for (let i = 0; i < resourcePages.length; i++) {
    for (let j = i + 1; j < resourcePages.length; j++) {
      const sim = jaccard(resourcePages[i].tokenSet, resourcePages[j].tokenSet);
      if (sim >= 0.78) duplicatePairs.push({ a: resourcePages[i].route, b: resourcePages[j].route, similarity: Number(sim.toFixed(3)) });
    }
  }
  duplicatePairs.sort((a,b) => b.similarity - a.similarity);
  for (const pair of duplicatePairs.slice(0, 30)) {
    findings.push({ severity: pair.similarity >= 0.88 ? 'medium' : 'low', code: 'content-similarity', route: pair.a, relatedRoute: pair.b, message: `Content similarity ${(pair.similarity * 100).toFixed(0)}% with ${pair.b}.`, tip: 'Keep the subject, but deepen a different angle, example set, structure, and service connection.' });
  }
  return { pages: pages.map(({text,tokenSet,...p}) => p), findings, duplicatePairs };
}

function loadSnapshot(name) {
  return readJson(path.join(agencyDir, `${name}_snapshot.json`), { provider: name, status: 'not_connected', checkedAt: null, message: 'Monitoring connector has not run with credentials yet.' });
}

function generate() {
  ensureDir(agencyDir);
  const liveAnalysis = analyzePages(dist);
  const sourceAnalysis = analyzePages(path.join(root, 'pages'), true);
  const manifest = readJson(manifestPath, []);
  const approvedRoutes = new Set(manifest.filter((i) => i.status === 'approved').map((i) => i.slug));
  const forwardFindings = sourceAnalysis.findings.filter((f) => approvedRoutes.has(f.route));
  const liveFindings = liveAnalysis.findings;
  const gsc = loadSnapshot('gsc');
  const bing = loadSnapshot('bing');
  const live = loadSnapshot('live');

  const technicalFindings = liveFindings.filter((f) => ['missing-title','missing-description','missing-canonical','h1-count'].includes(f.code));
  const onPageFindings = liveFindings.filter((f) => ['long-title','description-length','thin-internal-links','service-connection'].includes(f.code));
  const aeoFindings = liveFindings.filter((f) => ['short-answer','article-schema','visible-date'].includes(f.code));
  const geoFindings = liveFindings.filter((f) => ['author-bio-link','source-link','article-schema','service-connection'].includes(f.code));
  const liveContentFindings = liveFindings.filter((f) => ['content-similarity','author-bio-link','source-link','service-connection'].includes(f.code));
  const forwardContentFindings = forwardFindings.filter((f) => ['content-similarity','author-bio-link','source-link','service-connection','short-answer','article-schema','visible-date'].includes(f.code));
  const weights = { high: 8, medium: 3, low: 1 };

  const gscAge = daysOld(gsc.checkedAt), bingAge = daysOld(bing.checkedAt), liveAge = daysOld(live.checkedAt);
  const measurementScore = clamp(100 - (gsc.status === 'ok' ? 0 : 6.5) - (bing.status === 'ok' ? 0 : 6.5) - (gscAge !== null && gscAge > 7 ? 5 : 0) - (bingAge !== null && bingAge > 7 ? 5 : 0));
  const monitoringScore = clamp(100 - (live.status === 'ok' ? 0 : 6) - (liveAge !== null && liveAge > 3 ? 4 : 0));

  const coverageScore = (findings, totalPages, cap = 13) => {
    const affected = new Set(findings.map((f) => f.route)).size;
    return clamp(100 - Math.min(cap, totalPages ? (affected / totalPages) * 100 : 0));
  };
  const livePageCount = Math.max(1, liveAnalysis.pages.length);
  const approvedCount = Math.max(1, approvedRoutes.size);
  const liveSimilarityPenalty = liveAnalysis.duplicatePairs.length ? 13 : 0;
  const forwardSimilarityPairs = sourceAnalysis.duplicatePairs.filter((p) => approvedRoutes.has(p.a) && approvedRoutes.has(p.b));
  const forwardSimilarityPenalty = forwardSimilarityPairs.length ? 13 : 0;
  const scores = [
    { key:'technical', label:'Technical SEO', score:coverageScore(technicalFindings, livePageCount, 20), summary:'Crawl, metadata, canonical, and document structure health.' },
    { key:'onpage', label:'On-page SEO', score:coverageScore(onPageFindings, livePageCount, 13), summary:'Titles, descriptions, internal linking, and service alignment.' },
    { key:'liveContent', label:'Live content quality', score:clamp(100 - liveSimilarityPenalty - Math.min(8, coverageScore(liveContentFindings.filter((f)=>f.code!=='content-similarity'), livePageCount, 8) === 100 ? 0 : 8)), summary:'Current public resource distinctiveness and trust signals; legacy similarity is capped but always shown.' },
    { key:'forwardContent', label:'Forward publishing readiness', score:clamp(100 - forwardSimilarityPenalty - Math.min(8, coverageScore(forwardContentFindings.filter((f)=>f.code!=='content-similarity'), approvedCount, 8) === 100 ? 0 : 8)), summary:'Approved, unpublished pieces before their scheduled release.' },
    { key:'aeo', label:'AEO', score:coverageScore(aeoFindings, livePageCount, 13), summary:'Direct answers, readable structure, dates, and Article schema.' },
    { key:'geo', label:'GEO', score:coverageScore(geoFindings, livePageCount, 13), summary:'Entity clarity, author evidence, supporting sources, and citation readiness.' },
    { key:'measurement', label:'GSC + Bing measurement', score:measurementScore, summary:'Connector availability and data freshness.' },
    { key:'monitoring', label:'Live health monitoring', score:monitoringScore, summary:'Scheduled URL, sitemap, robots, and response checks.' }
  ].map((s) => ({ ...s, grade:grade(s.score), target:87, targetMet:s.score >= 87 }));

  const priorities = [...liveFindings, ...forwardFindings]
    .sort((a,b) => ({high:3,medium:2,low:1}[b.severity] - {high:3,medium:2,low:1}[a.severity]))
    .slice(0, 80);
  const report = {
    generatedAt:new Date().toISOString(),
    policy:{ blocking:false, message:'SEO, AEO, GEO, GSC, Bing, and live-health findings are advisory warnings only. They never block publishing or deployment.' },
    inventory:{ totalManifest:manifest.length, published:manifest.filter((i)=>i.status==='published').length, approved:manifest.filter((i)=>i.status==='approved').length, livePages:liveAnalysis.pages.length, sourcePages:sourceAnalysis.pages.length },
    scores,
    health:{ gsc, bing, live },
    trends:{ gsc:gsc.metrics || null, bing:bing.metrics || null },
    warningCounts:{ high:priorities.filter((f)=>f.severity==='high').length, medium:priorities.filter((f)=>f.severity==='medium').length, low:priorities.filter((f)=>f.severity==='low').length },
    priorities,
    duplicatePairs:{ live:liveAnalysis.duplicatePairs.slice(0,50), forward:sourceAnalysis.duplicatePairs.filter((p)=>approvedRoutes.has(p.a)&&approvedRoutes.has(p.b)).slice(0,50) },
    tips:{
      seo:['Keep search titles concise while preserving the editorial H1.','Use contextual internal links to the most relevant service and resource pages.','Review warnings by affected URL instead of changing the whole architecture.'],
      aeo:['Lead with a direct short answer that can stand on its own.','Use descriptive H2s, visible dates, and complete Article schema.','Answer the exact page intent before broadening into adjacent context.'],
      geo:['Link every author credit to Monika’s on-site bio.','Support claims with credible sources when useful.','Keep entity, service, audience, and geography language consistent across high-value pages.']
    }
  };
  const out = path.join(agencyDir, 'dashboard.json');
  writeJson(out, report);
  if (fs.existsSync(dist)) writeJson(path.join(dist, 'data', 'agency', 'dashboard.json'), report);
  console.log(`Agency dashboard report written: ${out}`);
  return report;
}

if (require.main === module) {
  try { generate(); } catch (err) { console.error(`AGENCY REPORT WARNING: ${err.stack || err.message}`); process.exitCode = 0; }
}
module.exports = { generate, analyzePages, grade };
