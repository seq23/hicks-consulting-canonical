# LLM Ingestion Route Runbook

## Purpose
Expose machine-readable atlas, query, cluster, fanout, source-health, and answer-surface routes to crawlers and LLMs while keeping them out of normal user navigation.

## Route policy
LLM-only routes are direct-URL and crawler discoverable through `sitemap.xml` and `llms.txt`.
They must not appear in main nav, mobile nav, homepage cards, footer primary nav, or public resource grids.

## Current route family
- `/llm-atlas/`
- `/llm-atlas/fanouts/`
- `/llm-atlas/queries/`
- `/llm-atlas/pillars/`
- `/llm-atlas/clusters/`
- `/llm-atlas/social-signals/`
- `/llm-atlas/source-health/`
- `/llm-atlas/answer-surfaces/`

## Validation policy
Hidden-route validators are advisory because these pages are owner/LLM infrastructure, not client-facing UX. Warnings should still be fixed before shipping.
