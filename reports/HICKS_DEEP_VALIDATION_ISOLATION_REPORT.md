# Hicks Consulting — Deep Validation Isolation Report

**Mode:** DEEP VALIDATION
**Source:** uploaded canonical ZIP
**Principle:** Product behavior and the intended site architecture define validation. Validators do not define product scope.

## Executive findings

- Local pre-push runs only `npm run build` followed by the 48-check `validate:all` profile.
- All 48 validators passed in isolation; none modified repository files.
- The full matrix passed with one non-blocking agency-quality finding: live content quality score 79.
- Clean-build parity fails because `data/agency/dashboard.json.generatedAt` changes on every build.
- Existing local validation is dominated by static file/token/JSON contract checks. It does not prove the full autonomous generation, repair, publishing, email, provider, auth, rollback, or browser journeys requested for the new system.
- Several validators encode the old owner-approval model and must be replaced rather than allowed to constrain the new Full Safe Autonomy design.

## Exact local validation sequence

1. `npm ci`
2. `npm run build`
3. `npm run validate:all`
4. `npm run release:prepush:local` repeats steps 2 and 3.

## Isolated validator inventory

### 1. `validation-registry`

- **Entry:** `_ops/validators/validate_validation_registry.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `governance`
- **Deep-validation disposition:** `KEEP_NON_BLOCKING_FOR_PRODUCT`
- **Isolated result:** exit `0`, 66 ms, changed files: `0`
- **Observed output:** Validation registry contract OK (48 checks, 7 profiles, 2 release gates).
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { fail } = require(
  - ); function readJson(file, label) { if (!fs.existsSync(file)) fail(`${label} is missing.`); try { return JSON.parse(fs.readFileSync(file,
  - )); } catch (error) { fail(`${label} is invalid JSON: ${error.message}`); } } const registry = readJson(registryPath,
  - ); const scripts = pkg.scripts || {}; const allowedSeverities = new Set([
  - ]); const checks = registry.checks; if (!Array.isArray(checks) || checks.length === 0) fail(
  - matrix must reference _repo_validation_registry.json.
  - registry finding marker must be VALIDATION_FINDING.
  - HARD_FAIL
  - unexpected validator execution failures must be HARD_FAIL.
  - FORBIDDEN
  - direct CI leaf invocation must be FORBIDDEN.

### 2. `orchestrator-contract`

- **Entry:** `_ops/validators/validate_orchestrator_contract.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `governance`
- **Deep-validation disposition:** `KEEP_NON_BLOCKING_FOR_PRODUCT`
- **Isolated result:** exit `0`, 437 ms, changed files: `0`
- **Observed output:** Validation orchestrator contract OK (warning pass, hard finding block, runtime crash block, syntax crash block).
- **Source-level assertions/signals:**
  - ); const os = require(
  - ); const path = require(
  - ); const { spawnSync } = require(
  - ); const { fail } = require(
  - : ''; fail(
  - const broken = ;\n
  - HARD_FAIL
  - , JSON.stringify({ schemaVersion:
  - , unexpectedExecutionFailure:
  - ); assert(result.status === 0,
  - strong warning must be classified visibly
  - ); assert(result.status === 1,

### 3. `preflight`

- **Entry:** `_ops/validators/validate_preflight.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `release-integrity`
- **Deep-validation disposition:** `KEEP_BLOCKING`
- **Isolated result:** exit `0`, 41 ms, changed files: `0`
- **Observed output:** Preflight OK
- **Source-level assertions/signals:**
  - ].forEach(item => { if (!exists(item)) fail(`Missing required item: ${item}`); }); console.log(

### 4. `publisher-contract`

- **Entry:** `_ops/validators/validate_publisher_contract.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `legacy-publisher-behavior`
- **Deep-validation disposition:** `REPLACE_FOR_FULL_SAFE_AUTONOMY`
- **Isolated result:** exit `0`, 38 ms, changed files: `0`
- **Observed output:** Manifest updated: 1 scheduled item(s) published.; Publisher scheduling contract OK (strict scheduledAt authority, future-date protection, preview cleanup, duplicate protection, atomic write, idempotence).
- **Source-level assertions/signals:**
  - ); const os = require(
  - ); const path = require(
  - ); const { processManifest, publishManifestFile } = require(
  - ); const { fail } = require(
  - ); function assert(condition, message) { if (!condition) fail(`PUBLISHER CONTRACT FAIL: ${message}`); } const now = new Date(
  - , status:
  - ); assert(result.publishedCount === 1, `expected exactly one publication, got ${result.publishedCount}`); assert(due.status ===
  - due approved content must publish
  - publishedAt must use the publication clock
  - published content must remove previewPath
  - future scheduled content must remain approved
  - future content must retain previewPath

### 5. `canonical-url`

- **Entry:** `_ops/validators/validate_canonical_url_contract.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `search-quality`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 52 ms, changed files: `0`
- **Observed output:** Canonical URLs OK
- **Source-level assertions/signals:**
  - )) fail(`Missing canonical domain in ${file}`); } console.log(

### 6. `seo-metadata`

- **Entry:** `_ops/validators/validate_seo_metadata_contract.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `search-quality`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 59 ms, changed files: `0`
- **Observed output:** SEO metadata contract OK (262 public pages checked).
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { fail } = require('../validation/protocol'); const root = process.cwd(); const pagesDir = path.join(root,
  - >([\s\S]*?)<\/script>/gi)]; return matches.map((match) => JSON.parse(match[1])); } const requiredMeta = [ 'property=
  - ' ]; const failures = []; const files = walk(pagesDir).filter((file) => !rel(file).includes(
  - ); const name = rel(file); for (const token of requiredMeta) { if (!html.includes(token)) failures.push(`${name}: missing ${token}`); } if (!html.includes('type=
  - ${name}: missing JSON-LD
  - ${name}: invalid JSON-LD (${err.message})
  - ]) ? schema[
  - ] : [schema[
  - )) failures.push(`${name}: missing BreadcrumbList schema`); if (name ===
  - ${name}: missing ${type} schema
  - )) failures.push(`${name}: missing Article schema`); } } if (failures.length) { fail([

### 7. `agency-infrastructure`

- **Entry:** `_ops/validators/validate_agency_infrastructure.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `operator-system-shape`
- **Deep-validation disposition:** `DOWNGRADE_UNLESS_RUNTIME_BROKEN`
- **Isolated result:** exit `0`, 90 ms, changed files: `0`
- **Observed output:** Agency infrastructure contract OK (route, report, workflow, scorecard, noindex, sitemap isolation, and warning-only provider behavior).
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { spawnSync } = require(
  - ); const { fail } = require(
  - ); const root = process.cwd(); const issues = []; const requiredFiles = [
  - .github/workflows/agency-seo-monitor.yml
  - Missing required agency file: ${relative}
  - ); } for (const file of requiredFiles) read(file); const pkg = JSON.parse(read(
  - ); const expectedScripts = {
  - ${name} must map exactly to: ${expected}
  - }); if (result.status !== 0) issues.push(`${file} failed syntax validation: ${(result.stderr || result.stdout ||
  - /agency/ must contain a noindex,nofollow robots directive.
  - /agency/ must load assets/js/agency-dashboard.js.

### 8. `agency-quality`

- **Entry:** `_ops/validators/validate_agency_quality.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `advisory-quality`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 49 ms, changed files: `0`
- **Observed output:** VALIDATION_FINDING check=agency-quality summary=1 agency quality finding(s); Live content quality is below the B+ target: 79.
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { warn } = require(
  - )); } catch (error) { findings.push(`${relative} could not be read: ${error.message}`); return null; } } function decode(text) { return String(text ||
  - ) .trim(); } function articleSchema(html) { const scripts = [...html.matchAll(/<script[^>]+type=["
  - ); const approved = manifest.filter((item) => item.status ===
  - ); const published = manifest.filter((item) => item.status ===
  - ${item.id}: source page missing at ${relative}
  - ); const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]); const expectedDate = String(item.scheduledAt ||
  - ']/i.test(html)) findings.push(`${item.id}: meta description is missing or too short.`); if (!html.includes('/about/')) findings.push(`${item.id}: linked author biography is missing.`); if (!new RegExp(`<time[^>]+datetime=[
  - ]${expectedDate}["
  - ${href}`) || html.includes(`href='${href}`))) findings.push(`${item.id}: topic-appropriate service connection is missing.`); if (!html.includes('href=
  - ${item.id}: resource-library link is missing.

### 9. `lead-magnet`

- **Entry:** `_ops/validators/validate_lead_magnet_contract.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `critical-user-journey`
- **Deep-validation disposition:** `KEEP_BLOCKING`
- **Isolated result:** exit `0`, 35 ms, changed files: `0`
- **Observed output:** Lead magnet contract OK
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { fail } = require(
  - ); } const requiredFiles = [
  - Missing required file: ${file}
  - Landing page missing token: ${token}
  - Homepage must link to stress worksheet landing page.
  - Homepage spotlight section missing.
  - Resources page must link to stress worksheet landing page.
  - Resources spotlight section missing.
  - Client JS missing token: ${token}
  - FORM_DATABASE_SHARED_SECRET
  - FORM_DATABASE_DISPATCH_FAILED

### 10. `form-database`

- **Entry:** `_ops/validators/validate_form_database_contract.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `critical-user-journey`
- **Deep-validation disposition:** `KEEP_BLOCKING`
- **Isolated result:** exit `0`, 36 ms, changed files: `0`
- **Observed output:** Form database contract OK (3 forms POST to Apps Script, manually follow Google redirect with pristine GET, and require ok:true before user success).
- **Source-level assertions/signals:**
  - Cloudflare Advanced Mode worker missing: worker/_worker.js
  - , route:
  - ], required: [
  - FORM_DATABASE_SHARED_SECRET
  - INQUIRY_SHARED_SECRET
  - FORM_DATABASE_DISPATCH_FAILED
  - Worker missing unified form database token: ${token}
  - Worker must prefer FORM_DATABASE_WEBHOOK_URL before legacy webhook variables.
  - TRAINING_INQUIRY_SECRET
  - Worker must prefer FORM_DATABASE_SHARED_SECRET before legacy secret variables.
  - LEAD_MAGNET_SHARED_SECRET
  - Worker must keep lead magnet env vars during transition.

### 11. `crawl-contract`

- **Entry:** `_ops/validators/validate_crawl_contract.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `search-quality`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 34 ms, changed files: `0`
- **Observed output:** Crawl contract OK
- **Source-level assertions/signals:**
  - )) fail(

### 12. `sitemap-parity`

- **Entry:** `_ops/validators/validate_sitemap_page_parity.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `search-quality`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 44 ms, changed files: `0`
- **Observed output:** Sitemap parity OK
- **Source-level assertions/signals:**
  - )); const publishedContent = new Set( manifest.filter(item => item.validationPassed === true && item.status ===
  - ; })) { if (route ===
  - || route.startsWith(
  - )) continue; if (route.startsWith(
  - ) && route !==
  - && !publishedContent.has(route)) continue; const loc = `https://www.hicksconsulting.org${route}`; if (!xml.includes(loc)) fail(`Missing route in sitemap: ${loc}`); } console.log(

### 13. `internal-links`

- **Entry:** `_ops/validators/validate_internal_links.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `critical-navigation`
- **Deep-validation disposition:** `KEEP_WARNING_OR_BLOCK_BROKEN_PRIMARY_CTA`
- **Isolated result:** exit `0`, 59 ms, changed files: `0`
- **Observed output:** Internal links OK
- **Source-level assertions/signals:**
  - ); const routes = new Set(); function walk(dir, arr=[]){ for(const e of fs.readdirSync(dir)){ const p=path.join(dir,e); const s=fs.statSync(p); if(s.isDirectory()) walk(p,arr); else if(e===
  - ); routes.add(rel===
  - ); } const allowedExternalPrefixes = [
  - )){ if(!allowedExternalPrefixes.some(prefix => href.startsWith(prefix))) fail(`Unexpected external link ${href} in ${file}`); } else if(href.startsWith(
  - ; if(!routes.has(normalized) && ![
  - Broken internal route ${href} in ${file}

### 14. `hidden-llm-surfaces`

- **Entry:** `_ops/validators/validate_hidden_llm_surfaces.js`
- **Registered severity:** `SOFT_WARNING`; blocks release: `false`
- **Class:** `optional-ai-surface`
- **Deep-validation disposition:** `KEEP_INFO`
- **Isolated result:** exit `0`, 90 ms, changed files: `0`
- **Observed output:** Hidden LLM surface advisory OK
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { warn: reportFindings } = require(
  - ); const expectedHiddenRoutes = [
  - href=["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']
  - )); const warnings = []; function warn(message) { warnings.push(message); } function read(file) { return fs.existsSync(file) ? fs.readFileSync(file,
  - scripts/site_build.js should define llmOnlyRoutes.
  - '${route}'
  - ${route} should be classified inside llmOnlyRoutes.
  - ${route} should not be classified inside staticPublicRoutes.
  - , route.replace(/^\//,
  - ${route} should have a source page at ${path.relative(root, pagePath)}.
  - LLM-only route appears in main nav in ${path.relative(root, file)}.

### 15. `llm-ingestion-routes`

- **Entry:** `_ops/validators/validate_llm_ingestion_routes.js`
- **Registered severity:** `SOFT_WARNING`; blocks release: `false`
- **Class:** `optional-ai-surface`
- **Deep-validation disposition:** `KEEP_INFO`
- **Isolated result:** exit `0`, 34 ms, changed files: `0`
- **Observed output:** LLM ingestion route advisory OK
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { warn: reportFindings } = require(
  - ); const warnings = []; function warn(message) { warnings.push(message); } function read(file) { return fs.existsSync(file) ? fs.readFileSync(file,
  - ); const match = build.match(/const\s+llmOnlyRoutes\s*=\s*\[([\s\S]*?)\];/); if (!match) warn(
  - ); const routes = match ? [...match[1].matchAll(/
  - /g)].map(x => x[1]) : []; if (routes.length < 8) warn(`Expected expanded llmOnlyRoutes set; found ${routes.length}.`); for (const route of routes) { const page = path.join(
  - , route.replace(/^\//,
  - Missing page for ${route}: ${page}
  - ${route} should disclose crawler/LLM-only purpose.
  - ${route} should keep an extractable short-answer block.
  - ${required} is missing ${route}. Run npm run build.
  - ${warnings.length}-llm-route-warning(s)

### 16. `query-traceability`

- **Entry:** `_ops/validators/validate_query_traceability.js`
- **Registered severity:** `SOFT_WARNING`; blocks release: `false`
- **Class:** `planning-observability`
- **Deep-validation disposition:** `KEEP_INFO`
- **Isolated result:** exit `0`, 34 ms, changed files: `0`
- **Observed output:** Query traceability OK
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { read, fail } = require(
  - )); const seenQuery = new Set(); const pageSet = new Set(); for(const item of map){ if(!item.query || !item.page || !item.intent || !item.entityTarget || !item.ctaTarget) fail(
  - ); const q = item.query.toLowerCase().trim(); if(seenQuery.has(q)) fail(`Duplicate query: ${item.query}`); seenQuery.add(q); pageSet.add(item.page.replace(/\/$/,
  - Mapped page missing: ${item.page}
  - Query coverage map is empty.

### 17. `above-fold`

- **Entry:** `_ops/validators/validate_above_fold.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `conversion-quality`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 50 ms, changed files: `0`
- **Observed output:** Above-fold contract OK
- **Source-level assertions/signals:**
  - ); const isAdmin = rel.includes(`${path.sep}admin${path.sep}`); if(isNoIndex || isAdmin) continue; if(!/<h1[ >]/.test(html)) fail(`Missing H1 in ${file}`); if(!html.includes(
  - )) fail(`Missing short answer block in ${file}`); } // Homepage above-fold dual pathway checks. const homepage = fs.readFileSync(path.join(process.cwd(),
  - Homepage above-fold dual pathway token missing: ${token}

### 18. `entity-coverage`

- **Entry:** `_ops/validators/validate_entity_coverage.js`
- **Registered severity:** `SOFT_WARNING`; blocks release: `false`
- **Class:** `semantic-quality`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 34 ms, changed files: `0`
- **Observed output:** Entity coverage OK
- **Source-level assertions/signals:**
  - ); function parse(file){ try { return JSON.parse(read(file)); } catch(error){ fail(`${file} is not valid JSON: ${error.message}`); } } const entities = parse(
  - ); if(!entities.organization?.name || !entities.organization?.url) fail(
  - ); if(!entities.provider?.name || !entities.provider?.role) fail(
  - ); if(!Array.isArray(entities.services) || entities.services.length < 4) fail(
  - ); if(!entities.domain?.canonicalDomain) fail(
  - ); if(!author.name || !author.organization || !author.bio) fail(
  - ); if(!org.name || !org.url || !Array.isArray(org.sameAs)) fail(
  - ); if(org.name !== entities.organization.name) fail(
  - ); if(author.organization !== entities.organization.name) fail(
  - ); const serviceNames = new Set(entities.services.map(s => s.name)); for(const required of [
  - Missing required service entity: ${required}
  - Entity coverage OK

### 19. `conversion-contract`

- **Entry:** `_ops/validators/validate_conversion_contract.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `critical-user-journey`
- **Deep-validation disposition:** `KEEP_BLOCKING_ONLY_FOR_PRIMARY_CTA_FAILURE`
- **Isolated result:** exit `0`, 37 ms, changed files: `0`
- **Observed output:** Conversion contract OK
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { fail } = require(
  - )); const forms=config.forms || {}; const allowed = new Set([forms.therapy, forms.coaching, forms.corporate, forms.groups,
  - data/query_coverage_map.json
  - )); for(const item of qmap){ if(!item.ctaTarget) fail(`Query missing ctaTarget: ${item.query}`); const target=item.ctaTarget; const internal=target.startsWith(
  - ); if(!allowed.has(target) && !internal) fail(`Unapproved external ctaTarget: ${target}`); if(internal){ const page=path.join(
  - ctaTarget internal page missing: ${target}
  - , route.replace(/^\//,
  - ${route} missing approved conversion path.
  - ); const homepageRequired = [
  - Homepage dual-pathway contract missing token: ${token}
  - ])[0]; for (const block of [individualSection, individualPathway]) { if (/trauma/i.test(block)) fail(

### 20. `training-inquiry`

- **Entry:** `_ops/validators/validate_training_inquiry_contract.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `critical-user-journey`
- **Deep-validation disposition:** `KEEP_BLOCKING`
- **Isolated result:** exit `0`, 45 ms, changed files: `0`
- **Observed output:** Inquiry, visual, runtime, and edit-audit contracts OK (2 forms, 17 locked fields traced frontend → JS → backend).
- **Source-level assertions/signals:**
  - ); const wranglerToml = fs.existsSync(wranglerPath) ? fs.readFileSync(wranglerPath,
  - , statusId:
  - group-inquiry-status
  - ], forbiddenFields: [
  - ${contract.label} Cloudflare Function missing: ${contract.fnPath}
  - '][^>]*>`, 'i'); if (!formPattern.test(html)) fail(`${contract.label} form missing.`); const endpointPattern = new RegExp(`action=[
  - ']`); if (!endpointPattern.test(html)) fail(`${contract.label} form must post to ${contract.endpoint}.`); if (!/method=[
  - ']/i.test(html)) fail(`${contract.label} form method must be POST.`); const formBlockMatch = html.match(new RegExp(String.raw`<form[^>]+id=[
  - )); if (!formBlockMatch) fail(`${contract.label} form block missing.`); const formBlock = formBlockMatch[0]; const formFields = Array.from(formBlock.matchAll(/name=["
  - ${contract.label} must expose exact fields in order. Expected ${contract.fields.join(', ')}; got ${uniqueFields.join(', ')}
  - ${contract.label} contains stale Training-only fields: ${forbidden.join(', ')}
  - ${contract.label} frontend field missing: ${field}

### 21. `source-health`

- **Entry:** `_ops/validators/validate_source_health.js`
- **Registered severity:** `SOFT_WARNING`; blocks release: `false`
- **Class:** `input-quality`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 36 ms, changed files: `0`
- **Observed output:** Source health contract OK
- **Source-level assertions/signals:**
  - ); const { warn: reportFindings } = require(
  - ; let health = null; if (!fs.existsSync(file)) finding(
  - )); } catch (error) { finding(`source_health.json is invalid JSON: ${error.message}`); } } if (health) { if (!health.generatedAt || !health.mode || !Array.isArray(health.sources)) finding(
  - Invalid ingestion mode: ${health.mode}
  - ) finding(`Invalid source health entry: ${JSON.stringify(source)}`); } } if (warnings.length) reportFindings(warnings, `${warnings.length}-source-health-warning(s)`); else console.log(

### 22. `ingestion-freshness`

- **Entry:** `_ops/validators/validate_ingestion_freshness.js`
- **Registered severity:** `INFO`; blocks release: `false`
- **Class:** `observability`
- **Deep-validation disposition:** `KEEP_INFO`
- **Isolated result:** exit `0`, 35 ms, changed files: `0`
- **Observed output:** Ingestion freshness contract OK
- **Source-level assertions/signals:**
  - ); const { warn: reportFindings } = require(
  - ${file} missing.
  - )); } catch (error) { finding(`${file} is invalid JSON: ${error.message}`); return null; } } for (const file of [
  - ${file} has invalid generatedAt.

### 23. `query-signal-schema`

- **Entry:** `_ops/validators/validate_query_signal_schema.js`
- **Registered severity:** `SOFT_WARNING`; blocks release: `false`
- **Class:** `input-contract`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 34 ms, changed files: `0`
- **Observed output:** Query signal schema OK
- **Source-level assertions/signals:**
  - ); const { warn: reportFindings } = require(
  - ); const warnings = []; function finding(message) { warnings.push(`QUERY SIGNAL SCHEMA WARNING: ${message}`); } const file =
  - ; let payload = null; if (!fs.existsSync(file)) finding(
  - )); } catch (error) { finding(`normalized_query_signals.json is invalid JSON: ${error.message}`); } } const signals = Array.isArray(payload?.signals) ? payload.signals : []; if (payload && !Array.isArray(payload.signals)) finding(
  - Signal missing ${key}: ${JSON.stringify(signal)}
  - Signal tags must be array: ${signal.id}
  - Query signal schema OK

### 24. `query-clusters`

- **Entry:** `_ops/validators/validate_query_clusters.js`
- **Registered severity:** `INFO`; blocks release: `false`
- **Class:** `observability`
- **Deep-validation disposition:** `KEEP_INFO`
- **Isolated result:** exit `0`, 34 ms, changed files: `0`
- **Observed output:** Query cluster contract OK
- **Source-level assertions/signals:**
  - ); const { warn: reportFindings } = require(
  - ; let payload = null; if (!fs.existsSync(file)) finding(
  - query_clusters.json is invalid JSON: ${error.message}
  - clusters must be a non-empty array.
  - ) { finding(`Invalid cluster: ${JSON.stringify(cluster)}`); } } if (warnings.length) reportFindings(warnings, `${warnings.length}-query-cluster-info-finding(s)`); else console.log(

### 25. `fanout-candidates`

- **Entry:** `_ops/validators/validate_fanout_candidates.js`
- **Registered severity:** `INFO`; blocks release: `false`
- **Class:** `observability`
- **Deep-validation disposition:** `KEEP_INFO`
- **Isolated result:** exit `0`, 32 ms, changed files: `0`
- **Observed output:** Fanout candidates contract OK
- **Source-level assertions/signals:**
  - ); const { warn: reportFindings } = require(
  - ; let payload = null; if (!fs.existsSync(file)) finding(
  - )); } catch (error) { finding(`fanout_candidates.json is invalid JSON: ${error.message}`); } } const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []; if (payload && !Array.isArray(payload.candidates)) finding(
  - Invalid fanout candidate: ${JSON.stringify(candidate)}

### 26. `social-firehose`

- **Entry:** `_ops/validators/validate_social_firehose_contract.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `legacy-approval-governance`
- **Deep-validation disposition:** `REPLACE_FOR_FULL_SAFE_AUTONOMY`
- **Isolated result:** exit `0`, 36 ms, changed files: `0`
- **Observed output:** Social firehose contract OK
- **Source-level assertions/signals:**
  - ); const { warn: reportFindings } = require(
  - ${file} missing.
  - )); } catch (error) { finding(`${file} is invalid JSON: ${error.message}`); return null; } } const policy = readJson(
  - ); const required = [
  - require_cluster_score_minimum
  - Policy missing ${key}
  - max_items_per_source_per_run must be <= 25.
  - max_pages_generated_per_run must be <= 5.

### 27. `throttle-contract`

- **Entry:** `_ops/validators/validate_throttle_contract.js`
- **Registered severity:** `SOFT_WARNING`; blocks release: `false`
- **Class:** `provider-resilience`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 33 ms, changed files: `0`
- **Observed output:** Throttle contract OK
- **Source-level assertions/signals:**
  - ); const { warn: reportFindings } = require(
  - ); const warnings = []; function finding(message) { warnings.push(`THROTTLE CONTRACT WARNING: ${message}`); } if (!fs.existsSync(
  - )); } catch (error) { finding(`config/social_ingestion_policy.json is missing or invalid: ${error.message}`); } const throttle = policy?.throttle || {}; if (policy) { if (typeof throttle.delayMs !==

### 28. `content-briefs`

- **Entry:** `_ops/validators/validate_content_brief_candidates.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `legacy-approval-governance`
- **Deep-validation disposition:** `REPLACE_FOR_FULL_SAFE_AUTONOMY`
- **Isolated result:** exit `0`, 32 ms, changed files: `0`
- **Observed output:** Content brief candidate advisory OK
- **Source-level assertions/signals:**
  - ); const { warn: reportFindings } = require(
  - ); if (!c.llmGeneratedRequired) warn(

### 29. `publish-state`

- **Entry:** `_ops/validators/validate_publish_state.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `publishing-safety`
- **Deep-validation disposition:** `REWRITE_FOR_AUTONOMY_STATE_MACHINE`
- **Isolated result:** exit `0`, 33 ms, changed files: `0`
- **Observed output:** Publish state OK
- **Source-level assertions/signals:**
  - )); const allowed = new Set([
  - Manifest item missing core fields: ${JSON.stringify(item)}
  - Invalid status ${item.status}
  - && item.validationPassed !== true) fail(`Non-draft item must be validation-passed: ${item.id}`); if (item.status ===
  - && !item.requiresFooter) fail(`Published item missing footer flag ${item.id}`); } console.log(

### 30. `policy-compliance`

- **Entry:** `_ops/validators/validate_policy_compliance.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `content-safety`
- **Deep-validation disposition:** `KEEP_BLOCKING_FOR_PROHIBITED_CONTENT`
- **Isolated result:** exit `0`, 55 ms, changed files: `0`
- **Observed output:** Policy compliance OK
- **Source-level assertions/signals:**
  - ).toLowerCase(); for(const phrase of banned){ if(html.includes(phrase)) fail(`Policy phrase found: ${phrase} in ${file}`);} if(!html.includes(
  - )) fail(`Missing disclaimer/footer language in ${file}`); } console.log(

### 31. `content-plan`

- **Entry:** `_ops/validators/validate_content_plan_2026.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `velocity-contract`
- **Deep-validation disposition:** `KEEP_BLOCKING_FOR_CADENCE_DRIFT`
- **Isolated result:** exit `0`, 37 ms, changed files: `0`
- **Observed output:** 2026 content plan loaded: daily=177, weekly=37, monthly=9, quarterly=4. Latest scheduledAt=2027-01-01T13:00:00.000Z
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { fail } = require(
  - CONTENT PLAN FAIL: ${type} manifest count ${counts[type] || 0} < expected ${n}
  - CONTENT PLAN FAIL: latest scheduledAt ${lastPublish} does not reach 2026-12-31

### 32. `recent-resources`

- **Entry:** `_ops/validators/validate_recent_resources.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `content-discovery`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 42 ms, changed files: `0`
- **Observed output:** Recent resources contract OK (4 newest published resources selected).
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { warn } = require(
  - ); const { selectRecentPublishedResources } = require(
  - ); } const eligible = manifest .filter((item) => item?.validationPassed === true && item?.status ===
  - Expected ${Math.min(4, eligible.length)} recent cards, selected ${actual.length}.
  - Newest-four order mismatch. Expected ${expectedIds.join(', ') || '(none)'}; got ${actualIds.join(', ') || '(none)'}.

### 33. `word-counts`

- **Entry:** `_ops/validators/validate_resource_word_counts.js`
- **Registered severity:** `SOFT_WARNING`; blocks release: `false`
- **Class:** `petty-quality-proxy`
- **Deep-validation disposition:** `DOWNGRADE_INFO`
- **Isolated result:** exit `0`, 60 ms, changed files: `0`
- **Observed output:** Resource word count warnings clean (227 pages checked, 25% margin).
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { fail, warn: reportFindings } = require(
  - WORD COUNT FAIL: missing source page for ${item.id}: ${file}

### 34. `admin-previews`

- **Entry:** `_ops/validators/validate_admin_preview_links.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `legacy-approval-admin`
- **Deep-validation disposition:** `REPLACE_FOR_CONTROL_ROOM`
- **Isolated result:** exit `0`, 36 ms, changed files: `0`
- **Observed output:** Admin preview manifest OK (227 items checked, 132 review previews, 95 live public items).
- **Source-level assertions/signals:**
  - ); const { warn: reportFindings } = require(
  - )); const allowedTypes = new Set([
  - Manifest item ${item.id} missing slug/publicPath/contentType
  - Manifest item ${item.id} has invalid contentType: ${item.contentType}
  - Manifest item ${item.id} uses stale cadence route in ${field}: ${item[field]}
  - Manifest item ${item.id} publicPath must match slug: ${item.publicPath} !== ${item.slug}
  - Manifest item ${item.id} public source page missing: ${item.publicPath}
  - Manifest item ${item.id} is published and should not require a previewPath
  - Manifest item ${item.id} missing previewPath for unpublished review item
  - Manifest item ${item.id} previewPath must be /preview + publicPath

### 35. `admin-generated-queue`

- **Entry:** `_ops/validators/validate_admin_generated_queue.js`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `legacy-approval-admin`
- **Deep-validation disposition:** `REPLACE_FOR_AUTONOMY_QUEUE`
- **Isolated result:** exit `0`, 32 ms, changed files: `0`
- **Observed output:** Admin generated content queue OK (6 candidates, 14 queue items).
- **Source-level assertions/signals:**
  - ); const requiredHtml = [
  - Admin page missing generated content queue surface: ${token}
  - Admin JS missing generated content queue wiring: ${token}
  - Candidate missing required admin fields: ${candidate.id || 'unknown'}
  - Candidate must remain approval-gated: ${candidate.id}
  - Candidate must require LLM-generated/humanized drafting: ${candidate.id}

### 36. `workflow-contracts`

- **Entry:** `_ops/validators/validate_workflows.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `release-integrity`
- **Deep-validation disposition:** `KEEP_BLOCKING_FOR_REAL_WRITER_SAFETY`
- **Isolated result:** exit `0`, 33 ms, changed files: `0`
- **Observed output:** Workflow contracts OK (11 workflows, 5 writer workflows traced).
- **Source-level assertions/signals:**
  - )); const workflowsDir = path.join(process.cwd(),
  - workflows
  - )); const writeWorkflows = []; const registry = JSON.parse(read(
  - )); const leafScripts = new Set(registry.checks.map((check) => check.npmScript)); for (const file of files) { const full = path.join(workflowsDir, file); const content = fs.readFileSync(full,
  - Workflow ${file} references missing npm script: ${script}
  - Workflow ${file} invokes leaf validator ${script} directly; use a registered validation profile.
  - Workflow ${file} missing actions/checkout@v4
  - Workflow ${file} missing actions/setup-node@v4
  - Writer workflow ${file} must use shared hicks-consulting-content-automation concurrency group.
  - Writer workflow ${file} must pull latest main before mutating generated outputs.
  - Expected content-publish and social-ingestion writer workflows to be present.
  - ); const buildStep = buildWorkflow.indexOf(

### 37. `indexnow`

- **Entry:** `_ops/validators/validate_indexnow_contract.js`
- **Registered severity:** `SOFT_WARNING`; blocks release: `false`
- **Class:** `distribution`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 36 ms, changed files: `0`
- **Observed output:** IndexNow post-publish distribution contract OK
- **Source-level assertions/signals:**
  - )); const requiredScripts = [
  - IndexNow contract fail: package.json missing script ${script}
  - .github/workflows/indexnow-submit.yml
  - IndexNow contract fail: missing ${file}
  - IndexNow contract fail: build must copy root indexnow.txt into dist for key verification.
  - IndexNow contract fail: workflow must run only after Content Publish.
  - /.test(workflow)) fail(
  - ); if (!/workflow_dispatch:/.test(workflow)) fail(
  - IndexNow contract fail: workflow missing ${command}.
  - IndexNow contract fail: workflow must commit durable distribution receipts.
  - IndexNow contract fail: workflow must upload distribution evidence.
  - IndexNow contract fail: post-publish runner missing ${token}.

### 38. `digital-products-contract`

- **Entry:** `_ops/validators/validate_digital_products_contract.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `commerce-contract`
- **Deep-validation disposition:** `KEEP_BLOCKING`
- **Isolated result:** exit `0`, 34 ms, changed files: `0`
- **Observed output:** Digital products catalog contract OK
- **Source-level assertions/signals:**
  - ); const path = require(
  - ); const { fail } = require(
  - )); } catch (error) { fail(`${file} is invalid JSON: ${error.message}`); } } const root = process.cwd(); const catalogPath = path.join(root,
  - ); const schemaPath = path.join(root,
  - ); if (!fs.existsSync(catalogPath)) fail(
  - ); if (!fs.existsSync(schemaPath)) fail(
  - ); const catalog = readJson(catalogPath); const schema = readJson(schemaPath); if (!Array.isArray(catalog.products)) fail(
  - ); const ids = new Set(); const featuredByType = new Map(); for (const item of catalog.products) { for (const field of schema.requiredProductFields) { if (!(field in item)) fail(`Product ${item.id ||
  - ); } if (ids.has(item.id)) fail(
  - ); ids.add(item.id); if (!schema.allowedProductTypes.includes(item.productType)) fail(
  - ); if (!schema.allowedStatuses.includes(item.status)) fail(
  - ); if (!schema.allowedCheckoutStatuses.includes(item.checkoutStatus)) fail(

### 39. `product-routes`

- **Entry:** `_ops/validators/validate_product_routes.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `commerce-user-journey`
- **Deep-validation disposition:** `KEEP_BLOCKING`
- **Isolated result:** exit `0`, 33 ms, changed files: `0`
- **Observed output:** Digital product route contract OK
- **Source-level assertions/signals:**
  - ); const { fail } = require(
  - ); const requiredFiles = [
  - Missing required product route file: ${file}
  - Resources page missing token: ${token}
  - CSS missing digital route token: ${token}
  - ); for (const route of [
  - Build script must include public route: ${route}
  - Digital product route contract OK

### 40. `product-upload-contract`

- **Entry:** `_ops/validators/validate_product_upload_contract.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `commerce-admin-security`
- **Deep-validation disposition:** `KEEP_BLOCKING`
- **Isolated result:** exit `0`, 32 ms, changed files: `0`
- **Observed output:** Digital product upload/admin contract OK
- **Source-level assertions/signals:**
  - ); const { fail } = require(
  - GitHub is not required for normal product publishing
  - Admin digital products page missing token: ${token}
  - Admin digital products page must not expose deprecated token UX: ${forbidden}
  - Smart filters must appear above the add/update product form.
  - GitHub backup tools must remain visually secondary to normal product editing.
  - )) fail(
  - x-admin-password-hash
  - confirmStatusChange
  - GitHub was not changed
  - Admin JS missing token: ${token}
  - Admin JS must not depend on deprecated visible API token auth.

### 41. `product-cover-contract`

- **Entry:** `_ops/validators/validate_product_cover_contract.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `commerce-quality`
- **Deep-validation disposition:** `KEEP_WARNING`
- **Isolated result:** exit `0`, 31 ms, changed files: `0`
- **Observed output:** Digital product cover contract OK
- **Source-level assertions/signals:**
  - ); const { fail } = require(
  - Public digital products JS missing cover fallback token: ${token}
  - )) fail(
  - API cover contract missing token: ${token}

### 42. `product-api-behavior`

- **Entry:** `_ops/validators/validate_product_api_behavior.js`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `commerce-runtime`
- **Deep-validation disposition:** `KEEP_BLOCKING`
- **Isolated result:** exit `0`, 32 ms, changed files: `0`
- **Observed output:** Digital product API behavior contract OK
- **Source-level assertions/signals:**
  - ); const { fail } = require(
  - ); const requiredShared = [
  - x-admin-password-hash
  - Admin password did not match.
  - merged.checkoutStatus = 'live';
  - Published premium downloads require live checkout status.
  - status === 'published' ? 'live' : 'ready'
  - Digital products shared API missing behavior guard: ${token}
  - Digital products shared API still references deprecated auth: ${forbidden}
  - Worker still references deprecated auth: ${forbidden}
  - Worker must accept password-hash auth for digital product write endpoints.
  - checkoutStatus: item.productType === 'premium' ? 'live' : item.checkoutStatus

### 43. `authority-fanout`

- **Entry:** `scripts/authority_scale/validate_max_fanout.mjs`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `planning-capacity`
- **Deep-validation disposition:** `KEEP_INFO_NOT_PRODUCT_BLOCKER`
- **Isolated result:** exit `0`, 685 ms, changed files: `0`
- **Observed output:** {;   "ok": true,;   "records": 100000,;   "unique_queries": 100000,;   "shards": 20,;   "publication_authority": "EXISTING_CLIENT_ADMIN_AND_APPROVAL_SYSTEM",;   "errors": []; }
- **Source-level assertions/signals:**
  - )),errors=[],q=new Set(),ids=new Set();let n=0;for(const sh of idx.shards||[]){if(!fs.existsSync(sh.path)){errors.push(`missing:${sh.path}`);continue;}const b=fs.readFileSync(sh.path),h=crypto.createHash(

### 44. `kpi-truth`

- **Entry:** `scripts/authority_scale/validate_kpi_truth.mjs`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `truthfulness`
- **Deep-validation disposition:** `KEEP_BLOCKING_FOR_FALSE_CLAIMS`
- **Isolated result:** exit `0`, 43 ms, changed files: `0`
- **Observed output:** {;   "ok": true,;   "verified_citations": 0,;   "events": 0,;   "errors": []; }
- **Source-level assertions/signals:**
  - missing:${k}

### 45. `protected-editorial-core`

- **Entry:** `scripts/authority_scale/validate_protected_editorial_core.mjs`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `preservation`
- **Deep-validation disposition:** `REWRITE_TO_ALLOW_SCOPED_VERSIONED_REPAIR`
- **Isolated result:** exit `0`, 45 ms, changed files: `0`
- **Observed output:** {;   "ok": true,;   "repo": "hicks",;   "protected_files": 4,;   "baseline_editorial_records": 227,;   "current_editorial_records": 227,;   "policy": "PROTECTED_CLIENT_EDITORIAL_CORE_DO_NOT_MUTATE",;   "state_policy": "PRESERVE_BASELINE_EDITORIAL_IDENTITY_ALLOW_NATIVE_STATUS_TRANSITIONS",;   "errors": []; }
- **Source-level assertions/signals:**
  - missing:${x.path}
  - drift:${x.path}
  - missing-baseline-editorial-record:${rec.id}
  - baseline-editorial-identity-drift:${rec.id}

### 46. `improvement-recommendations`

- **Entry:** `scripts/authority_scale/validate_improvement_recommendations.mjs`
- **Registered severity:** `STRONG_WARNING`; blocks release: `false`
- **Class:** `advisory`
- **Deep-validation disposition:** `KEEP_INFO`
- **Isolated result:** exit `0`, 35 ms, changed files: `0`
- **Observed output:** {;   "ok": true,;   "recommendations": 40,;   "twin_agent_installed": false,;   "errors": []; }
- **Source-level assertions/signals:**
  - authority:${i.route}
  - lessons:${i.route}

### 47. `authority-distribution`

- **Entry:** `scripts/authority_scale/validate_distribution_manifest.mjs`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `distribution-contract`
- **Deep-validation disposition:** `KEEP_WARNING_UNTIL_PROVIDER_PROVEN`
- **Isolated result:** exit `0`, 35 ms, changed files: `0`
- **Observed output:** {;   "ok": true,;   "url_count": 121,;   "provider_success_claimed": false,;   "errors": []; }
- **Source-level assertions/signals:**
  - ; const errors = []; const required = [
  - .github/workflows/indexnow-submit.yml
  - missing:${file}
  - ).split(/\r?\n/).map((x) => x.trim()).filter(Boolean); const workflow = fs.readFileSync(
  - ); if (manifest.url_count !== batch.length) errors.push(`count:${manifest.url_count}/${batch.length}`); if (!workflow.includes(
  - ) || !workflow.includes(
  - ); if (!workflow.includes("github.event.workflow_run.conclusion ==
  - workflow-command:${command}
  - workflow-durable-commit
  - ].includes(receipt.indexnow?.status) && ![
  - ].includes(receipt.gsc_sitemap_submission?.status) && ![
  - ].includes(receipt.priority_url_inspection?.status)) errors.push(

### 48. `editorial-continuity`

- **Entry:** `scripts/continuity/validate_editorial_continuity.mjs`
- **Registered severity:** `HARD_FAIL`; blocks release: `true`
- **Class:** `legacy-approval-continuity`
- **Deep-validation disposition:** `REWRITE_FOR_AUTONOMY_AND_LOCKED_VELOCITY`
- **Isolated result:** exit `0`, 35 ms, changed files: `0`
- **Observed output:** {;   "ok": true,;   "schema_version": "1.1",;   "run_date": "2026-08-03",;   "horizon_days": 120,;   "last_manifest_scheduled_date": "2027-01-01",;   "prior_coverage_end": "2027-01-01",;   "target_coverage_end": "2026-12-01",;   "planned_slots_needed": 0,;   "candidates_added": 0,;   "dry_run": false,;   "cadence_preserved": {;     "daily": "weekday insights",;     "weekly": "Tuesday article",;     "monthly": "15th guide",;     "quarterly": "Mar/Jun/Sep/Dec 20th whitepaper";   },;   "publication_authority": "EXISTING_HICKS_ADMIN_APPROVAL_FLOW",;   "continuity_candidates": 0,;   "errors": []; }
- **Source-level assertions/signals:**
  - invalid-continuity-status:${x.id}
  - approval-gate-missing:${x.id}
  - invalid-future-slot:${x.id}
  - invalid-cadence:${x.id}

## Validation gaps the new baseline must add

### Critical end-to-end behavior
- Full candidate lifecycle from signal to admitted candidate to draft to Safe Harbor result to cadence-slot scheduling to publication.
- Repair loop with exact finding scope, bounded retries, skip behavior, and no unrelated-lane blockage.
- Immutable editorial velocity under replenishment, replacement, retry, and failure conditions.
- Post-publication notification email payload, delivery retry, and non-rollback behavior when email fails.
- Feedback-to-revision path with factual/protected-field gates.
- Accepted-output freeze, thaw, version receipts, and rollback.
- Server-side admin login, signed session, CSRF, rate limiting, allowlisted actions, and audit receipts.
- Worker/API behavior tests for every mutating endpoint.
- Browser-level journeys for NAV, primary CTAs, Memphis pages, forms, admin, and digital products.
- GSC/Bing connector state tests: disconnected, stale, warning, healthy, and invalid credentials.
- Competitor observation provider boundaries and provenance.
- Self-healing technical repairs and protected-content skips.
- Clean-build parity and cold/warm verdict equivalence.

### Search-page and preservation proof
- Existing H1 and section-order preservation for all NAV pages.
- Strategic Memphis and Black woman therapist coverage without exact-phrase stuffing.
- No unsupported physical-office claim.
- One primary query owner per governed query.
- New Memphis pages are indexable, in sitemap, contextually linked, and not in primary NAV.

## Severity reset rule

- **Block release:** broken runtime, unsafe publishing, data loss, secret/auth failure, invalid provider mutation, missing required route, prohibited content, corrupted manifest/state, cadence drift, false external-outcome claims.
- **Warning:** SEO quality, metadata, crawl, non-primary broken links, content similarity, weak answer extraction, stale measurements.
- **Info:** fanout size, word-count preference, optional LLM surfaces, planning recommendations, disconnected providers before activation.

## Build parity finding

Two clean builds produced 379 files each. One file differed: `dist/data/agency/dashboard.json`. The only differing value was `generatedAt`, proving the current build is not byte-deterministic. The implementation should use a stable source timestamp or exclude observation timestamps from deterministic build artifacts.

## Status

**DEEP VALIDATION BASELINE COMPLETE — NEW SITE-DRIVEN TESTS REQUIRED DURING IMPLEMENTATION**
