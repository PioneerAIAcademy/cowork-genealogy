#!/usr/bin/env bash
#
# Operator commands for the malachi stack. The root Makefile's malachi-* targets call this;
# README.md gives the order. Needs bash, curl, git and docker, nothing from the repo's
# toolchains, so it runs from a plain clone. Inputs arrive as environment: Make hands its
# command-line variables down (EDGE=off, BASE_URL=, SERVICE=, EMAIL=, CONFIRM=yes, ...).
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
TEMPLATE=$HERE/env.template
ENV_FILE=${MALACHI_ENV:-$HOME/.config/genealogy-beta/env}
STACK=${MALACHI_PROJECT:-genealogy-beta}
MARKER=.genealogy-beta
SECRET_KEYS="POSTGRES_PASSWORD DML_PASSWORD MINIO_ROOT_PASSWORD SESSION_SECRET FS_TOKEN_ENC_KEY"
REQUIRED_KEYS="PUBLIC_URL DATA_DIR MINIO_ROOT_USER $SECRET_KEYS"
# web/auth.py's DEV_SESSION_SECRET and grants.py's DEV_FS_TOKEN_ENC_KEY.
DEV_VALUES="dev-insecure-secret-change-me dev-insecure-fs-token-key-change-me"
DEFAULT_WIKI_URL=https://malachi.taild68f1b.ts.net/wiki
DEFAULT_POP_STATS_URL=https://malachi.taild68f1b.ts.net/pop-stats

FAILED=0

die() {
  printf 'malachi: %s\n' "$*" >&2
  exit 1
}

ok() { printf '  ok    %s\n' "$*"; }
skip() { printf '  skip  %s\n' "$*"; }
bad() {
  printf '  FAIL  %s\n' "$*"
  FAILED=1
}

# A whole number, or die: a typo must not read as zero and pass a floor.
whole_number() { # name value
  case $2 in
    '' | *[!0-9]*) die "$1 must be a whole number, got '$2'" ;;
  esac
  printf '%s' "$2"
}

# ── the env file ─────────────────────────────────────────────────────────────

env_get() { # key [file]
  sed -n "s/^$1=//p" "${2:-$ENV_FILE}" | tail -n 1
}

env_keys() { # file
  sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$1"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

random_secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

is_secret() {
  case " $SECRET_KEYS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# What a key gets the one time it is written: a secret is generated, and the three settings
# a first bring-up names come from the environment.
new_value() { # key template_value
  if is_secret "$1"; then
    random_secret
    return
  fi
  case $1 in
    PUBLIC_URL | DATA_DIR | ALLOWED_EMAILS) printf '%s' "${!1:-$2}" ;;
    *) printf '%s' "$2" ;;
  esac
}

create_env() {
  local data_dir=${DATA_DIR:-$(env_get DATA_DIR "$TEMPLATE")}
  [ ! -e "$data_dir/$MARKER" ] ||
    die "$data_dir already holds a stack but $ENV_FILE is missing. Restore that file: new secrets lock out the data."
  mkdir -p "$(dirname "$ENV_FILE")"
  local tmp line key
  tmp=$(mktemp "$ENV_FILE.XXXXXX")
  chmod 600 "$tmp"
  while IFS= read -r line; do
    case $line in
      [A-Z]*=*)
        key=${line%%=*}
        printf '%s=%s\n' "$key" "$(new_value "$key" "${line#*=}")" >>"$tmp"
        ;;
      *) printf '%s\n' "$line" >>"$tmp" ;;
    esac
  done <"$TEMPLATE"
  mv "$tmp" "$ENV_FILE"
  printf 'malachi: wrote %s\n' "$ENV_FILE"
}

append_new_keys() {
  local key
  for key in $(env_keys "$TEMPLATE"); do
    if ! grep -q "^$key=" "$ENV_FILE"; then
      printf '%s=%s\n' "$key" "$(new_value "$key" "$(env_get "$key" "$TEMPLATE")")" >>"$ENV_FILE"
      printf 'malachi: added %s to %s\n' "$key" "$ENV_FILE"
    fi
  done
}

check_env_mode() {
  [ "$(file_mode "$ENV_FILE")" = 600 ] || die "$ENV_FILE must be mode 600: chmod 600 it"
}

check_env_values() {
  local key value dev
  for key in $REQUIRED_KEYS; do
    value=$(env_get "$key")
    [ -n "$value" ] || die "$key is blank in $ENV_FILE. Put the value back; a new secret would lock out the data."
    for dev in $DEV_VALUES; do
      [ "$value" != "$dev" ] || die "$key in $ENV_FILE is a development default"
    done
  done
}

