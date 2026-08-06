# Deep Validation Matrix

## Governing principle

The rebuilt site and intended runtime behavior define correctness. Validators are isolated proof probes. They do not redesign pages, alter publishing velocity, impose arbitrary word-count preferences, or promote optional SEO scores into product law.

## Release-blocking proof classes

| Proof class | What is isolated and tested |
|---|---|
| Site preservation | Existing NAV, H1 hierarchy, section shape, and substantial copy continuity remain while required Memphis/provider signals exist |
| Search surfaces | Both Memphis service pages are canonical, indexable, substantive, sitemap-listed, and contextually linked |
| Velocity immutability | All 227 baseline records retain identity/date/route and new work can only use a legal existing cadence slot |
| Autonomy contract | Routine approval is absent; safe lifecycle, protected facts, skip-record-continue, and emergency controls are present |
| Safe Harbor behavior | Safe, repairable, protected, duplicate, and prohibited fixtures produce the correct decisions |
| Autonomy E2E | Fixture draft actually becomes a validated scheduled page, manifest entry, freeze blob, and receipt in an isolated temp repo |
| Self-healing E2E | A repairable page is patched, reanalyzed, frozen before and after, and restored byte-for-byte from the rollback revision |
| Shared admin/agency gate | Exact shared-password hash, same gate across `/admin`, `/agency`, and digital products, local lock/unlock behavior, hash-header API compatibility, and no provider-secret disclosure |
| Notification/freeze | Explanatory post-publication email payload, pending retry, revision freeze, and rollback behavior |
| Build determinism | Two independent builds produce identical deployable output |
| Existing local suite | Every registered legacy/local check is run individually through the registry protocol and reclassified by real risk |

## Non-blocking findings

The following remain visible but do not block a safe release by themselves:

- content quality score below an aspirational threshold;
- disconnected GSC/Bing/search/email/LLM providers before credentials are installed;
- optional hidden LLM surfaces;
- advisory word-count ranges;
- modeled opportunities without observed external outcomes;
- recommendations that require future performance data.

A disconnected provider must score as unavailable, not healthy. An opportunity is not a ranking, mention, backlink, or citation.

## Commands

```bash
npm run build
npm run validate:deep
npm run release:prepush:local
```

To run one registered probe without bypassing policy:

```bash
node _ops/validation/run_validation_matrix.js --check autonomy-cycle-e2e
```

## Local validation isolation

The deep report must record for every registered check:

- command and entrypoint;
- registered severity;
- exit status;
- finding protocol result;
- duration;
- source-tree hash before and after;
- whether the check mutated the repo;
- whether the finding represents product risk, advisory quality, provider unavailability, or stale/petty governance.
