const fs = require("fs");
const path = require("path");
const { fail } = require('../validation/protocol');

const root = process.cwd();
const pagesDir = path.join(root, "pages");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name === "index.html" ? [full] : [];
  });
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  return matches.map((match) => JSON.parse(match[1]));
}

const requiredMeta = [
  'property="og:title"',
  'property="og:description"',
  'property="og:url"',
  'property="og:image"',
  'name="twitter:card"',
  'name="twitter:title"',
  'name="twitter:description"',
  'name="twitter:image"',
  'name="description"',
  'rel="canonical"'
];

// The single most load-bearing metadata element had no assertion anywhere in the
// repo: a page could ship with no <title> at all and every check still passed.
// It is not expressible as a `requiredMeta` substring token, because an empty
// `<title></title>` contains the token and still leaves the page untitled, so it
// gets its own structural check. The 8-character floor is deliberately the same
// bar scripts/autonomy/lib/self_heal.mjs uses to raise MISSING_TITLE, so the
// contract and the repairer cannot disagree about what "has a title" means.
const TITLE_MIN_LENGTH = 8;

function titleFailure(name, html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  if (!match) return `${name}: missing <title> element`;
  const text = match[1].trim();
  if (!text) return `${name}: <title> element is empty`;
  if (text.length < TITLE_MIN_LENGTH) {
    return `${name}: <title> is ${text.length} characters ("${text}"); the self-heal MISSING_TITLE bar is ${TITLE_MIN_LENGTH}`;
  }
  return null;
}

const failures = [];
const files = walk(pagesDir).filter((file) => !rel(file).includes("/admin/"));

// A metadata contract that passes on an empty page set proves nothing. If the
// walk returns nothing the tree is not clean, it is unreadable.
if (files.length === 0) {
  fail([
    'SEO metadata contract failed:',
    `- examined zero public pages under ${rel(pagesDir)} - refusing to pass on an empty loop.`
  ]);
}

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const name = rel(file);

  const missingTitle = titleFailure(name, html);
  if (missingTitle) failures.push(missingTitle);

  for (const token of requiredMeta) {
    if (!html.includes(token)) failures.push(`${name}: missing ${token}`);
  }

  if (!html.includes('type="application/ld+json"')) {
    failures.push(`${name}: missing JSON-LD`);
    continue;
  }

  let schemas = [];
  try {
    schemas = extractJsonLd(html);
  } catch (err) {
    failures.push(`${name}: invalid JSON-LD (${err.message})`);
    continue;
  }

  const types = new Set(schemas.flatMap((schema) => Array.isArray(schema["@type"]) ? schema["@type"] : [schema["@type"]]).filter(Boolean));

  if (!types.has("BreadcrumbList")) failures.push(`${name}: missing BreadcrumbList schema`);

  if (name === "pages/index.html") {
    // ProfessionalService was pinned here until 21 Oct 2026. It is a LocalBusiness
    // subtype, Google requires `address` on every LocalBusiness, and the practice is
    // virtual with no public address - so the pin forced a rich-results error onto
    // every page the org node is stamped on. The rich-results rules below now forbid
    // any LocalBusiness type that lacks an address.
    for (const type of ["Organization", "WebSite"]) {
      if (!types.has(type)) failures.push(`${name}: missing ${type} schema`);
    }
  }

  if (name.startsWith("pages/resources/") && !name.match(/pages\/resources\/(articles|guides|insights|white-papers)\/index\.html$/) && name !== "pages/resources/index.html") {
    if (!types.has("Article")) failures.push(`${name}: missing Article schema`);
  }
}


// Google rich-results required properties. Ahrefs (19 Oct 2026 crawl) reported
// "Structured data has Google rich results validation error" on 144 pages: the
// sitewide org node was typed ProfessionalService (a LocalBusiness) with no
// address, and its subjectOf carried an Event with no startDate/location and
// ProfilePages with no mainEntity. schema.org's own validator passes all of that,
// so this contract checks Google's documented required properties itself, on
// every JSON-LD node at any depth, in the page sources, in the entity files the
// build stamps onto every page, and in dist/ when a build is present.
const LOCAL_BUSINESS_TYPES = new Set([
  "LocalBusiness", "ProfessionalService", "MedicalBusiness", "MedicalClinic", "Physician",
  "Psychologist", "HealthAndBeautyBusiness", "LegalService", "FinancialService",
  "EmploymentAgency", "HomeAndConstructionBusiness", "Store", "FoodEstablishment",
  "Restaurant", "LodgingBusiness", "AutomotiveBusiness", "SportsActivityLocation",
  "EntertainmentBusiness", "TravelAgency", "RealEstateAgent", "ChildCare", "Dentist"
]);
const EVENT_TYPES = new Set(["Event", "BusinessEvent", "EducationEvent", "SocialEvent", "MusicEvent", "Festival", "CourseInstance"]);
const ARTICLE_TYPES = new Set(["Article", "NewsArticle", "BlogPosting"]);

