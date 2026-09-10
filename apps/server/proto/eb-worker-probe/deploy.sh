#!/usr/bin/env bash
#
# Deploy the Elastic Beanstalk worker-tier probe with the aws CLI alone (no eb
# CLI). Idempotent: the first run creates everything, a re-run uploads a new
# bundle only if the source changed and updates the environment in place.
#
# Usage:
#   ./deploy.sh                          create or update; wait for Ready; print the queue URL
#   ./deploy.sh --dry-run                print every command in order; call nothing
#   INACTIVITY_TIMEOUT_S=300 ./deploy.sh redeploy with a shorter sqsd inactivity timeout
#
# Environment overrides (default):
#   REGION (us-east-1)   NAME (genealogy-proto-worker-probe)   BUCKET (<NAME>-<account-id>)
#   PYTHON_VERSION (3.12)   INSTANCE_TYPE (t3.micro)
#   INSTANCE_PROFILE (aws-elasticbeanstalk-ec2-role)   SERVICE_ROLE (aws-elasticbeanstalk-service-role)
#   HTTP_CONNECTIONS (2)   INACTIVITY_TIMEOUT_S (1800)   VISIBILITY_TIMEOUT_S (2100)   MAX_RETRIES (10)
#   WAIT_TIMEOUT_S (1500)   POLL_S (20)
#
# Every AWS resource is named $NAME; the bucket is $NAME-<account-id>.
set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run | -n) DRY_RUN=true ;;
    -h | --help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

REGION="${REGION:-us-east-1}"
NAME="${NAME:-genealogy-proto-worker-probe}"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"
INSTANCE_PROFILE="${INSTANCE_PROFILE:-aws-elasticbeanstalk-ec2-role}"
SERVICE_ROLE="${SERVICE_ROLE:-aws-elasticbeanstalk-service-role}"
HTTP_CONNECTIONS="${HTTP_CONNECTIONS:-2}"
INACTIVITY_TIMEOUT_S="${INACTIVITY_TIMEOUT_S:-1800}"
VISIBILITY_TIMEOUT_S="${VISIBILITY_TIMEOUT_S:-2100}"
MAX_RETRIES="${MAX_RETRIES:-10}"
WAIT_TIMEOUT_S="${WAIT_TIMEOUT_S:-1500}"
POLL_S="${POLL_S:-20}"

BUNDLE_FILES=(application.py Procfile .ebextensions .platform)

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# Command echo goes to the script's real stdout, even from inside $(...).
exec 3>&1

AWS=(aws --region "$REGION" --output text)
DESCRIBE_ENV=("${AWS[@]}" elasticbeanstalk describe-environments --application-name "$NAME" --environment-names "$NAME" --no-include-deleted)

say() { printf '%s\n' "$*" >&3; }
die() { say "deploy.sh: $*"; exit 1; }
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
digest() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; }

env_status() { "${DESCRIBE_ENV[@]}" --query 'Environments[0].Status'; }

recent_events() {
  "${AWS[@]}" elasticbeanstalk describe-events --environment-name "$NAME" --max-items 15 \
    --query 'Events[].[EventDate,Severity,Message]' >&3 || true
}

