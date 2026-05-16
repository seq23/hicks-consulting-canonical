# IndexNow Distribution Runbook — Hicks Consulting Canonical

## Purpose

Make updated public Hicks Consulting URLs visible to search engines quickly after deploy.

This repo now has a push-based IndexNow lane. It does three things:

1. builds and validates the site,
2. emits priority and batch URL lists from the sitemap,
3. submits those URLs to IndexNow and writes a proof report.

It also creates a Google Search Console re-index queue for the small set of priority URLs that should be manually inspected/requested in GSC after meaningful page updates.

## Workflow

Workflow file:

```text
.github/workflows/indexnow-submit.yml
```

Triggers:

```text
push to main
manual workflow_dispatch
```

Required GitHub secret:

```text
INDEXNOW_KEY
```

If `INDEXNOW_KEY` is missing in a live workflow, submission fails clearly and writes a report. This is intentional. Silent search-distribution failure is worse than a red workflow.

## Local dry-run

Run after `npm ci`:

```bash
npm run build
npm run validate:all
npm run indexnow:emit
npm run validate:indexnow
INDEXNOW_DRY_RUN=1 INDEXNOW_KEY=dry-run npm run indexnow:submit
npm run gsc:reindex-queue
```

## Generated reports

```text
reports/indexnow-priority.txt
reports/indexnow-batch.txt
reports/indexnow-manifest.json
reports/indexnow-submit-report.json
reports/search-reindex-queue.json
```

## Google Search Console boundary

Google Search Console URL Inspection can be used to check status, but the ordinary “Request indexing” button for normal pages is a manual GSC action. The repo therefore generates `reports/search-reindex-queue.json` so the owner or VA knows which 5–10 URLs to inspect/request manually after important updates.

## Priority URL policy

Priority URLs include:

- homepage,
- therapy,
- coaching,
- corporate speaking,
- organizational training inquiry,
- contact,
- resources index,
- most recent live resource URLs.

Batch URLs include every public canonical URL in the sitemap.

## Failure handling

If IndexNow fails:

1. open the workflow artifact,
2. inspect `reports/indexnow-submit-report.json`,
3. confirm `INDEXNOW_KEY` exists in GitHub Actions secrets,
4. confirm the key file is publicly reachable at the site root if required by the IndexNow provider,
5. rerun the workflow manually.

## IndexNow key setup — required before live submission

1. Generate or choose an IndexNow key. Use a random lowercase hexadecimal/string token, for example a 32+ character value.
2. In GitHub, open the repository settings for `hicks-consulting-canonical`.
3. Go to **Secrets and variables → Actions → New repository secret**.
4. Create a secret named exactly `INDEXNOW_KEY`.
5. Paste the same key as the secret value.
6. In the repo root, create a file named exactly `indexnow.txt`.
7. Put the exact same key inside `indexnow.txt` as plain text, with no quotes and no extra labels.
8. Commit and deploy the site.
9. Confirm the verification file is live at `https://www.hicksconsulting.org/indexnow.txt`.
10. Run the `IndexNow Submit` workflow manually once from GitHub Actions, or push to `main` after the key file is deployed.

The submit script uses `https://www.hicksconsulting.org/indexnow.txt` as the default `keyLocation`. The build copies root `indexnow.txt` into `dist/indexnow.txt` when the file exists. Do not put `INDEXNOW_KEY=` inside `indexnow.txt`; the file content must be only the key.

## Google Search Console reality check

This workflow creates `reports/search-reindex-queue.json` for the 5–10 priority URLs that should be checked or manually requested in Google Search Console. It does not automate the Search Console UI "Request indexing" button for ordinary pages. Use the queue report after deploy for manual URL Inspection requests when a small set of pages changed.

