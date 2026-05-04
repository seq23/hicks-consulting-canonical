# Hicks Consulting Canonical

Static canonical site scaffold for Hicks Consulting.

## What this repo includes
- Public site for therapy, coaching, groups, corporate speaking, resources, and legal pages
- Hybrid/manual publishing model scaffold
- `/admin` page with a lightweight password gate and local approval/revoke demo behavior
- Launch seed content for daily, weekly, monthly, and quarterly resource types
- Machine-readable LLM support files (`llms.txt`, `answers.json`, `coverage.json`, query maps, entity registry)
- Simplified hard-fail validator set focused on trust, crawlability, compliance, and routing integrity

## Important note about `/admin`
The `/admin` route in this scaffold uses a simple front-end password gate. It is not real security. It is suitable only as a launch scaffold. A production-hardened version should move admin protection to Cloudflare Access or another server-side/edge control.

## Local commands
```bash
npm run build
npm run validate:all
```

## Deployment
1. Create the GitHub repo `seq23/hicks-consulting-canonical`
2. Push the contents of this repo
3. Connect the repo to Cloudflare Pages
4. Set the production domain to `www.hicksconsulting.org`
5. Confirm the booking, coaching, and training inquiry endpoints in `data/system/config.json`
6. Replace the admin password placeholder hash strategy as desired before production use

## Content workflow
- Current live resources are marked `published`
- Other resources can be marked `draft`, `ready_for_approval`, `approved`, `published`, or `revoked`
- The static build ships only published resource pages

## Validators
Hard-fail validators cover:
- required root/deploy files
- canonical URL integrity
- crawl and sitemap parity
- internal links
- query-to-page mapping
- short-answer blocks above the fold
- entity coverage
- publish-state integrity
- policy/compliance rules


## Admin model

This repo uses a GitHub-backed approval model. The source of truth is `data/admin/content_manifest.json`.

- `/admin/` is a same-domain operator dashboard
- only validation-passed items appear there
- approval and revoke happen by editing the manifest in GitHub
- scheduled workflows auto-publish approved items when `publishAt` is reached
- the static build only ships published resource pages
