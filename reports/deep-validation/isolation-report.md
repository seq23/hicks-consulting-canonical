# Hicks Admin / Agency Access Correction Isolation Report

Generated: 2026-08-06T23:03:00.000Z

## Executive result

- Registered validators isolated: **58**
- Total probes including install/build/aggregate local wrapper: **62**
- Clean passes: **59**
- Non-blocking findings: **3**
- Blocking failures: **0**
- Probes mutating authoritative source: **0**

The rebuilt site and runtime contract are the driver. Validators are evidence probes only. No advisory score, word-count preference, optional LLM surface, or disconnected provider can redesign or block the product.

## Isolation method

- Every validator ran in a fresh disposable repository copy.
- Source hashes were captured before and after each probe.
- Exact changed paths were recorded.
- Release gates (`npm ci`, production build), every registered check, `validate:all`, and the exact local pre-push wrapper were isolated.

## Probe ledger

| Probe | Kind | Registered severity | Exit | Result | Finding | Source mutated | Duration | Classification |
|---|---|---:|---:|---|---|---|---:|---|
| `dependency-install` | release_gate | HARD_FAIL | 0 | PASS | no | no | 0.223s | release_gate |
| `production-build` | release_gate | HARD_FAIL | 0 | PASS | no | no | 0.606s | release_gate |
| `validation-registry` | validator | HARD_FAIL | 0 | PASS | no | no | 0.07s | product_safety_or_integrity |
| `orchestrator-contract` | validator | HARD_FAIL | 0 | PASS | no | no | 0.563s | product_safety_or_integrity |
| `preflight` | validator | HARD_FAIL | 0 | PASS | no | no | 0.112s | product_safety_or_integrity |
| `publisher-contract` | validator | HARD_FAIL | 0 | PASS | no | no | 0.113s | product_safety_or_integrity |
| `canonical-url` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.123s | advisory_only |
| `seo-metadata` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.126s | advisory_only |
| `agency-infrastructure` | validator | HARD_FAIL | 0 | PASS | no | no | 0.18s | product_safety_or_integrity |
| `agency-quality` | validator | STRONG_WARNING | 0 | NON_BLOCKING_FINDING | yes | no | 0.127s | provider_unavailability_and_advisory_quality |
| `lead-magnet` | validator | HARD_FAIL | 0 | PASS | no | no | 0.109s | product_safety_or_integrity |
| `form-database` | validator | HARD_FAIL | 0 | PASS | no | no | 0.109s | product_safety_or_integrity |
| `crawl-contract` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.109s | advisory_only |
| `sitemap-parity` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.12s | advisory_only |
| `internal-links` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.138s | advisory_only |
| `hidden-llm-surfaces` | validator | SOFT_WARNING | 0 | PASS | no | no | 0.177s | advisory_only |
| `llm-ingestion-routes` | validator | SOFT_WARNING | 0 | PASS | no | no | 0.109s | advisory_only |
| `query-traceability` | validator | SOFT_WARNING | 0 | PASS | no | no | 0.107s | advisory_only |
| `above-fold` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.124s | advisory_only |
| `entity-coverage` | validator | SOFT_WARNING | 0 | PASS | no | no | 0.104s | advisory_only |
| `conversion-contract` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.108s | advisory_only |
| `training-inquiry` | validator | HARD_FAIL | 0 | PASS | no | no | 0.112s | product_safety_or_integrity |
| `source-health` | validator | SOFT_WARNING | 0 | PASS | no | no | 0.106s | advisory_only |
| `ingestion-freshness` | validator | INFO | 0 | PASS | no | no | 0.108s | advisory_only |
| `query-signal-schema` | validator | SOFT_WARNING | 0 | PASS | no | no | 0.112s | advisory_only |
| `query-clusters` | validator | INFO | 0 | PASS | no | no | 0.106s | advisory_only |
| `fanout-candidates` | validator | INFO | 0 | PASS | no | no | 0.136s | advisory_only |
| `social-firehose` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.105s | advisory_only |
| `throttle-contract` | validator | SOFT_WARNING | 0 | PASS | no | no | 0.104s | advisory_only |
| `content-briefs` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.106s | advisory_only |
| `publish-state` | validator | HARD_FAIL | 0 | PASS | no | no | 0.107s | product_safety_or_integrity |
| `policy-compliance` | validator | HARD_FAIL | 0 | PASS | no | no | 0.129s | product_safety_or_integrity |
| `content-plan` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.117s | advisory_only |
| `recent-resources` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.12s | advisory_only |
| `word-counts` | validator | SOFT_WARNING | 0 | PASS | no | no | 0.138s | advisory_only |
| `admin-previews` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.116s | advisory_only |
| `admin-generated-queue` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.111s | advisory_only |
| `workflow-contracts` | validator | HARD_FAIL | 0 | PASS | no | no | 0.113s | product_safety_or_integrity |
| `indexnow` | validator | SOFT_WARNING | 0 | PASS | no | no | 0.115s | advisory_only |
| `digital-products-contract` | validator | HARD_FAIL | 0 | PASS | no | no | 0.115s | product_safety_or_integrity |
| `product-routes` | validator | HARD_FAIL | 0 | PASS | no | no | 0.115s | product_safety_or_integrity |
| `product-upload-contract` | validator | HARD_FAIL | 0 | PASS | no | no | 0.12s | product_safety_or_integrity |
| `product-cover-contract` | validator | HARD_FAIL | 0 | PASS | no | no | 0.117s | product_safety_or_integrity |
| `product-api-behavior` | validator | HARD_FAIL | 0 | PASS | no | no | 0.116s | product_safety_or_integrity |
| `authority-fanout` | validator | HARD_FAIL | 0 | PASS | no | no | 0.756s | product_safety_or_integrity |
| `kpi-truth` | validator | HARD_FAIL | 0 | PASS | no | no | 0.134s | product_safety_or_integrity |
| `protected-editorial-core` | validator | HARD_FAIL | 0 | PASS | no | no | 0.151s | product_safety_or_integrity |
| `improvement-recommendations` | validator | STRONG_WARNING | 0 | PASS | no | no | 0.134s | advisory_only |
| `authority-distribution` | validator | HARD_FAIL | 0 | PASS | no | no | 0.138s | product_safety_or_integrity |
| `editorial-continuity` | validator | HARD_FAIL | 0 | PASS | no | no | 0.123s | product_safety_or_integrity |
| `site-intent-preservation` | validator | HARD_FAIL | 0 | PASS | no | no | 0.122s | product_safety_or_integrity |
| `memphis-search-surfaces` | validator | HARD_FAIL | 0 | PASS | no | no | 0.122s | product_safety_or_integrity |
| `velocity-immutability` | validator | HARD_FAIL | 0 | PASS | no | no | 0.121s | product_safety_or_integrity |
| `autonomy-contract` | validator | HARD_FAIL | 0 | PASS | no | no | 0.118s | product_safety_or_integrity |
| `safe-harbor-behavior` | validator | HARD_FAIL | 0 | PASS | no | no | 0.138s | product_safety_or_integrity |
| `admin-security-behavior` | validator | HARD_FAIL | 0 | PASS | no | no | 0.171s | product_safety_or_integrity |
| `notification-freeze-behavior` | validator | HARD_FAIL | 0 | PASS | no | no | 0.144s | product_safety_or_integrity |
| `build-determinism` | validator | HARD_FAIL | 0 | PASS | no | no | 1.292s | product_safety_or_integrity |
| `autonomy-cycle-e2e` | validator | HARD_FAIL | 0 | PASS | no | no | 0.203s | product_safety_or_integrity |
| `self-heal-e2e` | validator | HARD_FAIL | 0 | PASS | no | no | 0.231s | product_safety_or_integrity |
| `aggregate-validate-all` | aggregate | HARD_FAIL | 0 | NON_BLOCKING_FINDING | yes | no | 5.316s | product_safety_or_integrity |
| `aggregate-release-prepush` | aggregate | HARD_FAIL | 0 | NON_BLOCKING_FINDING | yes | no | 6.053s | product_safety_or_integrity |

## Changed-path details

## Non-blocking findings

- `agency-quality`: live content quality remains 79/100. This is a real improvement queue, not a release gate.
- GSC and Bing measurement remain 0 because live credentials are not connected. The dashboard reports unavailable rather than pretending health.

## Final classification

- **Release-blocking:** build/install failures, security, data loss, publication-boundary corruption, cadence drift, unsafe content, broken rollback, or deterministic-build failure.
- **Advisory only:** aspirational content score, optional LLM surfaces, word-count ranges, modeled opportunities, and provider-unavailable states.
- **Petty/stale governance:** none remained release-blocking after the approved baseline was refreshed.

