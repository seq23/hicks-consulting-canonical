# Admin and Agency Shared Gate Runbook

## 1. Purpose

`/admin/` is the owner/VA control room for Full Safe Autonomy. `/agency/` is the SEO/AEO/GEO performance dashboard. `/admin/digitalproducts/` remains the product-management lane.

All three share one password, checked by the server.

## 2. Access model

- the sign-in form sends the typed password once, over HTTPS, to `POST /api/admin/login`;
- the server checks it against the `ADMIN_PASSWORD_HASH` Cloudflare Pages secret (PBKDF2, or the legacy SHA-256 hex until the password is rotated) and returns a 30-day signed session token, signed with the `ADMIN_SESSION_SECRET` secret;
- the token is remembered locally so `/admin`, `/agency`, and digital products unlock together; Lock clears it;
- every admin API call sends the token in `x-admin-session`; a client-sent password hash is never accepted;
- 5 wrong passwords from one IP lock that IP out for 15 minutes (generic message);
- either secret missing is a NAMED STOP: every admin call returns `503 ADMIN_AUTH_SECRET_MISSING` and nothing opens;
- no password or hash lives in this repo or in browser code (`_ops/validators/deep/validate_admin_security_behavior.mjs`).

Changing either secret in Cloudflare Pages signs everyone out.

Keep these regardless:

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

1. Open `/admin/` and enter the shared password.
2. Confirm the command center unlocks.
3. Open `/agency/` in the same browser and confirm it is unlocked without a second password entry.
4. Open `/admin/digitalproducts/` and confirm the same gate state applies.
5. Click Lock on either dashboard.
6. Refresh all three routes and confirm each requires the shared password again.
7. Confirm browser page source contains no GitHub or provider credentials.

## 5. Emergency operation

Emergency stop remains a real command-center action. Use it only for a genuine system-level problem such as secret exposure, protected-path mutation, fabricated evidence, or corrupt provenance. It blocks future autonomous mutations while preserving current content and evidence.
