#!/usr/bin/env bash
#
# Remove everything deploy.sh created: terminate the environment and wait for
# it, delete the application (with --terminate-env-by-force for anything the
# wait missed), empty and delete the bundle bucket. Idempotent: each step is
# skipped when its resource is already gone.
#
# Usage:
#   ./teardown.sh              tear down and wait
#   ./teardown.sh --dry-run    print every command in order; call nothing
#
# Environment overrides (default):
#   REGION (us-east-1)   NAME (genealogy-proto-worker-probe)   BUCKET (<NAME>-<account-id>)
#   WAIT_TIMEOUT_S (1500)   POLL_S (20)
#
# Left in place on purpose: the two IAM roles (shared, account-wide) and the
# elasticbeanstalk-<region>-<account-id> bucket Elastic Beanstalk manages itself.
set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run | -n) DRY_RUN=true ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

REGION="${REGION:-us-east-1}"
NAME="${NAME:-genealogy-proto-worker-probe}"
WAIT_TIMEOUT_S="${WAIT_TIMEOUT_S:-1500}"
POLL_S="${POLL_S:-20}"

# Command echo goes to the script's real stdout, even from inside $(...).
exec 3>&1

AWS=(aws --region "$REGION" --output text)
DESCRIBE_ENV=("${AWS[@]}" elasticbeanstalk describe-environments --application-name "$NAME" --environment-names "$NAME" --no-include-deleted)

say() { printf '%s\n' "$*" >&3; }
die() { say "teardown.sh: $*"; exit 1; }
PLAIN='^[A-Za-z0-9_./:=@,+-]+$'
DQ_UNSAFE='*["\\$`]*'
# quote: shell-quote one argument for the echoed command line so it pastes back.
quote() {
  if [[ "$1" =~ $PLAIN ]]; then printf '%s' "$1"
  elif [[ "$1" != *\'* ]]; then printf "'%s'" "$1"
  elif [[ "$1" != $DQ_UNSAFE ]]; then printf '"%s"' "$1"
  else printf '%q' "$1"; fi
}
show() { local line="" a; for a in "$@"; do line+=" $(quote "$a")"; done; say "+${line}"; }
# run: echo the command, then execute it (unless --dry-run).
run() { show "$@"; if ! $DRY_RUN; then "$@"; fi; }
# capture: like run, but stdout is the caller's; --dry-run yields $1 instead.
capture() { local placeholder=$1; shift; show "$@"; if $DRY_RUN; then printf '%s\n' "$placeholder"; else "$@"; fi; }
# check: like run, but --dry-run returns $1 so the branch that follows is the one shown.
check() { local dry_rc=$1; shift; show "$@"; if $DRY_RUN; then return "$dry_rc"; fi; "$@"; }
present() { [[ -n "$1" && "$1" != None ]]; }

# wait_gone: poll until the environment is Terminated or no longer listed.
wait_gone() {
  local deadline=$((SECONDS + WAIT_TIMEOUT_S)) status
  say "+ (poll describe-environments every ${POLL_S}s until Status=Terminated, up to ${WAIT_TIMEOUT_S}s)"
  if $DRY_RUN; then return 0; fi
  while :; do
    status=$("${DESCRIBE_ENV[@]}" --query 'Environments[0].Status')
    say "  $(date -u +%H:%M:%SZ) status=${status}"
    [[ "$status" == None || "$status" == Terminated ]] && return 0
    if (( SECONDS > deadline )); then
      "${AWS[@]}" elasticbeanstalk describe-events --environment-name "$NAME" --max-items 15 \
        --query 'Events[].[EventDate,Severity,Message]' >&3 || true
      die "timed out after ${WAIT_TIMEOUT_S}s waiting for termination (WAIT_TIMEOUT_S raises it)"
    fi
    sleep "$POLL_S"
  done
}

ACCOUNT_ID=$(capture '<account-id>' "${AWS[@]}" sts get-caller-identity --query Account)
BUCKET="${BUCKET:-${NAME}-${ACCOUNT_ID}}"
# This script empties and deletes whatever bucket it is pointed at, so a stray
# BUCKET in the shell must not be able to name someone else's.
[[ "$BUCKET" == "$NAME"* ]] || die "refusing to touch bucket ${BUCKET}: it does not start with ${NAME}"

# --- environment ------------------------------------------------------------------
STATUS=$(capture Ready "${DESCRIBE_ENV[@]}" --query 'Environments[0].Status')
case "$STATUS" in
  None | Terminated) say "environment ${NAME} is already gone" ;;
  Terminating) say "environment ${NAME} is already Terminating"; wait_gone ;;
  *)
    run "${AWS[@]}" elasticbeanstalk terminate-environment --environment-name "$NAME"
    wait_gone
    ;;
esac

# --- application (and any environment the wait above missed) ---------------------
APP=$(capture "$NAME" "${AWS[@]}" elasticbeanstalk describe-applications --application-names "$NAME" \
  --query 'Applications[0].ApplicationName')
if present "$APP"; then
  run "${AWS[@]}" elasticbeanstalk delete-application --application-name "$NAME" --terminate-env-by-force
else
  say "application ${NAME} is already gone"
fi

# --- bucket -----------------------------------------------------------------------
if check 0 "${AWS[@]}" s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  run "${AWS[@]}" s3 rm "s3://${BUCKET}" --recursive
  run "${AWS[@]}" s3api delete-bucket --bucket "$BUCKET"
else
  say "bucket ${BUCKET} is already gone"
fi

say ""
say "torn down: environment, application and bucket for ${NAME} in ${REGION}."
say "still present by design: IAM roles aws-elasticbeanstalk-ec2-role / aws-elasticbeanstalk-service-role,"
say "and the elasticbeanstalk-${REGION}-${ACCOUNT_ID} bucket Elastic Beanstalk keeps for itself."
