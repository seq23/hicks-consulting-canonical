# Hicks Consulting Canonical

Production source for `https://www.hicksconsulting.org/`.

## Runtime model

This repository uses **Full Safe Autonomy with the existing client publishing velocity preserved exactly**:

- 5 business-day reflections per week
- 1 substantial article per week
- 1 pillar piece per month
- 1 flagship guide per quarter

Automation changes who performs drafting, validation, repair, scheduling, publication, distribution, measurement, and notification. It does not create additional editorial slots or silently alter existing scheduled dates.

Safe work follows:

`discover -> score -> admit -> draft -> validate -> repair -> schedule in next legal existing slot -> build -> publish -> distribute -> notify -> measure`

Unsupported, duplicate, protected, or prohibited work is skipped and recorded without blocking unrelated safe work.

## Public search surfaces

The existing NAV pages preserve their prior structure and voice while adding restrained, accurate Memphis and Black woman therapist context. Two standalone indexable service pages support explicit local intent:

- `/black-therapist-memphis/`
- `/anxiety-therapist-memphis/`

They are sitemap-listed and internally linked. They are not doorway pages and are not placed in the primary NAV.

## Admin and growth command center

- `/admin/` and `/agency/` use the same lightweight client-side password gate (`blackgirlmagic`) for owner convenience.
- `/agency/` reports SEO/AEO/GEO, GSC/Bing, query ownership, free wins, competitor observations, and self-healing receipts.
- This gate is not high-security protection: the password hash is present in browser code, operational JSON is non-secret, and provider credentials remain server-side.
- No routine content approval queue exists.

## Local commands

```bash
npm ci
npm run build
npm run validate:deep
npm run release:prepush:local
```

Useful autonomous commands:

```bash
npm run autonomy:cycle
npm run publish:content
npm run autonomy:self-heal
npm run autonomy:measure
npm run notify:publish
```

Provider credentials are intentionally absent. Copy `.dev.vars.example`, install secrets through Cloudflare/GitHub, and follow `docs/runbooks/PROVIDER_ACTIVATION.md`.

## Validation authority

The public product and intended runtime behavior define correctness. Validators are independent proof probes; they do not design the site or invent requirements.

- Canonical registry: `_repo_validation_registry.json`
- Execution profiles: `_repo_validation_matrix.json`
- Deep profile: `npm run validate:deep`
- Deep proof map: `docs/runbooks/DEEP_VALIDATION_MATRIX.md`

Release-blocking checks are limited to real product, safety, security, data-integrity, cadence, crawl, and truth failures. Quality scoring, optional surfaces, and disconnected external providers remain visible but non-blocking unless the product truly cannot operate safely.
