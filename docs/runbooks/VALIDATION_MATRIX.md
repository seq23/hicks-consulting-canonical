# Validation Matrix Runbook

**Repository:** `hicks-consulting-canonical`  
**Executable matrix:** `/_repo_validation_matrix.json`  
**Registry authority:** `/_repo_validation_registry.json`  
**Deep behavior map:** `/docs/runbooks/DEEP_VALIDATION_MATRIX.md`

## 1. Authority

The product and its approved operating contracts define correctness. The matrix schedules independent proof probes; it does not create product requirements.

Severity lives only in the registry. Profiles define deterministic execution order. The orchestrator always runs the registry bootstrap and treats syntax errors, missing entrypoints, process crashes, unsupported exit codes, and protocol violations as execution hard failures.

## 2. Profiles

| Profile | Package command | Checks | Purpose |
|---|---|---:|---|
| `all` | `npm run validate:all` | 58 | Every enabled registered validator in canonical order |
| `deep-autonomy` | `npm run validate:deep` | 58 | Full local suite plus site-preservation, autonomy, security, cadence, E2E, notification/freeze, and deterministic-build proof |
| `ingestion` | `npm run validate:ingestion` | 8 | Query/content signal ingestion contracts |
| `sitemap-indexing` | `npm run validate:profile:sitemap-indexing` | 3 | Crawl, sitemap, and LLM ingestion routes |
| `indexnow` | `npm run validate:profile:indexnow` | 1 | IndexNow artifact contract |
| `agency` | `npm run validate:profile:agency` | 2 | Growth infrastructure plus non-blocking SEO/AEO/GEO quality findings |
| `digital-products` | `npm run validate:profile:digital-products` | 5 | Catalog, public routes, secure admin upload, cover, and API behavior |
| `authority-modernization` | `npm run validate:authority-modernization` | 6 | Fanout truth, KPI truth, protected core, recommendations, distribution, and continuity |

## 3. CI invocation law

GitHub Actions invoke only registered composite profiles. Leaf validators may be run locally for diagnosis, but workflows may not bypass the registry severity and finding protocol.

## 4. Result rules

- Real product, security, safety, cadence, data-integrity, crawl, or truth failures may block release.
- Strong/soft/info findings remain visible and return a passing profile when no hard failure exists.
- Provider unavailability is reported honestly and does not become a fake positive score.
- A validator cannot become release-blocking merely because it encodes a preference, arbitrary target, or stale governance assumption.
- Validator source-tree mutation is prohibited unless the probe explicitly operates in a temporary sandbox and leaves the repo unchanged.

## 5. Commands

```bash
npm run validate:registry
npm run validate:all
npm run validate:deep
npm run release:prepush:local
```
