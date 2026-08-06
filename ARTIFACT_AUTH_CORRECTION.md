# Admin / Agency Access Correction Receipt

## Approved correction

- `/admin/`, `/agency/`, and `/admin/digitalproducts/` use the same password: `blackgirlmagic`.
- The shared browser gate uses the canonical SHA-256 hash `c7ef3319e6cf6aab9035156df95f18dfec2ba2178f733940eda688758805708b`.
- The unauthorized signed-session, CSRF, login-rate-limit, and separate server-authentication layer was removed.
- Existing command-center actions, receipts, pause/resume, emergency stop, publishing autonomy, dashboard data, Memphis pages, and immutable editorial velocity were preserved.

## Truth boundary

This is a convenience gate, not high-security access control. The password hash is inspectable in browser code. Provider credentials and other secrets remain server-side and must never be included in admin/agency HTML or JSON.
