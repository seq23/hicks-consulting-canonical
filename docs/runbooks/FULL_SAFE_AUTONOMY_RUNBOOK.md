# Full Safe Autonomy Runbook

**Repository:** `hicks-consulting-canonical`  
**Runtime mode:** `FULL_SAFE_AUTONOMY`  
**Cadence authority:** `data/system/publishing_velocity_contract.json`

## 1. Operating contract

The autonomous system may discover, draft, validate, repair, schedule, publish, distribute, notify, measure, and perform bounded self-healing without routine client approval.

The existing editorial velocity is immutable:

| Content lane | Locked cadence |
|---|---|
| Reflections / insights | 5 business days per week |
| Substantial articles | 1 per week |
| Pillar guides | 1 per month |
| Flagship white papers | 1 per quarter |

The engine fills the next legal existing slot. It never creates an extra slot. The 227 baseline manifest records and their historical/scheduled identity are protected.

## 2. Lifecycle

Canonical states:

`DISCOVERED -> SCORED -> ADMITTED -> DRAFTING -> DRAFTED -> VALIDATING -> REPAIRING -> VALIDATED_SAFE -> SCHEDULED -> PUBLISHED -> DISTRIBUTED -> MEASURED`

Exception states:

- `SKIPPED_DUPLICATE_INTENT`
- `SKIPPED_UNSUPPORTED_CLAIM`
- `SKIPPED_PROTECTED_OWNER`
- `SKIPPED_PROHIBITED_ACTION`
- `FAILED_RETRYABLE`
- `SYSTEM_BLOCKED`

One skipped item must not block unrelated safe work.

## 3. Routine workflows

| Workflow | Purpose | Mutation boundary |
|---|---|---|
| `autonomy-cycle.yml` | Draft, validate, repair, and schedule admitted candidates | New safe resources and autonomy ledgers only |
| `content-publish.yml` | Publish content due in an existing authorized slot | Due safe manifest entries only |
| `autonomy-self-heal.yml` | Perform bounded technical/content repairs | Allowlisted repair surfaces only |
| `agency-seo-monitor.yml` | Refresh GSC/Bing and search intelligence | Provider snapshots and recommendations |
| `indexnow-submit.yml` | Submit distribution signals and send publication email | Distribution and notification receipts |
| `editorial-continuity.yml` | Replenish backlog while preserving velocity | Candidate backlog only |
| `repo-self-heal.yml` | Run the registered validate/repair/re-validate loop over the whole matrix | Only the artifacts the 8 registered `repair_command` generators write; never `data/admin` |

All content-mutating workflows share concurrency protection and invoke the deep validation profile before committing.

## 4. Safe Harbor rules

Allowed autonomous content must be educational, source-aware when claims require support, distinct from existing pages, and within the established Hicks Consulting services and voice.

Never fabricate or autonomously assert:

- client stories or testimonials;
- Monika's personal experiences or opinions;
- credentials or modalities not present in approved source facts;
- fees, insurance participation, availability, or office location;
- clinical diagnosis, personalized treatment, or guaranteed outcomes;
- rankings, external citations, or observed AI surfacing without evidence.

Repairable findings may be fixed automatically. Protected facts are skipped and surfaced for client input. The runtime must never force unsafe material live.

## 5. Accepted-output freeze

Every newly accepted autonomous page is frozen before it can be treated as stable output.

`discover -> admit -> generate/repair -> validate -> accept -> freeze`

Future changes use:

`exact page -> thaw -> patch -> validate -> refreeze`

Revision records live in `data/autonomy/revision_registry.json`. Content-addressed blobs live in `data/autonomy/freeze/`.

## 6. Post-publication notification

After a successful publication run, the system queues and sends one explanatory email containing:

- title and live URL;
- content type and publication time;
- target query/cluster and selection rationale;
- key sources and automatic repairs;
- validation/deployment receipt;
- a request to double-check and reply with corrections, examples, nuance, or additions.

The email is informational, not an approval gate. Email failure does not roll back valid content; the notification remains pending and retries separately.

## 7. Pause and emergency controls

The authenticated admin may:

- pause future autonomy cycles;
- resume cycles;
- run a bounded cycle;
- run due publication;
- run measurement or self-healing;
- engage emergency stop.

Emergency stop blocks new automated mutations but does not erase content or receipts.

## 8. Failure handling

| Failure | Behavior |
|---|---|
| LLM unavailable | Leave candidate admitted/provider-gated; publish nothing fabricated |
| One unsafe candidate | Skip, record, continue |
| Email unavailable | Keep notification pending; content remains published |
| GSC/Bing unavailable | Show `not_connected`/`stale`; do not award fake performance score |
| Competitor provider unavailable | Make no external competitor claims |
| Build or hard validation failure | Do not publish/commit affected change |
| Secret exposure, provenance loss, protected-path mutation | `SYSTEM_BLOCKED` for affected lane |

## 9. Operator verification

Run:

```bash
npm ci
npm run build
npm run validate:deep
npm run release:prepush:local
```

Deep validation includes a sandboxed end-to-end cycle proving fixture drafting, Safe Harbor admission, legal cadence assignment, page rendering, manifest mutation, accepted-output freeze, receipt creation, and preservation of the baseline schedule.
