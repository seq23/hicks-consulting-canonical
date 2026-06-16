# Hicks Consulting Agency SEO / AEO / GEO Master Plan

## 1. Authority and non-negotiable constraints

This plan treats the repository as the source of truth and upgrades the system in place.

Locked constraints:

- Preserve the existing website architecture, design system, services, routing model, content calendar, and automated publishing schedule.
- Do not pause or gate scheduled publishing for SEO quality findings.
- SEO, AEO, GEO, GSC, Bing, similarity, and live-runtime findings are warnings only.
- Do not automatically unpublish, redirect, merge, or rewrite public content.
- Rewrite only approved, unpublished pieces unless the owner explicitly expands scope.
- Preserve each unpublished piece’s subject, manifest identity, URL, status, and scheduled publication date.
- Use selective search-title optimization without changing the article’s subject or H1.
- Exclude security and privacy from the agency scorecard by owner direction.

## 2. Target outcome

The operating target is B+ or better (87/100) for every scored category that is controllable within the locked scope:

1. Technical SEO
2. On-page SEO
3. Forward publishing readiness
4. AEO
5. GEO
6. GSC and Bing measurement health after credentials are connected
7. Live health monitoring

The dashboard reports live legacy content quality separately from forward publishing readiness. This prevents the system from pretending that untouched published pages were rewritten.

## 3. Unpublished content remediation

All approved unpublished pages are upgraded in place.

Every upgraded resource includes:

- A distinctive treatment of the existing subject and assigned angle.
- A clear opening answer rather than a generic topic introduction.
- Angle-specific sections for real-life signs, minimization, work and relationships, a gentler reframe, or reflection.
- A safe editorial perspective written with a warm, polished, direct, culturally aware voice appropriate to an educated Southern Black millennial woman, without caricature or forced dialect.
- No invented client stories, practitioner quotes, personal experiences, or claims that Monika personally observed something.
- A visible author credit linked to `/about/`.
- An author box linked to Monika’s on-site biography.
- A visible machine-readable publication date derived from the manifest schedule.
- Complete Article schema with author, author URL, datePublished, dateModified, publisher, image, and mainEntityOfPage.
- A contextual connection to therapy, coaching, groups, or organizational training based on the page subject.
- Internal links to the resource library and relevant service.
- Supporting external reading where appropriate.
- A practical next step and informational note.
- Word-count coverage at or above the repository’s existing warning floors.

Titles and subjects:

- Manifest titles, H1s, and subjects remain intact by default.
- Search `<title>` tags may be shortened independently when the original title is too long for useful search presentation.
- Slugs remain unchanged, including existing truncated slugs, because URL stability is a locked requirement for this pass.

## 4. `/agency` control tower

The `/agency/` route is a noindex operator dashboard. It loads `/data/agency/dashboard.json` and provides:

### Agency scorecard

- Technical SEO
- On-page SEO
- Live content quality
- Forward publishing readiness
- AEO
- GEO
- GSC + Bing measurement
- Live health monitoring

Each score displays:

- Numeric score
- Letter grade
- B+ threshold status
- Plain-language category definition
- Points needed to reach B+

### Warning-only live SEO QA

Warnings include:

- Missing or long titles
- Missing or poorly sized descriptions
- Missing canonicals
- Incorrect H1 counts
- Missing author-bio links
- Missing visible dates
- Missing service connections
- Missing supporting sources
- Missing direct-answer summaries
- Incomplete Article schema
- Thin internal-link coverage
- High content-similarity pairs

Every warning includes severity, affected URL, issue, and recommended improvement. Filters support severity and free-text search.

### AEO scoring and tips

AEO evaluates:

- Direct short-answer placement
- Intent-first structure
- Descriptive headings
- Visible dates
- Article schema completeness
- Author clarity

Tips focus on making answers extractable and useful without creating artificial machine-only content.

### GEO scoring and tips

GEO evaluates:

- Linked author identity
- Entity clarity
- Service/audience/geography consistency
- Supporting sources
- Internal authority connections
- Complete structured data

Tips focus on citation readiness, corroboration, and consistent entity facts.

### Search-platform health

The dashboard reads GSC and Bing snapshots and shows:

- Connector status
- Last successful refresh
- Current 28-day clicks, impressions, CTR, and average position from GSC
- Previous-period comparison
- Top Google queries
- Top Google landing pages
- Bing rank/traffic, query, and crawl data when returned by the API
- Clear setup state when credentials are not configured

### Live monitoring

