#!/usr/bin/env bash
#
# Consolidate `main` protection onto the `protect-main` ruleset, retire the
# overlapping classic branch-protection rule, and (optionally) require status
# checks to pass before merge.
#
# WHY CONSOLIDATE. As of 2026-07-29 both mechanisms guard `main` and disagree:
#
#                              classic protection    protect-main ruleset
#   required approvals                 2                      1
#   require_last_push_approval       false                   true
#   require_code_owner_review         true                   true
#   dismiss_stale_reviews            false                   false
#
# GitHub applies the most restrictive of the two, so the effective policy is
# 2 approvals + code owner + last-push-approval. Correct, but unreadable:
# anyone checking `/branches/main/protection` concludes last-push-approval is
# off, and anyone checking the ruleset concludes one approval is enough.
#
# ORDER MATTERS. The ruleset requires only 1 approval today. Deleting classic
# protection first would drop `main` from 2 approvals to 1 until the ruleset is
# raised. This script raises the ruleset first and refuses to delete until it
# has verified the new value landed.
#
# NOT LOST BY DELETING CLASSIC PROTECTION. Force pushes and branch deletion are
# already covered by the ruleset's `non_fast_forward` and `deletion` rules.
# Every other classic toggle (signatures, linear history, conversation
# resolution, block creations, lock branch) is currently disabled.
#
# MAINTAINER CAN STILL MERGE RED PRs. The ruleset has one bypass actor —
# user 240745 (DallanQ), mode `always`. Bypass covers every rule in the
# ruleset, required status checks included, so adding them in step 4 blocks
# the team on red CI without blocking the maintainer. This is the reason the
# checks belong in the RULESET and not in classic protection, whose
# `enforce_admins: false` we are deleting.
#
# Usage:
#   ./.github/scripts/consolidate-branch-protection.sh                    # dry run
#   APPLY=1 ./.github/scripts/consolidate-branch-protection.sh            # steps 1-3
#   APPLY=1 REQUIRE_CHECKS=1 ./.github/scripts/consolidate-branch-protection.sh
#                                                                         # + step 4

set -euo pipefail

REPO="${REPO:-PioneerAIAcademy/cowork-genealogy}"
RULESET_ID="${RULESET_ID:-17125816}"
BRANCH="${BRANCH:-main}"
WANT_APPROVALS="${WANT_APPROVALS:-2}"
APPLY="${APPLY:-0}"
REQUIRE_CHECKS="${REQUIRE_CHECKS:-0}"

# Contexts to require in step 4. MUST be checks that report on EVERY pull
# request — see the preflight in step 4 for why, and read it before editing
# this list.
REQUIRED_CONTEXTS="${REQUIRED_CONTEXTS:-pytest check vitest scan}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say() { printf '\n=== %s ===\n' "$1"; }

say "current: ruleset $RULESET_ID"
gh api "repos/$REPO/rulesets/$RULESET_ID" \
  --jq '.rules[] | select(.type=="pull_request") | .parameters'

say "current: classic protection on $BRANCH"
gh api "repos/$REPO/branches/$BRANCH/protection" \
  --jq '.required_pull_request_reviews // "none"' 2>/dev/null \
  || echo "none (already removed)"

if [ "$APPLY" != "1" ]; then
  cat <<EOF

DRY RUN. Would:
  1. set ruleset $RULESET_ID pull_request.required_approving_review_count = $WANT_APPROVALS
  2. verify that value round-trips
  3. DELETE classic branch protection on $BRANCH
$([ "$REQUIRE_CHECKS" = "1" ] && echo "  4. require status checks: $REQUIRED_CONTEXTS")

Re-run with APPLY=1 to execute.
EOF
  exit 0
fi

# --- 1. raise the ruleset -----------------------------------------------------
# Fetch and patch rather than hand-authoring the body, so bypass_actors,
# conditions, and the deletion/non_fast_forward rules survive untouched.
say "step 1: raising ruleset to $WANT_APPROVALS approvals"
gh api "repos/$REPO/rulesets/$RULESET_ID" > "$tmp/current.json"

jq --argjson n "$WANT_APPROVALS" '{
  name, target, enforcement, bypass_actors, conditions,
  rules: (.rules | map(
    if .type == "pull_request"
    then .parameters.required_approving_review_count = $n
    else . end
  ))
}' "$tmp/current.json" > "$tmp/next.json"

gh api --method PUT "repos/$REPO/rulesets/$RULESET_ID" --input "$tmp/next.json" > /dev/null

