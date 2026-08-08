# Hicks Consulting — Search Intelligence + Self-Healing Repair Artifact

## Full intended system
Hicks Consulting actively measures its governed Memphis search queries, records Google-Search-grounded web surfacing separately from literal rank, combines that evidence with GSC and Bing, inspects surfaced competitor pages, diagnoses gaps, applies only bounded Hicks-safe search alignment repairs, rebuilds, and waits for later external evidence before calling an outcome a win.

## Implemented in this snapshot
- Preserved the deployed Bing indexation cleanup: 54 high-similarity derivative insights are revoked and permanently redirected to authoritative parent articles.
- LLM-only `/llm-atlas/` routes stay available to machine-readable surfaces but are excluded from the public search sitemap.
- Added Gemini Google Search grounding for the seven governed Hicks queries, with explicit `rankVerified:false` truth handling.
- Added competitor-page structure inspection and query-gap diagnoses.
- Added GSC/Bing/live provider health with explicit NOT_CONFIGURED/DEGRADED states.
- Added durable query observation history, action queue, repair receipts, and post-repair retest state.
- Added bounded autonomous search repairs using governed Hicks query wording only; competitor copy and clinical claims are never copied/invented.
- Fixed workflow persistence so bounded source-page repairs are committed instead of disappearing after the monitoring job.
- Added live query/provider state to `/agency/` without replacing the existing admin system.
- Added a release-blocking structural search-intelligence contract to the canonical validation registry.
- Publishing velocity contract remains unchanged.

## Not implemented / not claimed
- No live API secret values are included.
- Gemini, GSC, Bing, IndexNow, or deployed Cloudflare success is not claimed from this artifact alone.
- No Google/Bing ranking or indexation result is guaranteed.
- Grounded search citations are not represented as organic positions.

## Required runtime secrets
Configure outside the repository: `GEMINI_API_KEY`, GSC credentials, `BING_SITE_URL`, `BING_WEBMASTER_API_KEY`, and existing distribution/runtime secrets.

## Validation boundary
This artifact is structurally checked only. The local updater remains authoritative for full repo validation, commit, push, and deployment.
