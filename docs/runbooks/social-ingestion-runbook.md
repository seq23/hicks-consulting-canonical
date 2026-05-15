# Social Ingestion Runbook

## Purpose
Collect public, no-auth social/question signals and turn them into owner-review content brief candidates without auto-publishing.

## Sources
Enabled production-safe sources currently include:
- Reddit RSS search feeds
- YouTube public RSS feed attempt
- Google News RSS social-web/news search feeds
- Interpersonal Skills public forum RSS

Research-only sources are listed but disabled until a stable no-auth adapter exists:
- Quora
- X/Twitter
- TikTok

## Commands
- `npm run ingest:all` collects signals, normalizes them, clusters them, scores them, maps them to candidate pages, builds fanout candidates, refreshes LLM-only pages, and builds owner-approval content briefs.
- `npm run validate:ingestion` runs advisory validators for LLM/social/internal systems.

## Publishing rule
Social ingestion never auto-publishes pages. It creates owner-review candidates in:
- `data/intake/content_brief_candidates.json`
- `data/social/publish_queue.json`

## Validation policy
Client-visible/public defects hard-fail. LLM-only/social-ingestion defects are advisory in deployment, but should be resolved before a repo update is shipped.
