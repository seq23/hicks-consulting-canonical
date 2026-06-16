# Validation Matrix Runbook

**Repository:** `hicks-consulting-canonical`  
**Status:** AUTHORITATIVE  
**Executable matrix:** `/_repo_validation_matrix.json`  
**Registry authority:** `/_repo_validation_registry.json`

## 1. Purpose

The matrix is the execution plan. It does not own severity or validator metadata; those live only in the registry. Each profile lists registered business checks in deterministic order. The orchestrator automatically runs the hard-fail registry bootstrap before every profile or single-check execution.

## 2. Profiles

| Profile | Package command | Profile checks | Purpose |
|---|---|---:|---|
| `all` | `validate:all` | 35 | Every enabled registered validator in canonical order. |
| `ingestion` | `validate:ingestion` | 8 | Content-intelligence ingestion, observability, provider-resilience, and publishing-governance checks. |
| `sitemap-indexing` | `validate:profile:sitemap-indexing` | 3 | Crawler, sitemap, and hidden LLM surface checks for the indexing workflow. |
| `indexnow` | `validate:profile:indexnow` | 1 | IndexNow contract check after emission. |

## 3. Workflow invocation law

- GitHub Actions must invoke `validate:all` or another declared composite profile.
- Workflows may not invoke `validate:canonical`, `validate:sitemap`, `validate:indexnow`, or any other leaf check directly.
- Direct leaf invocation bypasses registry severity and is therefore a hard failure.

## 4. Commands

- Full release profile: `npm run validate:all`
- Ingestion profile: `npm run validate:ingestion`
- Sitemap/indexing profile: `npm run validate:profile:sitemap-indexing`
- IndexNow profile: `npm run validate:profile:indexnow`
- Registry integrity: `npm run validate:registry`

## 5. Result rules

- A registered hard-fail finding returns non-zero.
- Strong warnings, soft warnings, and info findings return zero.
- Any validator execution failure returns non-zero regardless of registered severity.
- The full summary reports pass, hard findings, execution hard failures, strong warnings, soft warnings, and info findings separately.
