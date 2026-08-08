# Hicks Search Intelligence + Self-Healing

The Agency SEO Monitor runs the governed target-query panel against Gemini Google Search grounding when `GEMINI_API_KEY` is configured, combines those observations with GSC and Bing evidence, inspects surfaced competitor pages, builds a diagnosis/action queue, applies only bounded Hicks-safe search alignment repairs, rebuilds the site, and leaves every external outcome marked unproven until a later observation cycle.

## Truth boundary
- Gemini grounding is live web/search evidence and citation surfacing, not literal organic rank.
- GSC is the source of truth for Hicks Google clicks, impressions, CTR, and average position.
- Bing Webmaster evidence remains provider-specific.
- Search repairs do not copy competitor text or invent clinical claims.
- A successful local/build repair is not reported as a ranking win. The next external cycle must observe the outcome.

## Required secrets
Configure in GitHub Actions only; never commit values:
`GEMINI_API_KEY`, GSC credentials, `BING_SITE_URL`, and `BING_WEBMASTER_API_KEY`.