# wait_env <target-status>: poll until the environment reaches it.
# Target "None" means "gone" (used while a previous copy is Terminating).
wait_env() {
  local target=$1 deadline=$((SECONDS + WAIT_TIMEOUT_S)) status health
  say "+ (poll describe-environments every ${POLL_S}s until Status=${target}, up to ${WAIT_TIMEOUT_S}s)"
  if $DRY_RUN; then return 0; fi
  while :; do
    status=$(env_status)
    health=$("${DESCRIBE_ENV[@]}" --query 'Environments[0].[Health,HealthStatus]' | tr '\t' '/')
    say "  $(date -u +%H:%M:%SZ) status=${status} health=${health}"
    [[ "$status" == "$target" ]] && return 0
    if [[ "$target" != None && ( "$status" == None || "$status" == Terminated ) ]]; then
      recent_events; die "environment $NAME is ${status}, expected ${target}"
    fi
    if (( SECONDS > deadline )); then
      recent_events; die "timed out after ${WAIT_TIMEOUT_S}s waiting for Status=${target} (WAIT_TIMEOUT_S raises it)"
    fi
    sleep "$POLL_S"
  done
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- account, roles ---------------------------------------------------------------
ACCOUNT_ID=$(capture '<account-id>' "${AWS[@]}" sts get-caller-identity --query Account)
BUCKET="${BUCKET:-${NAME}-${ACCOUNT_ID}}"

INSTANCE_ROLE_ARN=$(capture "arn:aws:iam::<account-id>:role/${INSTANCE_PROFILE}" "${AWS[@]}" iam get-instance-profile \
  --instance-profile-name "$INSTANCE_PROFILE" --query 'InstanceProfile.Roles[0].Arn') \
  || die "instance profile ${INSTANCE_PROFILE} not found: create it first (README.md, 'One-time IAM prerequisites')"
present "$INSTANCE_ROLE_ARN" || die "instance profile ${INSTANCE_PROFILE} has no role attached (README.md, 'One-time IAM prerequisites')"
capture "arn:aws:iam::<account-id>:role/${SERVICE_ROLE}" "${AWS[@]}" iam get-role --role-name "$SERVICE_ROLE" --query Role.Arn >/dev/null \
  || die "service role ${SERVICE_ROLE} not found: create it first (README.md, 'One-time IAM prerequisites')"

# --- source bundle ----------------------------------------------------------------
# The version label is a hash of the bundle's file names and contents, not of the
# zip (zip embeds mtimes), so an unchanged tree re-deploys nothing.
LABEL="v-$(find "${BUNDLE_FILES[@]}" -type f | LC_ALL=C sort | while read -r f; do printf '%s\0' "$f"; cat "$f"; done | digest | cut -c1-12)"
ZIP="${TMP}/${NAME}-${LABEL}.zip"
KEY="${LABEL}.zip"
say "version label: ${LABEL}"
run zip -X -q -r "$ZIP" "${BUNDLE_FILES[@]}"

# --- bucket -----------------------------------------------------------------------
if check 1 "${AWS[@]}" s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  say "bucket ${BUCKET} exists"
elif [[ "$REGION" == us-east-1 ]]; then
  run "${AWS[@]}" s3api create-bucket --bucket "$BUCKET"
else
  run "${AWS[@]}" s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=${REGION}"
fi
# The default instance profile can read only elasticbeanstalk-* buckets; the
# instances download the bundle themselves, so grant the role read on this one.
POLICY=$(printf '{"Version":"2012-10-17","Statement":[{"Sid":"EbInstancesReadBundle","Effect":"Allow","Principal":{"AWS":"%s"},"Action":["s3:GetObject","s3:ListBucket"],"Resource":["arn:aws:s3:::%s","arn:aws:s3:::%s/*"]}]}' \
  "$INSTANCE_ROLE_ARN" "$BUCKET" "$BUCKET")
run "${AWS[@]}" s3api put-bucket-policy --bucket "$BUCKET" --policy "$POLICY"
run "${AWS[@]}" s3 cp "$ZIP" "s3://${BUCKET}/${KEY}"

# --- application + version --------------------------------------------------------
APP=$(capture None "${AWS[@]}" elasticbeanstalk describe-applications --application-names "$NAME" \
  --query 'Applications[0].ApplicationName')
if present "$APP"; then
  say "application ${NAME} exists"
else
  run "${AWS[@]}" elasticbeanstalk create-application --application-name "$NAME" \
    --description "Worker-tier probe: sqsd contract, InactivityTimeout, bundle cap, .ebextensions rule"
fi

VERSION=$(capture None "${AWS[@]}" elasticbeanstalk describe-application-versions --application-name "$NAME" \
  --version-labels "$LABEL" --query 'ApplicationVersions[0].VersionLabel')
if present "$VERSION"; then
  say "application version ${LABEL} exists"
else
  run "${AWS[@]}" elasticbeanstalk create-application-version --application-name "$NAME" \
    --version-label "$LABEL" --source-bundle "S3Bucket=${BUCKET},S3Key=${KEY}"
fi

# --- environment ------------------------------------------------------------------
STACK=$(capture "64bit Amazon Linux 2023 v<latest> running Python ${PYTHON_VERSION}" "${AWS[@]}" elasticbeanstalk list-available-solution-stacks \
  --query "SolutionStacks[?contains(@, '64bit Amazon Linux 2023') && contains(@, 'running Python ${PYTHON_VERSION}')]" \
  | tr '\t' '\n' | sort -V | tail -n 1)
present "$STACK" || die "no '64bit Amazon Linux 2023 ... running Python ${PYTHON_VERSION}' solution stack is available (PYTHON_VERSION overrides)"
say "solution stack: ${STACK}"

OPTS=(
  "Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=${INSTANCE_PROFILE}"
  "Namespace=aws:ec2:instances,OptionName=InstanceTypes,Value=${INSTANCE_TYPE}"
  "Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=1"
  "Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=1"
  "Namespace=aws:elasticbeanstalk:environment,OptionName=ServiceRole,Value=${SERVICE_ROLE}"
  "Namespace=aws:elasticbeanstalk:sqsd,OptionName=HttpPath,Value=/"
  "Namespace=aws:elasticbeanstalk:sqsd,OptionName=HttpConnections,Value=${HTTP_CONNECTIONS}"
  "Namespace=aws:elasticbeanstalk:sqsd,OptionName=InactivityTimeout,Value=${INACTIVITY_TIMEOUT_S}"
  "Namespace=aws:elasticbeanstalk:sqsd,OptionName=VisibilityTimeout,Value=${VISIBILITY_TIMEOUT_S}"
  "Namespace=aws:elasticbeanstalk:sqsd,OptionName=MaxRetries,Value=${MAX_RETRIES}"
)

STATUS=$(capture None "${DESCRIBE_ENV[@]}" --query 'Environments[0].Status')
case "$STATUS" in
  Terminating)
    say "environment ${NAME} is Terminating; waiting for it to go away before creating"
    wait_env None
    STATUS=None
    ;;
  Launching | Updating)
    say "environment ${NAME} is ${STATUS}; waiting for Ready before updating"
    wait_env Ready
    STATUS=Ready
    ;;
