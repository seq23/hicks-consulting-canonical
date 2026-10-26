# Zero paid LLM calls

Owner instruction, 11 Oct 2026: "nothing should be paid … cut the probes and make them free."
Applied to this repository on 26 Oct 2026, through the Search Readiness Checklist (items i3 and
i10). **Nothing paid.**

## What was paid, and what it is now

| Call site | Ran | Model / provider | What it did | Now |
|---|---|---|---|---|
| `scripts/autonomy/lib/llm_provider.mjs` via `scripts/autonomy/run_cycle.mjs` (`autonomy-cycle.yml`, `social-ingestion.yml`) | daily + on dispatch | whatever `secrets.LLM_API_URL` / `secrets.LLM_MODEL` named, OpenAI-compatible **or Anthropic** | drafts structured educational resources and repairs failed drafts | **Free.** Every call goes through `scripts/llm/free_router.mjs`. The model, the endpoint and the price ceiling come from `config/llm_routing.json`; the environment supplies only `OPENROUTER_API_KEY` |
| `scripts/search/live_query_observer.mjs` via `npm run autonomy:measure` (`agency-seo-monitor.yml`) | **daily, on a schedule** | OpenRouter **web plugin** pinned to `openai/gpt-4o-mini` | observed which sources search answers cite for the panel queries | **Off.** Records the named stop `PAID_PROBE_DISABLED_BY_OWNER_POLICY` and exits 0. Runs only in `.github/workflows/paid-citation-probe.yml` |
| `scripts/queries/score_discovery_gap.mjs` | daily | none (scores the probe's output) | scored the observation window | Moved into the probe lane, so it never scores a stale window |

The second row is the one that cost money every day. The OpenRouter web plugin bills **per
request** whatever model it carries, so unlike the drafting lane it cannot be made free — it can
only be taken off the schedule and put behind a human.

The first row had not spent anything yet, and was the more dangerous of the two: the model was a
repository secret. Checklist item i3 states it in one line — *if any script can name its own model,
one of them will name a paid one.*

## How free is enforced

- **`config/llm_routing.json`** — the ordered $0/$0 model list, the pricing snapshot it was chosen
  from (fetched 2026-10-26 from the unauthenticated `https://openrouter.ai/api/v1/models`),
  `policy.max_cost_usd: 0` and `policy.paid_fallback: false`. It also registers, by name, every
  paid probe lane and every free-router consumer, so the guard below has a list to check against
  rather than a convention to assume.
- **`scripts/llm/free_router.mjs`** — the only code allowed to call a model. Three independent
  guards, so no single mistake can spend:
  1. the model list holds only models priced $0/$0 in the committed snapshot, asserted on load;
  2. every request carries `provider.max_price = 0`, so **OpenRouter itself** refuses to route to
     a paid endpoint even if the list were wrong;
  3. `usage.cost` is read back on every answer and a non-zero cost throws
     `FREE_ROUTER_COST_VIOLATION`, failing the run loudly.
  Every call prints a `FREE_LLM_RECEIPT` with the outcome, model, cost and key label — never the
  key.
- **Named stops, exit 0, never a paid fallback:** `FREE_ROUTER_NO_KEY`,
  `OPENROUTER_KEY_DISABLED_OR_INVALID`, `NO_FREE_MODEL_ANSWERED`.
- **The paid lane** calls `paidProbeGate()` and stops with `PAID_PROBE_DISABLED_BY_OWNER_POLICY`
  unless `CONFIRM_PAID=true`, which only `.github/workflows/paid-citation-probe.yml` sets, and only
  when a person dispatches it with `confirm_paid: true` (default false). That workflow has no
  schedule, and a dispatch without the box ticked prints the named stop rather than passing
  silently.
- **Guard:** `_ops/validators/validate_zero_paid_llm.js`, registered in the validation registry and
  in the `all` profile, so it runs on every pull request. It fails on a non-$0 model, an undated
  snapshot, any script calling a provider directly instead of through the router, a consumer that
  stops importing the router, a probe lane with a schedule or without `confirm_paid`, any other
  workflow invoking a probe or setting `CONFIRM_PAID`, a scheduled workflow naming a paid model or
  passing a non-router model key, and `OPENROUTER_API_KEY` given to a step that runs no registered
  free-router consumer. It also fails if this document or the "nothing paid" line in `CLAUDE.md`
  goes missing — a cost rule nothing reads is a wish.

## Free models (ordered fallback)

Snapshot 2026-10-26, filtered to `pricing.prompt == "0" && pricing.completion == "0" &&
context_length >= 32768`:

1. `nvidia/nemotron-3-ultra-550b-a55b:free` (1M context)
2. `nvidia/nemotron-3.5-super-vl:free` (1M context)
3. `google/gemma-4-31b-it:free` (262k context)
4. `nvidia/nemotron-3.5-lightning:free` (1M context)

Two exclusions. `thinkingmachines/inkling:free` returns 403 for this account. OpenRouter's own
`openrouter/free` meta-router — free though it is — does not end in `:free`, and the checklist
requires that of every id so the rule can be read mechanically rather than argued about.

The list lives under `models` in the config, with `free_models` kept as an alias. That matters:
the checklist's reader only collects model ids from keys named `model`, `models`, `id`, `primary`,
`fallback`, `fallbacks` or `order`, so under `free_models` alone it collected an empty list and
passed without reading anything.

## If you need a paid call

You almost certainly do not. If a measurement genuinely cannot be made any other way, add it to
`paid_probe_lanes` in `config/llm_routing.json`, give it its own dispatch-only workflow with a
`confirm_paid` input defaulting to false, and call `paidProbeGate()` before the request. Never add
a paid fallback to the router, and never put a probe lane on a schedule.
