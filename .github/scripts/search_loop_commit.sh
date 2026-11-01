#!/usr/bin/env bash
# Search loop (seq23/search-loop), commit for this site (default branch only).
# Removes the read-only site view, rebuilds (sitemap, lastmod ledger, llms.txt,
# the /questions/ hub), runs the same merge gate CI runs, and commits explicit
# paths only - never `git add -A` on a client site. A red gate pushes nothing:
# NAMED STOP, the run's report still uploads, the next run redoes today's work.
set -Eeuo pipefail
node .github/scripts/search_loop_site_view.mjs clean
# Latest main first (the content lanes share this repo), today's pages kept.
git pull --rebase --autostash origin main
npm run build >/dev/null
if ! npm run validate:all > .search-loop-validate.log 2>&1; then
  grep -E "HARD FAIL|^- |VALIDATION RESULT" .search-loop-validate.log | head -40 >&2 || true
  echo "NAMED STOP [SITE_VALIDATION_FAILED] validate:all is red with today's search-loop pages; nothing pushed." >&2
  exit 1
fi
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
# Only paths that exist: one missing pathspec (no questions/ yet) makes git add
# stage nothing at all, which silently dropped the first run's ledger.
paths=()
for p in questions data/search-loop _redirects sitemap.xml llms.txt data/cadence/lastmod_ledger.json; do
  [ -e "$p" ] && paths+=("$p")
done
git add -- "${paths[@]}"
if git diff --cached --quiet; then echo "search-loop: nothing to commit"; exit 0; fi
git commit -q -m "search loop: daily question pages, checks and ledger"
for i in 1 2 3 4 5; do
  git push origin HEAD:main && exit 0
  git pull --rebase origin main || { echo "NAMED STOP [PUSH_CONFLICT] rebase onto main failed; the next run redoes today's work" >&2; exit 9; }
done
echo "NAMED STOP [PUSH_FAILED] five push attempts failed" >&2; exit 9
