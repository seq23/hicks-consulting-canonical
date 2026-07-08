# Hicks Hybrid Admin Implementation Notes

## Scope

This update keeps the existing Hicks admin model intact and adds guardrails for a runtime-first digital products workflow.

## Non-destructive rules

- Current static content is not migrated.
- Current product status is not changed by the artifact.
- Existing GitHub-backed admin paths remain available.
- Runtime product actions do not write to GitHub.
- GitHub controls are backup/recovery/developer controls only.

## Digital products behavior

`/admin/digitalproducts/` is the runtime-first product manager.

Normal actions:

- Save Draft / Product Details: saves metadata through the digital products API.
- Publish Live: makes a product visible on public download pages after confirmation.
- Hide from Site: removes a product from public download pages after confirmation without deleting it.

Backup actions are intentionally secondary and disabled until the export/restore endpoints are implemented.

## CI validation added

- `repo-validation.yml` runs full validation, build, and local prepush gate on protected branch patterns.
- `digital-products-validation.yml` runs the focused digital-products profile and build for product/admin changes.
- `postdeploy-smoke.yml` checks key Cloudflare Pages routes, digital products API shape, admin token-safety, and the free PDF route.

## Validation boundary

This artifact was structurally checked only. Local updater validation and CI remain the runtime/build authority.
