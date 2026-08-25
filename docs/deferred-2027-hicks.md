# 2027 publishing cadence — status and decision points

**Prepared:** 2026-08-24 · WO-18c · Recorded so it is not lost. Not actionable today.

## Current state, measured

| Signal | Value |
|---|---|
| Scheduled items in `data/admin/content_manifest.json` | 227 |
| Cadence | ~26–30 items/month, steady since 2026-06 |
| Coverage ends | **2027-01-01** |
| Continuity `horizon_days` | 120 |
| Last continuity run | 2026-08-17 |
| `target_coverage_end` | 2026-12-15 |
| `planned_slots_needed` / `candidates_added` | 0 / 0 |
| Publication authority | `FULL_SAFE_AUTONOMY_WITH_EXISTING_VELOCITY` |

## This is healthy, not stalled

The continuity engine maintains a rolling 120-day runway. Coverage (2027-01-01)
is already beyond its current target (2026-12-15), so adding nothing is correct.

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

## Decision points for Q4 2026

1. **Cadence for 2027.** 2026 held ~28/month. Velocity may increase from January
   2027. Decide the target before the engine starts filling in September, because
   changing it afterwards means reworking approved candidates.
2. **Attribution.** `docs/pending-client-approval/schema-template.md` proposes the
   `Person`/`hasCredential` schema this site currently lacks. Approving it before
   the 2027 batch means new content ships attributed rather than being retrofitted.
3. **Reviewer capacity.** Higher velocity on LCSW-adjacent content needs a matching
   increase in review throughput, or the approval queue becomes the bottleneck.

## What must not change without the client

2026 content is locked and approved. Published pages, publishing cadence for 2026,
and the content engine's behaviour for already-approved items stay as configured.
