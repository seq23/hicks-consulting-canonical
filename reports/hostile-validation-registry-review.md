# Hostile Review — Validation Registry, Publishing, and Recent Resources

**Repository:** `hicks-consulting-canonical`  
**Review date:** 2026-06-16  
**Source reviewed:** `hicks-consulting-canonical-main_BASELINE_06-16-26_fb09df15.zip`  
**Result:** Remediated; clean container validation completed.

## Scope

The review reopened the delivered baseline ZIP and treated it as untrusted. It examined the severity model, validator runner, workflow invocation paths, publishing mutation path, documentation, `/resources/` rendering, warning behavior, and packaging safety.

## Hostile findings and remediation

1. **CI severity bypass — fixed.** Two workflows invoked warning-class leaf validators directly, allowing their raw exit behavior to bypass the matrix. All workflows now invoke registered profiles only, and direct leaf invocation is a hard registry failure.
2. **Validator crash masking — fixed.** A syntax error or uncaught exception in a warning validator could be downgraded as a warning. The orchestrator now requires the `VALIDATION_FINDING` protocol; syntax errors, runtime crashes, signals, missing entrypoints, unsupported exit codes, and unexpected stderr are always execution hard failures.
3. **Missing validation registry — fixed.** `_repo_validation_registry.json` is now the canonical inventory for all checks, severities, owners, scopes, entrypoints, blocking behavior, and CI policy. `_repo_validation_matrix.json` now contains execution profiles only.
4. **Warning validators could crash after detecting missing files — fixed.** Ingestion, cluster, fanout, source-health, social-firehose, and throttle checks now safely report missing or malformed optional inputs at their registered severity instead of crashing accidentally.
5. **No permanent orchestrator regression proof — fixed.** `validate:orchestrator-contract` now proves that strong warnings pass while hard findings, syntax failures, and runtime failures block.
6. **Stale matrix coupling — fixed.** The form-database validator still expected the old matrix-owned validator inventory. It now verifies admission through the registry.
7. **Stale build validation order — fixed.** The build workflow now builds before `validate:all`, ensuring dist-aware validators inspect the current output.
8. **Publisher mutation path insufficiently defensive — fixed.** Publishing now enforces timezone-qualified ISO schedules, rejects duplicate/missing IDs, preserves future approvals, removes preview state, writes atomically, and proves idempotence.
9. **`/resources/` rendered the full published manifest — fixed.** The section is now titled **Recently published resources** and renders exactly four newest published resources. Batch ties use newer `scheduledAt`, then slug/id, for deterministic ordering. Older published content remains available through the type links above.
10. **Recent-four drift lacked validation — fixed.** `validate:recent-resources` is registered as a strong warning and independently verifies heading, script wiring, renderer source, count, and newest-four order.

## Adversarial proof

| Injected condition | Expected | Observed |
|---|---|---|
| Published item retains `previewPath` | Strong warning; exit 0 | Passed with strong warning |
| Recent-resource selector reversed | Strong warning; exit 0 | Passed with newest-four mismatch warning |
| Syntax error in warning validator | Hard block; exit 1 | Execution hard fail |
| Runtime exception in warning validator | Hard block; exit 1 | Execution hard fail |
| Workflow invokes leaf validator directly | Hard block; exit 1 | Registry hard fail |
| Informational cluster file missing | Info finding; exit 0 | Passed with info finding |
| Required `robots.txt` missing | Hard block; exit 1 | Preflight hard fail |
| Ingestion, sitemap-indexing, and IndexNow profiles | Exit 0 | All profiles passed |

## Clean validation result

- `npm ci`: passed
- `npm audit --omit=dev`: 0 vulnerabilities
- `npm run build`: passed
- `npm run validate:all`: 35/35 checks passed
- Hard-fail findings: 0
- Execution hard failures: 0
- Strong warnings: 0
- Soft warnings: 0
- Info findings: 0

## Proof boundary

This review proves source, build, validation behavior, publishing behavior, workflow contracts, and structural `/resources/` wiring in the container. It does not claim a real-browser screenshot, deployed runtime, Cloudflare deployment, or GitHub Actions execution against the replacement ZIP.
