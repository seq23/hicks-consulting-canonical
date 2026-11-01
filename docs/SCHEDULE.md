# Schedule

Every scheduled GitHub Actions job in this repo. Times are Central (America/Chicago): each
`schedule:` entry carries `timezone: America/Chicago`, which GitHub Actions honours, so the clock
change in March and November no longer moves a job. Rebalanced 1 Nov 2026 (owner-approved weekly
schedule); see the notes below for what moved.

| Job | Workflow | When | Cron |
|---|---|---|---|
| Agency SEO Monitor | `agency-seo-monitor.yml` | every day 09:23 CT | `23 9 * * *` |
| Bounded Self-Healing | `autonomy-self-heal.yml` | Wed 11:11 CT | `11 11 * * 3` |
| Content Publish | `content-publish.yml` | every day 08:17 CT | `17 8 * * *` |
| Editorial Continuity Sidecar | `editorial-continuity.yml` | Wed 04:10 CT | `10 4 * * 3` |
| Entity Backlink Watch | `entity-backlink-watch.yml` | Sat 04:23 CT | `23 4 * * 6` |
| Publish Verification | `publish-verification.yml` | every day 08:47 CT | `47 8 * * *` |
| Search Loop (shared engine, question pages) | `search-loop.yml` | every day 06:53 CT | `53 6 * * *` |
| Repo Self-Healing Loop | `repo-self-heal.yml` | Sun 04:07 CT | `7 4 * * 0` |
| Social Ingestion | `social-ingestion.yml` | Tue, Fri 09:41 CT | `41 9 * * 2,5` |

## Notes

- Monday 04:00–08:00 CT is kept clear: this repo's Monday jobs moved to quiet early-morning
  slots Tuesday–Saturday on 1 Nov 2026.

## Moved on 1 Nov 2026
- Editorial Continuity Sidecar: Monday → Wednesday 04:10 CT.
