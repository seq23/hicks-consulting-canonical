# Hicks Consulting IndexNow Data Trace

1. GitHub workflow `.github/workflows/indexnow-submit.yml` triggers on push to `main` and manual dispatch.
2. Workflow runs `npm run build`, which writes `dist/` and copies root `indexnow.txt` into `dist/indexnow.txt` when present.
3. Workflow runs `npm run validate:all`, including `validate:indexnow`.
4. Workflow runs `npm run indexnow:emit`, which reads the sitemap and writes `reports/indexnow-priority.txt`, `reports/indexnow-batch.txt`, and `reports/indexnow-manifest.json`.
5. Workflow runs live `npm run indexnow:submit` only when `INDEXNOW_KEY` is configured. If not configured, it writes a dry-run report instead of failing silently.
6. Live submission verifies `dist/indexnow.txt` exists and matches `INDEXNOW_KEY` before posting to IndexNow.
7. Workflow runs `npm run gsc:reindex-queue`, which writes `reports/search-reindex-queue.json` for manual GSC URL Inspection / Request Indexing follow-up.
8. Workflow uploads all IndexNow and GSC queue reports as GitHub Actions artifacts.
