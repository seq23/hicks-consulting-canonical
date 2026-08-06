# Hicks Deep Validation — Final Isolation Report

**Started:** 2026-08-06T22:45:59.440909+00:00  
**Completed:** 2026-08-06T22:46:08.964264+00:00  
**Registered checks:** 57  
**Pass:** 56  
**Finding processes:** 1  
**Execution failures:** 0  
**Source-mutating checks:** 0

## Validation authority

The rebuilt public site and approved runtime contracts define correctness. These validators were treated as independent proof probes. They were not allowed to create scope, change publishing velocity, or turn aspirational quality scores into product law.

## Local pre-push behavior

The local pre-push wrapper performs:

1. `npm run build`
2. `npm run validate:all`

The `all` profile executes every enabled registered check in canonical order. The isolation below executes each leaf separately and hashes the source tree before and after each run.

## Isolation summary

- All 57 registered checks completed without process failure.
- 56 checks returned clean pass.
- 1 checks emitted the registered finding protocol.
- Source-mutating checks: none.

## Check ledger

| # | Check | Severity | Isolated result | Seconds | Source mutated | Product classification |
|---:|---|---|---|---:|---|---|
| 1 | `validation-registry` | HARD_FAIL | PASS | 0.035 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 2 | `orchestrator-contract` | HARD_FAIL | PASS | 0.384 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 3 | `preflight` | HARD_FAIL | PASS | 0.038 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 4 | `publisher-contract` | HARD_FAIL | PASS | 0.033 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 5 | `canonical-url` | STRONG_WARNING | PASS | 0.044 | no | non-blocking quality/provider-readiness advisory |
| 6 | `seo-metadata` | STRONG_WARNING | PASS | 0.062 | no | non-blocking quality/provider-readiness advisory |
| 7 | `agency-infrastructure` | HARD_FAIL | PASS | 0.082 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 8 | `agency-quality` | STRONG_WARNING | FINDING | 0.046 | no | non-blocking quality/provider-readiness advisory |
| 9 | `lead-magnet` | HARD_FAIL | PASS | 0.035 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 10 | `form-database` | HARD_FAIL | PASS | 0.033 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 11 | `crawl-contract` | STRONG_WARNING | PASS | 0.034 | no | non-blocking quality/provider-readiness advisory |
| 12 | `sitemap-parity` | STRONG_WARNING | PASS | 0.062 | no | non-blocking quality/provider-readiness advisory |
| 13 | `internal-links` | STRONG_WARNING | PASS | 0.055 | no | non-blocking quality/provider-readiness advisory |
| 14 | `hidden-llm-surfaces` | SOFT_WARNING | PASS | 0.092 | no | non-blocking advisory |
| 15 | `llm-ingestion-routes` | SOFT_WARNING | PASS | 0.035 | no | non-blocking advisory |
| 16 | `query-traceability` | SOFT_WARNING | PASS | 0.035 | no | non-blocking advisory |
| 17 | `above-fold` | STRONG_WARNING | PASS | 0.048 | no | non-blocking quality/provider-readiness advisory |
| 18 | `entity-coverage` | SOFT_WARNING | PASS | 0.032 | no | non-blocking advisory |
| 19 | `conversion-contract` | STRONG_WARNING | PASS | 0.036 | no | non-blocking quality/provider-readiness advisory |
| 20 | `training-inquiry` | HARD_FAIL | PASS | 0.038 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 21 | `source-health` | SOFT_WARNING | PASS | 0.032 | no | non-blocking advisory |
| 22 | `ingestion-freshness` | INFO | PASS | 0.032 | no | informational observation |
| 23 | `query-signal-schema` | SOFT_WARNING | PASS | 0.035 | no | non-blocking advisory |
| 24 | `query-clusters` | INFO | PASS | 0.031 | no | informational observation |
| 25 | `fanout-candidates` | INFO | PASS | 0.033 | no | informational observation |
| 26 | `social-firehose` | STRONG_WARNING | PASS | 0.032 | no | non-blocking quality/provider-readiness advisory |
| 27 | `throttle-contract` | SOFT_WARNING | PASS | 0.033 | no | non-blocking advisory |
| 28 | `content-briefs` | STRONG_WARNING | PASS | 0.031 | no | non-blocking quality/provider-readiness advisory |
| 29 | `publish-state` | HARD_FAIL | PASS | 0.035 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 30 | `policy-compliance` | HARD_FAIL | PASS | 0.061 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 31 | `content-plan` | STRONG_WARNING | PASS | 0.034 | no | non-blocking quality/provider-readiness advisory |
| 32 | `recent-resources` | STRONG_WARNING | PASS | 0.040 | no | non-blocking quality/provider-readiness advisory |
| 33 | `word-counts` | SOFT_WARNING | PASS | 0.064 | no | non-blocking advisory |
| 34 | `admin-previews` | STRONG_WARNING | PASS | 0.037 | no | non-blocking quality/provider-readiness advisory |
| 35 | `admin-generated-queue` | STRONG_WARNING | PASS | 0.033 | no | non-blocking quality/provider-readiness advisory |
| 36 | `workflow-contracts` | HARD_FAIL | PASS | 0.035 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 37 | `indexnow` | SOFT_WARNING | PASS | 0.033 | no | non-blocking advisory |
| 38 | `digital-products-contract` | HARD_FAIL | PASS | 0.034 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 39 | `product-routes` | HARD_FAIL | PASS | 0.032 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 40 | `product-upload-contract` | HARD_FAIL | PASS | 0.033 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 41 | `product-cover-contract` | HARD_FAIL | PASS | 0.032 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 42 | `product-api-behavior` | HARD_FAIL | PASS | 0.032 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 43 | `authority-fanout` | HARD_FAIL | PASS | 0.568 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 44 | `kpi-truth` | HARD_FAIL | PASS | 0.036 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 45 | `protected-editorial-core` | HARD_FAIL | PASS | 0.048 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 46 | `improvement-recommendations` | STRONG_WARNING | PASS | 0.036 | no | non-blocking quality/provider-readiness advisory |
| 47 | `authority-distribution` | HARD_FAIL | PASS | 0.037 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 48 | `editorial-continuity` | HARD_FAIL | PASS | 0.036 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 49 | `site-intent-preservation` | HARD_FAIL | PASS | 0.039 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 50 | `memphis-search-surfaces` | HARD_FAIL | PASS | 0.032 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 51 | `velocity-immutability` | HARD_FAIL | PASS | 0.035 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 52 | `autonomy-contract` | HARD_FAIL | PASS | 0.032 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 53 | `safe-harbor-behavior` | HARD_FAIL | PASS | 0.051 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 54 | `admin-security-behavior` | HARD_FAIL | PASS | 0.065 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 55 | `notification-freeze-behavior` | HARD_FAIL | PASS | 0.041 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 56 | `build-determinism` | HARD_FAIL | PASS | 1.149 | no | release-blocking product/safety/security/data/cadence/truth probe |
| 57 | `autonomy-cycle-e2e` | HARD_FAIL | PASS | 0.095 | no | release-blocking product/safety/security/data/cadence/truth probe |

## Non-blocking findings

The isolated leaf run records findings only when a validator itself emits the registered marker. Provider disconnection and the existing agency content-quality score are intentionally handled as non-blocking evidence in the composite run. They are not converted into fake success and do not redefine the product.

## Machine-readable evidence

`reports/HICKS_DEEP_VALIDATION_ISOLATION_FINAL.json` contains every entrypoint, scope, duration, exit code, finding marker, output tail, pre/post source hash, and mutation result.