function has(node, key) {
  const v = node[key];
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function richResultErrors(node, where, out = [], depth = 0) {
  if (Array.isArray(node)) { node.forEach((n) => richResultErrors(n, where, out, depth)); return out; }
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node["@graph"])) richResultErrors(node["@graph"], where, out, depth);
  const types = [].concat(node["@type"] || []);
  const label = `${where}: ${types.join("+") || "node"}`;
  const isRef = Object.keys(node).every((k) => k === "@id");
  if (!isRef) {
    if (types.some((t) => LOCAL_BUSINESS_TYPES.has(t))) {
      for (const k of ["name", "address"]) if (!has(node, k)) out.push(`${label} is a LocalBusiness type missing required "${k}" (Google rich results)`);
    }
    if (types.some((t) => EVENT_TYPES.has(t))) {
      for (const k of ["name", "startDate", "location"]) if (!has(node, k)) out.push(`${label} missing required "${k}" (Google Event rich result)`);
    }
    if (types.includes("ProfilePage") && !has(node, "mainEntity")) out.push(`${label} missing required "mainEntity" (Google ProfilePage rich result)`);
    if (types.includes("FAQPage")) {
      const qs = [].concat(node.mainEntity || []);
      if (!qs.length) out.push(`${label} has no Question in mainEntity`);
      qs.forEach((q, i) => {
        if (!has(q, "name")) out.push(`${label} Question ${i + 1} missing "name"`);
        if (!q.acceptedAnswer || !has(q.acceptedAnswer, "text")) out.push(`${label} Question ${i + 1} missing acceptedAnswer.text`);
      });
    }
    if (types.includes("BreadcrumbList")) {
      const items = [].concat(node.itemListElement || []);
      if (!items.length) out.push(`${label} has no itemListElement`);
      items.forEach((it, i) => {
        if (!has(it, "position") || !has(it, "name")) out.push(`${label} ListItem ${i + 1} missing position/name`);
        if (i < items.length - 1 && !has(it, "item")) out.push(`${label} ListItem ${i + 1} missing "item" (only the last crumb may omit it)`);
      });
    }
    if (depth === 0 && types.some((t) => ARTICLE_TYPES.has(t))) {
      if (!has(node, "headline")) out.push(`${label} missing "headline"`);
      for (const a of [].concat(node.author || [])) if (!a || (!has(a, "name") && !has(a, "@id"))) out.push(`${label} author missing "name"`);
    }
    if (types.includes("AggregateRating") || has(node, "aggregateRating")) {
      const r = types.includes("AggregateRating") ? node : node.aggregateRating;
      if (!has(r, "ratingValue") || !(has(r, "ratingCount") || has(r, "reviewCount"))) out.push(`${label} AggregateRating needs ratingValue and ratingCount/reviewCount`);
    }
    if (types.includes("Review")) {
      if (!has(node, "author")) out.push(`${label} Review missing "author"`);
      if (!node.reviewRating || !has(node.reviewRating, "ratingValue")) out.push(`${label} Review missing reviewRating.ratingValue`);
    }
    if (types.includes("Course")) for (const k of ["name", "description"]) if (!has(node, k)) out.push(`${label} missing required "${k}" (Google Course)`);
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "@context" || k === "@graph") continue;
    if (v && typeof v === "object") richResultErrors(v, where, out, depth + 1);
  }
  return out;
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
}

function walkHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkHtml(full);
    return entry.isFile() && entry.name.endsWith(".html") ? [full] : [];
  });
}

let richNodesChecked = 0;
function checkRichResults(file, html) {
  for (const block of jsonLdBlocks(html)) {
    let json;
    try { json = JSON.parse(block); } catch (err) { failures.push(`${rel(file)}: invalid JSON-LD (${err.message})`); continue; }
    richNodesChecked++;
    for (const e of richResultErrors(json, rel(file))) failures.push(e);
  }
}

for (const entityFile of ["data/entities/org_schema.json", "data/entities/person_schema.json"]) {
  const full = path.join(root, entityFile);
  if (!fs.existsSync(full)) { failures.push(`${entityFile}: missing - the build stamps it onto pages`); continue; }
  richNodesChecked++;
  for (const e of richResultErrors(JSON.parse(fs.readFileSync(full, "utf8")), entityFile)) failures.push(e);
}
const distFiles = walkHtml(path.join(root, "dist")).filter((f) => !rel(f).startsWith("dist/admin/"));
for (const file of [...files, ...distFiles]) checkRichResults(file, fs.readFileSync(file, "utf8"));
if (richNodesChecked === 0) failures.push("rich-results check examined zero JSON-LD blocks - refusing to pass on an empty loop.");

if (failures.length) {
  fail(["SEO metadata contract failed:", ...failures.map((failure) => `- ${failure}`)]);
}

console.log(`SEO metadata contract OK (${files.length} public pages checked, each carrying a <title> of at least ${TITLE_MIN_LENGTH} characters; ${richNodesChecked} JSON-LD blocks across ${files.length + distFiles.length} HTML files + entity files pass Google rich-results required properties).`);
