# Validation Registry Runbook

**Repository:** `hicks-consulting-canonical`  
**Status:** AUTHORITATIVE  
**Registry:** `/_repo_validation_registry.json`  
**Execution matrix:** `/_repo_validation_matrix.json`  
**Canonical full command:** `npm run validate:all`

## 1. Authority split

- The **registry** is the single inventory of every validator: identity, package command, entrypoint, severity, release behavior, group, owner, scope, protocol, and rationale.
- The **matrix** defines named execution profiles and the exact registered checks run by each profile.
- Every matrix execution bootstraps with the hard-fail `validation-registry` governance check, even for a single requested check.
- GitHub Actions may invoke matrix profiles only. Direct workflow invocation of a leaf validator is a hard governance failure.
- A validator finding may inherit its registered severity only when it emits the `VALIDATION_FINDING` protocol marker.
- Syntax errors, uncaught exceptions, signals, missing entrypoints, unsupported exit codes, and unexpected stderr are always hard execution failures—even when the affected validator is registered as a warning or informational check.

## 2. Severity law

| Classification | Blocks release | Meaning |
|---|---:|---|
| Hard fail | Yes | Direct safety, data-loss, compliance, deployment, publication-boundary, or repository-write risk. |
| Strong warning | No | Material user, conversion, discoverability, content-governance, or operator defect requiring prompt repair. |
| Soft warning | No | Quality, resilience, optimization, or cleanup defect. |
| No warning / info | No | Observability or optional planning signal; reported without warning annotation. |

Passing checks produce no warning. Execution failures are not downgraded by the business severity of the check.

## 3. Release gates

| Gate | Classification | Owner | Rationale |
|---|---|---|---|
| `npm ci` | Hard fail | `repo-maintainers` | A lockfile install failure prevents deterministic execution. |
| `npm run build` | Hard fail | `repo-maintainers` | A failed production build is a deployment blocker. |

## 4. Registered checks

