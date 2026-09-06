#!/usr/bin/env bash
# One-time setup of branch protection rules for aihu-project/aihu main branch.
# Requires gh CLI authenticated as a repo admin.
#
# Usage: bash scripts/setup-branch-protection.sh
#
# Idempotent — safe to re-run; gh API PUT replaces the rules atomically, which
# is exactly why the required-context list below MUST stay in sync with
# .github/workflows/plan-a.yml's ci-ok job by hand: `ci-ok` is the SOLE
# required context (see the comment above the `ci-ok` job) precisely so that
# doc-only PRs — where `check`/`examples` legitimately SKIP — can still merge.
# Requiring `check`/`examples` directly (as this script once did) makes every
# doc-only PR permanently unmergeable, since a skipped required context never
# reports success. `enforce_admins=false` was the workaround for that self-
# inflicted hole — see FEL-429, which exists specifically to eliminate
# enforce_admins=false as a workaround for gate defects, not to reintroduce one
# here. Re-running this script with the old contexts would silently detach the
# whole gate model on the next PUT.

set -euo pipefail

REPO="aihu-project/aihu"
BRANCH="main"

echo "Configuring branch protection for $REPO@$BRANCH..."

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "/repos/$REPO/branches/$BRANCH/protection" \
  -f "required_status_checks[strict]=true" \
  -F "required_status_checks[contexts][]=ci-ok" \
  -f "enforce_admins=true" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "required_pull_request_reviews[dismiss_stale_reviews]=false" \
  -F "required_pull_request_reviews[require_code_owner_reviews]=false" \
  -f "restrictions=null" \
  -f "allow_force_pushes=false" \
  -f "allow_deletions=false" \
  -f "block_creations=false" \
  -f "required_conversation_resolution=true" \
  -f "lock_branch=false" \
  -f "allow_fork_syncing=false"

echo "Done. Branch protection applied."
echo ""
echo "To verify:"
echo "  gh api /repos/$REPO/branches/$BRANCH/protection | jq"
