# Repository Update Runbook

**Repository:** `hicks-consulting-canonical`  
**Updater:** `update_repo_from_zip_generic_v3_1.sh`  
**Mode:** `snapshot`  
**Contract:** `/_repo_update_contract.json`

## Baseline naming

`hicks-consulting-canonical-main_BASELINE_MM-DD-YY_<hex>.zip`

## Local prepush

The v3.1 updater resolves `commands.prepush_local` to:

`npm run release:prepush:local`

This prints `release:prepush profile: LOCAL_FULL`, runs the production build, then runs the complete validation registry.

## Large-delete execution

Use `ALLOW_LARGE_DELETE=1` only after reviewing the updater dry-run deletion count and only with a full baseline ZIP from the confirmed repository root. The updater still performs ZIP safety, identity, branch, clean-tree, install, build, validation, commit, push, and safety-tag controls.

## Failure policy

Any install, build, hard validator, validator execution, commit, or push failure stops the updater. SEO/AEO/GEO business findings remain non-blocking according to the validation registry.

## Updater v3.1 build-directory compatibility

The generic updater excludes directories named `build` at any depth. The canonical production build entrypoint therefore lives at `scripts/site_build.js`, not `scripts/build/build.js`. `release:prepush:local` removes the legacy `scripts/build/` directory before validation so an older tracked copy cannot survive snapshot application and bypass agency report generation.