The monitor checks the homepage, core services, About, Resources, sitemap, robots, and `/agency/` for:

- HTTP success
- Response time
- Content type
- Last check time
- Failed-route count

## 5. Data and automation architecture

### Generated report

`scripts/agency/generate_agency_report.js`

- Scans the built public site.
- Scans source pages for forward publishing readiness.
- Reads the manifest and separates published from approved inventory.
- Generates scores and warning details.
- Performs advisory pairwise content-similarity checks.
- Reads GSC, Bing, and live snapshots.
- Writes `data/agency/dashboard.json` and copies it into the production build.
- Never exits nonzero for an SEO quality finding.

### Monitoring connector

`scripts/agency/refresh_search_health.js`

- Runs live HTTP checks.
- Supports Google Search Console read-only monitoring through OAuth 2.0 using either a temporary access token or service-account credentials with property access.
- Supports Bing Webmaster Tools through its JSON API and API key.
- Writes snapshots even when a provider is disconnected or returns an error.
- Converts all provider failures into dashboard warnings rather than deployment blockers.

### Scheduled workflow

`.github/workflows/agency-seo-monitor.yml`

- Runs daily and on demand.
- Refreshes monitoring snapshots.
- Rebuilds the advisory report.
- Commits changed snapshots so the static `/agency/` dashboard receives updated data.
- Uses `continue-on-error` for monitoring steps and the job itself.
- Does not interact with the content publishing state machine.

## 6. GSC setup

Recommended GitHub secrets:

- `GSC_SITE_URL`: the exact Search Console property, such as `https://www.hicksconsulting.org/` or `sc-domain:hicksconsulting.org`.
- `GSC_SERVICE_ACCOUNT_EMAIL`
- `GSC_PRIVATE_KEY`

The service-account email must be granted read access to the Search Console property. `GSC_ACCESS_TOKEN` is also supported for temporary testing but is not appropriate for unattended long-term monitoring because access tokens expire.

The connector requests the read-only webmaster scope and queries Search Analytics for aggregate performance, top queries, top pages, and daily data.

## 7. Bing setup

Recommended GitHub secrets:

- `BING_SITE_URL`
- `BING_WEBMASTER_API_KEY`

The connector calls Bing Webmaster JSON endpoints for registered sites, rank and traffic statistics, query statistics, and crawl statistics. Unsupported or stale data is surfaced as a warning rather than treated as a successful fresh measurement.

## 8. Operating cadence

### Daily automated

- Existing scheduled content publishing continues unchanged.
- Live route health check.
- GSC and Bing refresh when credentials are available.
- Dashboard score and warning regeneration.

### Weekly owner review

- Review high and medium warnings.
- Review GSC query/page movers.
- Review Bing crawl and query signals.
- Review newly detected similarity pairs.
- Select only the fixes that matter; QA remains advisory.

### Monthly agency review

- Compare clicks, impressions, CTR, and position to the previous period.
- Identify pages with impressions but weak CTR.
- Identify pages ranking close to page one.
- Review service-page and conversion-path performance using available analytics.
- Review forward publishing readiness.
- Update dashboard scoring weights only when the scoring contract itself needs improvement—not to manufacture a higher grade.

### Quarterly

- Reassess entity consistency.
- Review service/search-intent coverage.
- Audit internal-link distribution.
- Review content similarity and cannibalization.
- Check whether GSC/Bing data supports selective updates to published pages.

## 9. Acceptance criteria

The remediation is complete when:

- All approved unpublished pages retain their manifest identity, schedule, URL, subject, and status.
- All approved unpublished pages contain linked author credits and author boxes to `/about/`.
- All approved unpublished pages contain a visible date and complete Article author/date schema.
- All approved unpublished pages contain a relevant service link and resource-library link.
- All approved unpublished pages meet the existing word-count warning floor.
- `/agency/` builds and loads its generated dashboard JSON.
- The dashboard displays all eight score categories, warnings, tips, similarity watchlist, and provider health.
- Monitoring failures remain non-blocking.
- Existing content publishing workflow and schedule remain enabled.
- `npm run build` and `npm run validate:all` complete under the repository’s existing validation contract.

## 10. Known locked limitation

The owner has not authorized rewrites of already published content. Therefore, the dashboard may continue to show live-content similarity or trust-signal warnings on existing public pages. Forward publishing readiness can reach B+ without falsely claiming those legacy pages were changed. A true B+ live-content-distinctiveness score may require later permission to selectively revise published pages.