# --- 2. verify before doing anything destructive ------------------------------
say "step 2: verifying"
got="$(gh api "repos/$REPO/rulesets/$RULESET_ID" \
  --jq '.rules[] | select(.type=="pull_request") | .parameters.required_approving_review_count')"

if [ "$got" != "$WANT_APPROVALS" ]; then
  echo "ABORT: ruleset reports $got approvals, wanted $WANT_APPROVALS." >&2
  echo "Classic protection left in place; main is still guarded." >&2
  exit 1
fi
echo "ruleset now requires $got approvals"

# --- 3. retire classic protection --------------------------------------------
say "step 3: deleting classic branch protection on $BRANCH"
gh api --method DELETE "repos/$REPO/branches/$BRANCH/protection" 2>/dev/null \
  && echo "deleted" || echo "already absent"

# --- 4. required status checks (opt-in) ---------------------------------------
if [ "$REQUIRE_CHECKS" != "1" ]; then
  cat <<'EOF'

STEP 4 SKIPPED (REQUIRE_CHECKS=1 to enable).

No status check is required to merge today, so a PR with failing CI can be
merged on approvals alone. Before turning that on, read the preflight note in
step 4 of this script: most of our checks are path-filtered, and a required
check that never reports blocks its PR forever.
EOF
  exit 0
fi

say "step 4 preflight: do the required contexts report on every open PR?"

# A required status check that never reports leaves the PR stuck on
# "Expected — waiting for status to be reported", with no way forward except a
# bypass actor. Four of our PR workflows are path-filtered
# (check-e2e-fixtures, check-engine-lockfile, check-runlogs, engine-tests,
# eval-harness-tests), so `pytest`/`check`/`vitest` are absent from any PR that
# touches none of their paths — a docs-only change, an apps/web change, or a
# .github-only change. Requiring them before those workflows run unconditionally
# would deadlock exactly those PRs.
#
# So: refuse unless every required context is currently reporting on every open
# PR. This is a necessary condition, not a sufficient one — it can still pass by
# luck if every open PR happens to touch the filtered paths. The real fix is to
# drop `paths:` from those workflows and early-exit inside the job instead, so
# the check always reports a conclusion.

missing=0
for pr in $(gh api "repos/$REPO/pulls?state=open&per_page=100" --paginate --jq '.[].number'); do
  sha="$(gh api "repos/$REPO/pulls/$pr" --jq '.head.sha')"
  have="$(gh api "repos/$REPO/commits/$sha/check-runs" --jq '[.check_runs[].name] | unique | join(" ")')"
  for ctx in $REQUIRED_CONTEXTS; do
    case " $have " in
      *" $ctx "*) ;;
      *) echo "  #$pr is missing '$ctx' (has: $have)"; missing=1 ;;
    esac
  done
done

if [ "$missing" = "1" ]; then
  cat <<EOF >&2

ABORT: at least one open PR would never receive a required check, and would be
unmergeable by anyone except a bypass actor.

Fix first, in a separate PR: for each path-filtered workflow, remove the
\`paths:\` filter so it runs on every pull_request, and move the filter to an
early-exit guard inside the job. The check then always reports a conclusion,
and requiring it is safe.

Steps 1-3 completed successfully; nothing about this failure has left main
under-protected.
EOF
  exit 1
fi

echo "  all required contexts present on all open PRs"

say "step 4: requiring $REQUIRED_CONTEXTS"
gh api "repos/$REPO/rulesets/$RULESET_ID" > "$tmp/pre-checks.json"

# shellcheck disable=SC2086
checks_json="$(printf '%s\n' $REQUIRED_CONTEXTS | jq -R '{context: .}' | jq -s '.')"

jq --argjson checks "$checks_json" '{
  name, target, enforcement, bypass_actors, conditions,
  rules: (
    (.rules | map(select(.type != "required_status_checks")))
    + [{
        type: "required_status_checks",
        parameters: {
          # false: do not force every branch to be up to date with main before
          # merge. With 22 PRs open that would mean a rebase storm.
          strict_required_status_checks_policy: false,
          do_not_enforce_on_create: false,
          required_status_checks: $checks
        }
      }]
  )
}' "$tmp/pre-checks.json" > "$tmp/with-checks.json"

gh api --method PUT "repos/$REPO/rulesets/$RULESET_ID" --input "$tmp/with-checks.json" > /dev/null

say "final state"
gh api "repos/$REPO/rulesets/$RULESET_ID" --jq '.rules[] | {(.type): .parameters}'