esac

if [[ "$STATUS" == None ]]; then
  run "${AWS[@]}" elasticbeanstalk create-environment --application-name "$NAME" --environment-name "$NAME" \
    --tier "Name=Worker,Type=SQS/HTTP" --solution-stack-name "$STACK" \
    --version-label "$LABEL" --option-settings "${OPTS[@]}"
else
  DEPLOYED=$(capture '<deployed-label>' "${DESCRIBE_ENV[@]}" --query 'Environments[0].VersionLabel')
  UPDATE=("${AWS[@]}" elasticbeanstalk update-environment --environment-name "$NAME" --option-settings "${OPTS[@]}")
  if [[ "$DEPLOYED" != "$LABEL" ]]; then
    UPDATE+=(--version-label "$LABEL")
  else
    say "environment already runs ${LABEL}; updating option settings only"
  fi
  run "${UPDATE[@]}"
fi
wait_env Ready

# --- what to do next --------------------------------------------------------------
QUEUE_URL=$(capture '<queue-url>' "${AWS[@]}" elasticbeanstalk describe-environment-resources --environment-name "$NAME" \
  --query "EnvironmentResources.Queues[?Name=='WorkerQueue'].URL | [0]")
say ""
say "environment: ${NAME} (${REGION}), version ${LABEL}, InactivityTimeout=${INACTIVITY_TIMEOUT_S}s"
say "queue URL:   ${QUEUE_URL}"
say ""
say "send a 5 s message:   aws --region ${REGION} sqs send-message --queue-url '${QUEUE_URL}' --message-body '{\"sleep_s\": 5}'"
say "send the real one:    aws --region ${REGION} sqs send-message --queue-url '${QUEUE_URL}' --message-body '{}'"
say "app log:              aws --region ${REGION} logs tail /aws/elasticbeanstalk/${NAME}/var/log/web.stdout.log --follow"
say "sqsd log:             aws --region ${REGION} logs tail /aws/elasticbeanstalk/${NAME}/var/log/aws-sqsd/default.log --follow"