| ID | npm script | Classification | Group | Owner | Scope | Release behavior |
|---|---|---|---|---|---|---|
| `validation-registry` | `validate:registry` | Hard fail | `governance` | `repo-maintainers` | repository governance | Blocks |
| `orchestrator-contract` | `validate:orchestrator-contract` | Hard fail | `governance` | `repo-maintainers` | validation execution integrity | Blocks |
| `preflight` | `validate:preflight` | Hard fail | `repository` | `repo-maintainers` | source prerequisites | Blocks |
| `publisher-contract` | `validate:publisher-contract` | Hard fail | `publishing-safety` | `content-operations` | publication state transitions | Blocks |
| `canonical-url` | `validate:canonical` | Strong warning | `discoverability` | `growth-and-content` | search and crawler surfaces | Non-blocking |
| `seo-metadata` | `validate:seo-metadata` | Strong warning | `discoverability` | `growth-and-content` | search and crawler surfaces | Non-blocking |
| `lead-magnet` | `validate:lead-magnet` | Hard fail | `data-capture` | `platform-operations` | public form submission and durable capture | Blocks |
| `form-database` | `validate:form-database` | Hard fail | `data-capture` | `platform-operations` | public form submission and durable capture | Blocks |
| `crawl-contract` | `validate:crawl` | Strong warning | `discoverability` | `growth-and-content` | search and crawler surfaces | Non-blocking |
| `sitemap-parity` | `validate:sitemap` | Strong warning | `discoverability` | `growth-and-content` | search and crawler surfaces | Non-blocking |
| `internal-links` | `validate:links` | Strong warning | `navigation` | `product-experience` | public navigation | Non-blocking |
| `hidden-llm-surfaces` | `validate:hidden-llm-surfaces` | Soft warning | `ai-discoverability` | `growth-and-content` | crawler and LLM extraction surfaces | Non-blocking |
| `llm-ingestion-routes` | `validate:llm-ingestion-routes` | Soft warning | `ai-discoverability` | `growth-and-content` | crawler and LLM extraction surfaces | Non-blocking |
| `query-traceability` | `validate:queries` | Soft warning | `content-operations` | `content-operations` | content planning and traceability | Non-blocking |
| `above-fold` | `validate:abovefold` | Strong warning | `conversion-ux` | `product-experience` | public conversion experience | Non-blocking |
| `entity-coverage` | `validate:entities` | Soft warning | `semantic-data` | `growth-and-content` | entity and metadata consistency | Non-blocking |
| `conversion-contract` | `validate:conversion` | Strong warning | `conversion-ux` | `product-experience` | public conversion experience | Non-blocking |
| `training-inquiry` | `validate:training-inquiry` | Hard fail | `data-capture` | `platform-operations` | public form submission and durable capture | Blocks |
| `source-health` | `validate:source-health` | Soft warning | `ingestion` | `content-intelligence` | content-intelligence inputs | Non-blocking |
| `ingestion-freshness` | `validate:ingestion-freshness` | No warning / info | `ingestion-observability` | `content-intelligence` | operator metrics | Non-blocking |
| `query-signal-schema` | `validate:query-signals` | Soft warning | `ingestion` | `content-intelligence` | content-intelligence inputs | Non-blocking |
| `query-clusters` | `validate:query-clusters` | No warning / info | `ingestion-observability` | `content-intelligence` | operator metrics | Non-blocking |
| `fanout-candidates` | `validate:fanouts` | No warning / info | `ingestion-observability` | `content-intelligence` | operator metrics | Non-blocking |
| `social-firehose` | `validate:social-firehose` | Strong warning | `publishing-governance` | `content-operations` | approval and generation controls | Non-blocking |
| `throttle-contract` | `validate:throttle` | Soft warning | `provider-resilience` | `platform-operations` | provider operation safeguards | Non-blocking |
| `content-briefs` | `validate:content-briefs` | Strong warning | `publishing-governance` | `content-operations` | approval and generation controls | Non-blocking |
| `publish-state` | `validate:publish` | Hard fail | `publishing-safety` | `content-operations` | publication state transitions | Blocks |
| `policy-compliance` | `validate:policy` | Hard fail | `compliance` | `compliance-owner` | public claims and disclaimers | Blocks |
| `content-plan` | `validate:content-plan` | Strong warning | `content-operations` | `content-operations` | content planning and traceability | Non-blocking |
| `recent-resources` | `validate:recent-resources` | Strong warning | `content-discovery` | `content-operations` | resources landing-page recency | Non-blocking |
| `word-counts` | `validate:word-counts` | Soft warning | `content-quality` | `content-operations` | published resource quality | Non-blocking |
| `admin-previews` | `validate:admin-previews` | Strong warning | `admin-operations` | `content-operations` | operator-only content tooling | Non-blocking |
| `admin-generated-queue` | `validate:admin-generated-queue` | Strong warning | `admin-operations` | `content-operations` | operator-only content tooling | Non-blocking |
| `workflow-contracts` | `validate:workflows` | Hard fail | `release-safety` | `repo-maintainers` | CI and repository-write safety | Blocks |
| `indexnow` | `validate:indexnow` | Soft warning | `discoverability` | `growth-and-content` | search and crawler surfaces | Non-blocking |

## 5. Recent resources rule

- `/resources/` must use the heading **Recently published resources**.
- The landing page renders exactly the newest four validated, published resource records.
- Recency is determined by `publishedAt`, falling back to `scheduledAt`; batch ties are resolved by newer `scheduledAt`, then slug/id.
- All older published resources remain available through the Insights, Articles, Guides, and White Papers taxonomy links above the section.
- `validate:recent-resources` is a **strong warning**: count, heading, wiring, or newest-four order drift is visible but does not block deployment.

## 6. Change control

A new validator is invalid until it is added to `_repo_validation_registry.json`, assigned an owner, scope, group, severity, rationale, entrypoint, and `MATRIX_ONLY` CI policy, then added to the appropriate matrix profile. `validate:registry` hard-fails drift.
