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
    for (const type of ["Organization", "WebSite", "ProfessionalService"]) {
      if (!types.has(type)) failures.push(`${name}: missing ${type} schema`);
    }
  }

  if (name.startsWith("pages/resources/") && !name.match(/pages\/resources\/(articles|guides|insights|white-papers)\/index\.html$/) && name !== "pages/resources/index.html") {
    if (!types.has("Article")) failures.push(`${name}: missing Article schema`);
  }
}

if (failures.length) {
  fail(["SEO metadata contract failed:", ...failures.map((failure) => `- ${failure}`)]);
}

console.log(`SEO metadata contract OK (${files.length} public pages checked, each carrying a <title> of at least ${TITLE_MIN_LENGTH} characters).`);
