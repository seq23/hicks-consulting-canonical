# Working in hicks-consulting-canonical

`AGENTS.md` is this repository's authority and outranks this file where the two disagree. This
file carries the few rules an agent needs before it touches anything, and each one is read by
code — none of them is prose only.

## Cost

**Nothing paid.** Owner instruction, 11 Oct 2026: *"nothing should be paid … cut the probes and
make them free."*

- Every model call goes through `scripts/llm/free_router.mjs`, on the $0/$0 models in
  `config/llm_routing.json`, with `max_cost_usd: 0` and no paid fallback. No script names its own
  model and no workflow passes one.
- The one lane that cannot be made free — OpenRouter's per-request-billed web plugin in
  `scripts/search/live_query_observer.mjs` — has no schedule. It runs only when a person
  dispatches `.github/workflows/paid-citation-probe.yml` with `confirm_paid: true`.
- The whole posture, and what it replaced, is in **`docs/cost/zero-paid-llm.md`**.
- Read by `_ops/validators/validate_zero_paid_llm.js`, which fails if any of the above stops being
  true — including if this line goes missing.

## Nothing waits on the owner

A finding becomes an action with a measurement and an automatic fallback, never a question and
never a "waiting on the owner" stop. Make the call from the data, ship it, log why, measure, and
switch if the measurement says so. The only thing that may stop is a secret or an account the
owner alone holds, and that stops as a NAMED STOP a human can see — green and self-explaining,
never a silent exit.

Content and copy defects get a source fix, never a blocking validator.

## Validation

- Every fix is guarded by a validator registered in `_repo_validation_registry.json` and listed in
  the `all` profile of `_repo_validation_matrix.json`. `npm run validate:all` is what CI runs.
- **Rule 0: no stage may exit 0 having done nothing.** A validator that examines zero items
  hard-fails instead of passing an empty check.
- When a change makes an existing test false, rewrite the pin to the new truth at least as
  strictly. Never skip, delete, loosen or bump it — then look for siblings.
- Prove a new guard negatively: break the thing, watch it fail, restore it.

## Where generated output lives

`dist/` is wiped and rebuilt by `npm run build` on every run. Never fix anything there — find the
generator, the template, the data file or the page source under `pages/`. Facts that belong on
every page are stamped at build time (see `scripts/render/normalize_head_and_schema.js`), after
the sitemap's lastmod ledger, so site-wide boilerplate cannot mass-bump every page's date.

## Search readiness

The owner's Search Readiness Checklist runs against the live site weekly. Its repo-side contracts
are pinned by `_ops/validators/validate_search_readiness_surfaces.js`,
`_ops/validators/validate_three_click_reach.js` and
`_ops/validators/validate_search_metadata_contract.js`, so a regression fails on the pull request
rather than a week later in production.