cmd_env_init() {
  if [ -e "$ENV_FILE" ]; then
    check_env_mode
    append_new_keys
  else
    create_env
  fi
  check_env_values
}

# Shell variables beat --env-file, so a stray exported FS_TOKEN_ENC_KEY would replace the
# real key without a word. Everything the env file names, and EDGE_PORT, comes from the file.
load_env() {
  [ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE: run make malachi-up"
  check_env_mode
  check_env_values
  DATA=$(env_get DATA_DIR)
  case $DATA in
    /*) ;;
    *) die "DATA_DIR must be an absolute path, got '$DATA'" ;;
  esac
  EDGE_PORT_VALUE=$(env_get EDGE_PORT)
  EDGE_PORT_VALUE=${EDGE_PORT_VALUE:-8006}
  PUBLIC_URL_VALUE=$(env_get PUBLIC_URL)
  local key
  for key in $(env_keys "$ENV_FILE") EDGE_PORT; do
    unset "$key"
  done
  GIT_SHA=$(git -C "$ROOT" rev-parse HEAD)
  EDGE_CONF_SHA=$(git -C "$ROOT" hash-object "$HERE/nginx.conf")
  export GIT_SHA EDGE_CONF_SHA
}

compose() {
  docker compose -p "$STACK" --env-file "$ENV_FILE" -f "$HERE/compose.yml" "$@"
}

psql_exec() { # database sql
  compose exec -T postgres psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -Atc "$2"
}

# ── up, down, logs ───────────────────────────────────────────────────────────

check_memory() {
  local floor available
  floor=$(whole_number MIN_FREE_MEM_GB "${MIN_FREE_MEM_GB:-4}")
  if [ ! -r /proc/meminfo ]; then
    skip "free memory: no /proc/meminfo here"
    return
  fi
  available=$(($(sed -n 's/^MemAvailable: *\([0-9]*\) kB/\1/p' /proc/meminfo) / 1048576))
  [ "$available" -ge "$floor" ] ||
    die "$available GB of memory free, under the ${floor} GB floor: a build here can get wiki-query-api killed. MIN_FREE_MEM_GB= overrides."
}

check_disk() { # path floor_gb what
  local available
  available=$(($(df -Pk "$1" | awk 'NR == 2 { print $4 }') / 1048576))
  if [ "$available" -ge "$2" ]; then
    ok "$3: $available GB free"
  else
    bad "$3: $available GB free, want at least $2 GB"
  fi
}

prepare_data_dir() {
  if [ ! -d "$DATA" ]; then
    (umask 077 && mkdir -p "$DATA")
    : >"$DATA/$MARKER"
  elif [ ! -e "$DATA/$MARKER" ]; then
    [ -z "$(ls -A "$DATA")" ] || die "$DATA is not empty and holds no $MARKER: not this stack's. Refusing to use it."
    : >"$DATA/$MARKER"
  fi
  (umask 077 && mkdir -p "$DATA/postgres" "$DATA/minio" "$DATA/backups" "$DATA/exports")
}

edge_setting() {
  case ${EDGE:-} in
    '' | on) printf on ;;
    off) printf off ;;
    *) die "EDGE must be on or off, got '$EDGE'" ;;
  esac
}

cmd_up() {
  local edge
  edge=$(edge_setting)
  cmd_env_init
  load_env
  check_memory
  prepare_data_dir
  compose up -d --build web tools
  # --wait fails the moment a one-shot exits, so it names the long-running services only.
  compose up -d --wait postgres minio web tools
  if [ "$edge" = off ]; then
    compose stop edge
    printf 'malachi: edge stopped; nothing of this stack holds port %s\n' "$EDGE_PORT_VALUE"
  else
    compose up -d --wait edge
  fi
}

cmd_logs() {
  load_env
  local tail follow=()
  tail=$(whole_number TAIL "${TAIL:-200}")
  [ -z "${FOLLOW:-}" ] || follow=(--follow)
  compose logs --tail "$tail" ${follow[@]+"${follow[@]}"} ${SERVICE:+"$SERVICE"}
}

cmd_down() {
  load_env
  compose down --remove-orphans
  printf 'malachi: stack stopped; data kept in %s\n' "$DATA"
}

cmd_wipe() {
  [ "${CONFIRM:-}" = yes ] || die "this deletes every project: pass CONFIRM=yes"
  load_env
  [ -e "$DATA/$MARKER" ] || die "$DATA holds no $MARKER: not this stack's. Refusing to delete from it."
  compose down --remove-orphans
  # Root and uid 70 own these on Linux, so the delete runs as root in a container.
  compose run --rm --no-deps -T --entrypoint rm -v "$DATA:/wipe" postgres -rf /wipe/postgres /wipe/minio
  compose down --remove-orphans
  printf 'malachi: removed %s/postgres and %s/minio; kept %s/backups, %s/exports and %s\n' \
    "$DATA" "$DATA" "$DATA" "$DATA" "$ENV_FILE"
}

# ── checks ───────────────────────────────────────────────────────────────────

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" || true
}

expect_code() { # label want url [curl args]
  local label=$1 want=$2 url=$3 got
  shift 3
  got=$(http_code ${1+"$@"} "$url")
  if [ "$got" = "$want" ]; then
    ok "$label: $got"
  else
    bad "$label: got $got, want $want ($url)"
  fi
}

check_http() { # base url
  local base=${1%/} out code headers
  printf 'checking %s\n' "$base"
  expect_code "/livez" 200 "$base/livez"

  out=$(curl -s -w '\n%{http_code}' --max-time 15 "$base/.well-known/oauth-protected-resource/mcp" || true)
  code=${out##*$'\n'}
  if [ "$code" = 200 ] && printf '%s' "$out" | grep -Eq '"resource" *: *"[^"]*/mcp"'; then
    ok "metadata names /mcp"
  else
    bad "metadata: got $code and no resource ending /mcp"
  fi

  headers=$(curl -s -D - -o /dev/null --max-time 15 -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$base/mcp" || true)
  if printf '%s' "$headers" | head -n 1 | grep -q ' 401' &&
    printf '%s' "$headers" | grep -Eiq '^www-authenticate: *Bearer resource_metadata='; then
    ok "unauthenticated POST /mcp: 401 with WWW-Authenticate"
  else
    bad "unauthenticated POST /mcp: want 401 with WWW-Authenticate naming the metadata; got: $(printf '%s' "$headers" | head -n 1)"
  fi

  expect_code "/healthz" 404 "$base/healthz"
  expect_code "/api/health" 404 "$base/api/health"
  expect_code "/index.html (no SPA)" 404 "$base/index.html"
  expect_code "/api/sessions (chat off)" 404 "$base/api/sessions"

  out=$(curl -s --max-time 15 "$base/auth/config" || true)
  if printf '%s' "$out" | grep -Eq '"familysearch" *: *true' && printf '%s' "$out" | grep -Eq '"devLogin" *: *false'; then
    ok "/auth/config: familysearch on, dev-login off"
  else
    bad "/auth/config: want familysearch true and devLogin false, got: $out"
  fi
}

container_state() { # service; prints nothing with no container
  local id
  id=$(compose ps -a -q "$1")
  [ -z "$id" ] || docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id"
}

check_service() { # service
  local id state sha
  state=$(container_state "$1")
  if [ "$state" = running/healthy ]; then
    ok "$1 healthy"
  else
    bad "$1: ${state:-no container}"
    return
  fi
  id=$(compose ps -q "$1")
  sha=$(docker inspect -f '{{index .Config.Labels "genealogy.git-sha"}}' "$id")
  if [ "$sha" = "$GIT_SHA" ]; then
    ok "$1 deployed sha $sha"
  else
    bad "$1 runs $sha; this clone is $GIT_SHA"
  fi
}

check_reach() { # label url
  local got
  got=$(compose exec -T tools node -e \
    "fetch(process.argv[1]).then((r)=>console.log(r.status),(e)=>console.log('000 '+((e.cause&&e.cause.code)||e.message)))" \
    "$2" || true)
  if [ "$got" = 200 ]; then
    ok "$1 from inside tools: $got"
  else
    bad "$1 from inside tools: $got ($2)"
  fi
}

check_public() {
  local edge=$1
  bash "$ROOT/scripts/tailscale-services.sh" check || FAILED=1
  [ "$edge" = off ] || check_http "$PUBLIC_URL_VALUE"
}

check_docker_root() {
  local root floor
  floor=$(whole_number MIN_DOCKER_FREE_GB "${MIN_DOCKER_FREE_GB:-10}")
  root=$(docker info --format '{{.DockerRootDir}}')
  if [ -d "$root" ]; then
    check_disk "$root" "$floor" "docker root"
  else
    skip "docker root $root is not on this host"
  fi
}

cmd_check() {
  local edge state wiki pop floor
  edge=$(edge_setting)
  floor=$(whole_number MIN_FREE_GB "${MIN_FREE_GB:-20}")
  load_env
  check_service web
  check_service tools

  state=$(container_state edge)
  if [ "$edge" = off ]; then
    if [ "${state%%/*}" = running ]; then
      bad "edge is running with EDGE=off"
    else
      ok "edge stopped (EDGE=off)"
    fi
  elif [ "${state%%/*}" != running ]; then
    bad "edge is not running (${state:-no container}): the public slot is closed. EDGE=off if that is meant."
  fi
  if [ -n "${BASE_URL:-}" ]; then
    check_http "$BASE_URL"
  elif [ "$edge" = off ]; then
    skip "HTTP checks: EDGE=off and no BASE_URL"
  elif [ "${state%%/*}" = running ]; then
    check_http "http://127.0.0.1:$EDGE_PORT_VALUE"
  fi

  check_disk "$DATA" "$floor" "DATA_DIR"
  check_docker_root

  if [ -n "${REACH:-}" ]; then
    wiki=$(env_get WIKI_API_URL)
    pop=$(env_get POP_STATS_URL)
    check_reach wiki "${wiki:-$DEFAULT_WIKI_URL}/openapi.json"
    check_reach pop-stats "${pop:-$DEFAULT_POP_STATS_URL}/openapi.json"
  fi
  [ -z "${PUBLIC:-}" ] || check_public "$edge"
  [ "$FAILED" = 0 ] || die "check failed"
  printf 'malachi: check passed\n'
}

cmd_check_http() {
  [ -n "${1:-}" ] || die "usage: malachi.sh check-http <base url>"
  check_http "$1"
  [ "$FAILED" = 0 ] || die "check failed"
}

cmd_check_public() {
  local edge
  edge=$(edge_setting)
  load_env
  check_public "$edge"
  [ "$FAILED" = 0 ] || die "check failed"
}

# ── backups ──────────────────────────────────────────────────────────────────

# The newest finished backup, or BACKUP= by name. An unfinished one ends in .partial.
backup_dir() {
  local name=${BACKUP:-} newest='' dir
  if [ -n "$name" ]; then
    case $name in
      */* | .* | *.partial) die "BACKUP must be a folder name under $DATA/backups, got '$name'" ;;
    esac
    [ -f "$DATA/backups/$name/manifest.txt" ] || die "no finished backup at $DATA/backups/$name"
    printf '%s' "$DATA/backups/$name"
    return
  fi
  for dir in "$DATA"/backups/*/; do
    [ -f "$dir/manifest.txt" ] && newest=${dir%/}
  done
  [ -n "$newest" ] || die "no finished backup under $DATA/backups"
  printf '%s' "$newest"
}

prune_backups() { # keep
  local dirs=() dir count=0
  for dir in "$DATA"/backups/*/; do
    [ -f "$dir/manifest.txt" ] && dirs+=("${dir%/}")
  done
  local extra=$((${#dirs[@]} - $1))
  for dir in ${dirs[@]+"${dirs[@]}"}; do
    [ "$count" -lt "$extra" ] || break
    rm -rf "$dir"
    printf 'malachi: pruned %s\n' "$dir"
    count=$((count + 1))
  done
}

cmd_backup() {
  local keep floor stamp final partial ledger
  keep=$(whole_number KEEP "${KEEP:-14}")
  [ "$keep" -ge 1 ] || die "KEEP must be at least 1"
  floor=$(whole_number MIN_FREE_GB "${MIN_FREE_GB:-20}")
  load_env
  check_disk "$DATA" "$floor" "DATA_DIR"
  [ "$FAILED" = 0 ] || die "refusing to back up under the floor"

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  final=$DATA/backups/$stamp
  partial=$final.partial
  (umask 077 && mkdir -p "$partial/objects")
  trap 'rm -rf "$partial"' EXIT

  # The dump first, so no row points past the objects mirrored after it.
  compose exec -T postgres pg_dump -U postgres -d genealogy -Fc >"$partial/postgres.dump"
  compose run --rm --no-deps -T --user "$(id -u):$(id -g)" -e MC_CONFIG_DIR=/tmp/mc \
    -v "$partial:/backup" --entrypoint mc minio-init mirror --quiet beta/projects /backup/objects
  ledger=$(psql_exec genealogy "SELECT count(*) FROM schema_migrations")
  printf 'git_sha=%s\nledger_rows=%s\n' "$GIT_SHA" "$ledger" >"$partial/manifest.txt"
  mv "$partial" "$final"
  trap - EXIT
  prune_backups "$keep"
  printf 'malachi: backup at %s\n' "$final"
}

check_blobs() { # database objects_dir
  local key bytes file got rows=0 missing=0
  while IFS=$'\t' read -r key bytes; do
    rows=$((rows + 1))
    file=$2/$key
    if [ ! -f "$file" ]; then
      printf '  FAIL  object missing from the mirror: %s\n' "$key"
      missing=$((missing + 1))
      continue
    fi
    got=$(wc -c <"$file" | tr -d ' ')
    if [ "$got" != "$bytes" ]; then
      printf '  FAIL  object is %s bytes, the row says %s: %s\n' "$got" "$bytes" "$key"
      missing=$((missing + 1))
    fi
  done < <(compose exec -T postgres psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -At -F $'\t' -c "SELECT s3_key, bytes FROM blobs")
  [ "$missing" = 0 ] || FAILED=1
  printf '  %s blob rows checked, %s bad\n' "$rows" "$missing"
}

drop_scratch() {
  psql_exec postgres "DROP DATABASE IF EXISTS \"$SCRATCH_DB\" WITH (FORCE)" >/dev/null
}

cmd_restore_check() {
  load_env
  local dir want got
  dir=$(backup_dir)
  printf 'checking %s\n' "$dir"
  SCRATCH_DB=restore_check_$$
  trap drop_scratch EXIT
  psql_exec postgres "CREATE DATABASE \"$SCRATCH_DB\"" >/dev/null
  compose exec -T postgres pg_restore -U postgres -d "$SCRATCH_DB" --no-owner --no-acl --exit-on-error \
    <"$dir/postgres.dump" || die "the dump does not restore: $dir/postgres.dump"
  want=$(env_get ledger_rows "$dir/manifest.txt")
  got=$(psql_exec "$SCRATCH_DB" "SELECT count(*) FROM schema_migrations")
  if [ "$got" = "$want" ]; then
    ok "ledger: $got rows, as recorded"
  else
    bad "ledger: $got rows restored, the backup recorded $want"
  fi
  check_blobs "$SCRATCH_DB" "$dir/objects"
  [ "$FAILED" = 0 ] || die "restore check failed"
  printf 'malachi: restore check passed\n'
}

cmd_restore() {
  [ "${CONFIRM:-}" = yes ] || die "this loads a backup into the stack: pass CONFIRM=yes"
  load_env
  local dir tables
  dir=$(backup_dir)
  prepare_data_dir
  compose up -d --wait postgres minio
  tables=$(psql_exec genealogy "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
  [ "$tables" = 0 ] || die "the database holds $tables tables. A restore goes into an empty stack: make malachi-wipe CONFIRM=yes first."
  compose run --rm --no-deps -T minio-init
  compose exec -T postgres pg_restore -U postgres -d genealogy --no-owner --no-acl --exit-on-error \
    <"$dir/postgres.dump"
  compose run --rm --no-deps -T -e MC_CONFIG_DIR=/tmp/mc -v "$dir:/backup:ro" --entrypoint mc minio-init \
    mirror --quiet --overwrite /backup/objects beta/projects
  printf 'malachi: restored %s. make malachi-up re-grants the role and starts the rest.\n' "$dir"
}

# ── export ───────────────────────────────────────────────────────────────────

cmd_export() {
  local selector
  if [ -n "${EMAIL:-}" ] && [ -z "${PROJECT:-}" ]; then
    selector=(--email "$EMAIL")
  elif [ -n "${PROJECT:-}" ] && [ -z "${EMAIL:-}" ]; then
    selector=(--project "$PROJECT")
  else
    die "name exactly one of EMAIL= and PROJECT="
  fi
  load_env
  (umask 077 && mkdir -p "$DATA/exports")
  compose run --rm --no-deps -T --user "$(id -u):$(id -g)" -e PYTHONPATH=/app \
    -v "$HERE/project_export.py:/opt/malachi/project_export.py:ro" -v "$DATA/exports:/out" \
    web python /opt/malachi/project_export.py "${selector[@]}" --out /out
  printf 'malachi: exported under %s/exports\n' "$DATA"
}

case "${1:-}" in
  env-init) cmd_env_init ;;
  up) cmd_up ;;
  check) cmd_check ;;
  check-http) cmd_check_http "${2:-}" ;;
  check-public) cmd_check_public ;;
  logs) cmd_logs ;;
  backup) cmd_backup ;;
  restore-check) cmd_restore_check ;;
  restore) cmd_restore ;;
  export) cmd_export ;;
  down) cmd_down ;;
  wipe) cmd_wipe ;;
  *) die "usage: malachi.sh env-init|up|check|check-http <url>|check-public|logs|backup|restore-check|restore|export|down|wipe" ;;
esac
