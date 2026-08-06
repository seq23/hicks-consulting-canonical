# Provider Activation Runbook

Provider code is implemented but remains `INTEGRATED_UNPROVEN` until credentials are installed and a live receipt is captured. Never mark a provider healthy merely because environment-variable names exist.

## 1. Cloudflare Pages secrets

From the repo directory, install secrets with Wrangler or the Cloudflare dashboard:

```bash
wrangler secret put GITHUB_ADMIN_TOKEN
wrangler secret put GITHUB_REPOSITORY
wrangler secret put GITHUB_BRANCH
wrangler secret put INQUIRY_SHARED_SECRET
```

The `/admin/`, `/agency/`, and `/admin/digitalproducts/` routes use the owner-approved shared client-side `blackgirlmagic` convenience gate. No admin-auth secret installation is required. Do not place provider secrets or private data in browser-visible dashboard payloads.

The GitHub token must be fine-grained, limited to this repository, and granted only the minimum required permissions:

- Actions: read/write
- Contents: read/write
- Metadata: read-only

The browser must never receive this token.

## 2. LLM drafting provider

Configure GitHub Actions secrets:

- `LLM_API_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- optional `LLM_PROVIDER` (`openai_compatible` default or `anthropic`)

Run a controlled cycle with one low-risk fixture or admitted candidate. Verify:

- candidate advances to `SCHEDULED`;
- page source exists;
- Safe Harbor receipt exists;
- next slot matches the locked cadence;
- baseline manifest records remain unchanged.

## 3. Publication email

Preferred Resend configuration:

- `RESEND_API_KEY`
- `PUBLICATION_NOTIFICATION_TO`
- `PUBLICATION_NOTIFICATION_FROM`

The sender must use a verified domain. Alternatively configure `EMAIL_WEBHOOK_URL` and optional `EMAIL_WEBHOOK_SECRET`.

Verify one controlled notification receipt. The message must explain the publication and request double-check/additional context without asking for pre-publication approval.

## 4. Google Search Console

Monitoring supports either:

- `GSC_SITE_URL`, `GSC_SERVICE_ACCOUNT_EMAIL`, and `GSC_PRIVATE_KEY`; or
- temporary `GSC_ACCESS_TOKEN`.

Distribution and URL inspection use:

- `GSC_SITE_URL`
- `GSC_SERVICE_ACCOUNT_JSON`

Grant the service account appropriate access to the exact Search Console property. Confirm query-page data, clicks, impressions, CTR, average position, and freshness populate `data/agency/providers/gsc.json`.

## 5. Bing Webmaster Tools

Configure:

- `BING_SITE_URL`
- `BING_WEBMASTER_API_KEY`

Confirm the Bing snapshot changes from `not_connected` to a timestamped provider response. Provider errors must remain visible rather than converted into a positive score.

## 6. Search/competitor observation provider

Configure:

- `SEARCH_API_URL`
- `SEARCH_PROVIDER_API_KEY`
- optional `SEARCH_QUERY_PARAM` (defaults to `q`)

The provider output is observation evidence only. It may inform recommendations but may not be copied into Hicks content or treated as a clinical source.

## 7. IndexNow

Configure:

- `INDEXNOW_KEY`
- `INDEXNOW_KEY_LOCATION`

Confirm the hosted key file and submission receipts. IndexNow submission is distribution evidence, not proof of indexation or ranking.

## 8. Activation proof states

For each provider, record:

- configuration date;
- credential owner;
- least-privilege scope;
- successful request timestamp;
- response/receipt location;
- failure and retry behavior;
- rollback or key-rotation steps.

Only then promote the capability from `INTEGRATED_UNPROVEN` to an appropriate proven state.
