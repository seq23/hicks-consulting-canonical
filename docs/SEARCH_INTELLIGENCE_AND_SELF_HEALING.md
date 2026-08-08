# Hicks Search Intelligence + Self-Healing

## Runtime loop

`target queries -> Gemini Google-Search-grounded observations -> GSC/Bing owned-site evidence -> competitor page features -> diagnosis -> bounded safe repair -> rebuild -> later retest`

### Truth boundary
- Gemini grounding is live web surfacing/citation evidence, not literal organic rank.
- GSC supplies owned Google clicks, impressions, CTR, and average position.
- Bing Webmaster supplies Bing traffic/crawl evidence when configured.
- External search outcomes remain unproven until observed after deployment.

### Autonomous repair boundary
The Hicks runtime may automatically repair bounded search-alignment defects such as meta-description alignment and dedicated landing-page query ownership. It must not invent diagnoses, treatment outcomes, credentials, or clinical claims from competitor content.

### Required secrets
- `GEMINI_API_KEY` — Google AI Studio / Gemini Developer API key.
- Existing GSC credentials.
- Existing Bing Webmaster API key.

No secret value belongs in Git.
