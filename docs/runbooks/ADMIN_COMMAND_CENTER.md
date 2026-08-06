# Admin and Agency Shared Gate Runbook

## 1. Purpose

`/admin/` is the owner/VA control room for Full Safe Autonomy. `/agency/` is the SEO/AEO/GEO performance dashboard. `/admin/digitalproducts/` remains the product-management lane.

All three use the same owner-selected password: `blackgirlmagic`.

## 2. Access model

- the browser hashes the entered password with SHA-256;
- the exact approved hash is stored in the shared gate script;
- the successful hash is remembered locally so `/admin`, `/agency`, and digital products unlock together;
- Lock clears the stored hash for all three routes;
- command and product API requests send the same hash in `x-admin-password-hash`;
- no signed session, CSRF token, login rate limit, or separate server-authentication setup is required.

This is a lightweight convenience gate, not real security. A technically capable visitor can inspect browser code and recover the hash. Therefore:

- never put provider credentials, private clinical data, or other secrets in page HTML or dashboard JSON;
- keep GitHub, LLM, email, GSC, Bing, IndexNow, Cloudflare, KV, and R2 credentials server-side;
- keep `/admin` and `/agency` marked `noindex,nofollow`.

## 3. Available controls

- run one autonomy cycle;
- publish resources due now;
- run bounded self-healing;
- refresh search/provider measurements;
- submit distribution workflow;
- pause or resume automation;
- engage or clear emergency stop;
- inspect queue, exceptions, revisions, notifications, providers, free wins, and receipts;
- submit client feedback tied to a revision.

Every action must return a real receipt or a truthful provider-not-configured error.

## 4. Operator check

1. Open `/admin/` and enter `blackgirlmagic`.
2. Confirm the command center unlocks.
3. Open `/agency/` in the same browser and confirm it is unlocked without a second password entry.
4. Open `/admin/digitalproducts/` and confirm the same gate state applies.
5. Click Lock on either dashboard.
6. Refresh all three routes and confirm each requires the shared password again.
7. Confirm browser page source contains no GitHub or provider credentials.

## 5. Emergency operation

Emergency stop remains a real command-center action. Use it only for a genuine system-level problem such as secret exposure, protected-path mutation, fabricated evidence, or corrupt provenance. It blocks future autonomous mutations while preserving current content and evidence.
