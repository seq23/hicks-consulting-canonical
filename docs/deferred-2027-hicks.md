# 2027 publishing cadence — status and decision points

**Prepared:** 2026-08-24 · WO-18c · **Re-measured:** 2026-08-26
Recorded so it is not lost. Not actionable today. **Doc only — this file changes
no content, no page and no cadence.**

## Current state, measured

Re-read from `data/continuity/editorial_continuity_report.json`,
`data/continuity/cadence_policy.json` and
`data/system/publishing_velocity_contract.json` on 2026-08-26.

| Signal | Value |
|---|---|
| Scheduled items in `data/admin/content_manifest.json` | 227 |
| Cadence | ~26–30 items/month, steady since 2026-06 |
| Coverage ends | **2027-01-01** |
| Continuity `horizon_days` | 120 |
| Last continuity run | 2026-08-24 |
| `target_coverage_end` | 2026-12-22 |
| `planned_slots_needed` / `candidates_added` | 0 / 0 |
| `locked_through` (`cadence_policy.json`) | **2026-12-31** |
| Publication authority | `FULL_SAFE_AUTONOMY_WITH_EXISTING_VELOCITY` |

## This is healthy, not stalled

The continuity engine maintains a rolling 120-day runway. Coverage (2027-01-01)
is already beyond its current target (2026-12-22), so adding nothing is correct.

It begins generating 2027 candidates on its own once `run_date + 120 days`
passes 2027-01-01 — approximately **2026-09-03**. No intervention is required for
the 2027 lane to start filling.

`scripts/continuity/replenish_editorial_candidates.mjs` already carries
`continuityAfter: '2027-01-01'`, and `validate_editorial_continuity.mjs` requires
proposed items to be scheduled after that date. The post-2026 machinery exists and
is wired.

## Approval routing is intact

Nothing here bypasses the client. Candidates land in
`data/admin/content_manifest.json`, surface in `/admin` (`pages/admin`, built to
`dist/admin`), and publish through `scripts/publishing/process_manifest.js` and
`run_safe_publish.mjs`. Any 2027 velocity change inherits that same path.

## When the scoping conversation should happen

The working assumption has been **Q4 2026** — early enough that the engine is
ready before the 2027 lane opens. The repo does not quite agree, and the repo
wins: `run_date + horizon_days` crosses 2027-01-01 at approximately
**2026-09-03**, so the engine begins *proposing* 2027 candidates about a month
before Q4 starts.

That is not an emergency. Proposed is not published — `cadence_policy.json` is
explicit that cadence "controls how much is PROPOSED for review, never what is
published", and every candidate still routes through `/admin` for client
approval. But it does mean a Q4 conversation is scoping a lane that has already
started filling. Two workable readings:

- **Hold Q4 2026 as planned** and accept that early 2027 candidates get reviewed
  or reworked against whatever cadence is agreed.
- **Pull the cadence question forward to September**, keep the rest of the
  scoping in Q4, and the engine fills against an agreed target from the start.

Either way this is a Q4-2026 agenda item, not an August one. Nothing needs doing
today.

## Decision points for that conversation

1. **Cadence for 2027.** 2026 held ~28/month. Velocity may increase from January
   2027 — `cadence_policy.json` locks 2026 through **2026-12-31** and marks
   `from_2027` as the only adjustable lane. Decide the target before the engine
   starts filling in September, because changing it afterwards means reworking
   approved candidates.
2. **Attribution.** `docs/pending-client-approval/schema-template.md` proposes the
   `Person`/`hasCredential` schema this site currently lacks. Approving it before
   the 2027 batch means new content ships attributed rather than being retrofitted.
3. **Reviewer capacity.** Higher velocity on LCSW-adjacent content needs a matching
   increase in review throughput, or the approval queue becomes the bottleneck.

## What must not change without the client

2026 content is locked and approved. Published pages, publishing cadence for 2026,
and the content engine's behaviour for already-approved items stay as configured.
