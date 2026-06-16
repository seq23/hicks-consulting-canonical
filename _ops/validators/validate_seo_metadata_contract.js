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

const failures = [];
const files = walk(pagesDir).filter((file) => !rel(file).includes("/admin/"));

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const name = rel(file);

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

console.log(`SEO metadata contract OK (${files.length} public pages checked).`);
