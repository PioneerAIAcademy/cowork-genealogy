#!/usr/bin/env bash
#
# `make malachi-rehearsal`: every malachi-* target against a real stack, on a developer's Mac,
# from a temporary plain clone of this branch. Its own compose project, its own loopback port
# and a temporary DATA_DIR, so it touches nothing else: no request leaves this machine, and
# the FamilySearch token it seeds is a fake. It tears everything down, and exits 0 only if
# every step passed. KEEP_REHEARSAL=1 leaves the stack and the folder up after a failure.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC=$(git -C "$HERE" rev-parse --show-toplevel)
SHA=$(git -C "$SRC" rev-parse HEAD)
STACK=genealogy-beta-rehearsal
PORT=${REHEARSAL_PORT:-18006}
BASE=http://127.0.0.1:$PORT
SEED_EMAIL=rehearsal@example.test
FIXTURE=eval/fixtures/scenarios/empty-project-just-created

WORK=''
OTHER_IMAGE=''
PASSED=0
STEP='start'

say() {
  STEP=$*
  printf '\n== %s\n' "$*"
}
pass() {
  printf '  PASS  %s\n' "$*"
  PASSED=$((PASSED + 1))
}
fail() {
  printf '  FAIL  %s\n' "$*"
  exit 1
}
note() { printf '  note  %s\n' "$*"; }

host_make() { make -C "$WORK/host" --no-print-directory MALACHI_ENV="$ENV_FILE" MALACHI_PROJECT="$STACK" "$@"; }

# A target that must succeed, and one that must refuse with the given text.
must_pass() { # label target...
  local label=$1
  shift
  host_make "$@" >"$WORK/last.log" 2>&1 || {
    tail -n 30 "$WORK/last.log"
    fail "$label"
  }
  pass "$label"
}
must_refuse() { # label text target...
  local label=$1 text=$2
  shift 2
  if host_make "$@" >"$WORK/last.log" 2>&1; then
    tail -n 30 "$WORK/last.log"
    fail "$label: exit 0, want a refusal"
  fi
  grep -q -- "$text" "$WORK/last.log" || {
    tail -n 30 "$WORK/last.log"
    fail "$label: no line naming '$text'"
  }
  pass "$label"
}

rcompose() { docker compose -p "$STACK" --env-file "$ENV_FILE" -f "$WORK/host/apps/server/proto/malachi/compose.yml" "$@"; }

code_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$@" || true; }

download() { # output file; prints the status
  curl -s -o "$1" -w '%{http_code}' --max-time 120 -H "Cookie: wb_session=$COOKIE" "$BASE/api/projects/$PROJECT/download" || true
}

mcp() { # json body; prints the response
  curl -s --max-time 60 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' -d "$1" "$BASE/mcp"
}

started_at() { docker inspect -f '{{.State.StartedAt}}' "$(rcompose ps -q "$1")"; }

container_id() { rcompose ps -q "$1"; }

proto_state() {
  docker ps -a --filter label=com.docker.compose.project=proto --format '{{.ID}} {{.Names}} {{.CreatedAt}}' | sort
}

teardown() {
  local status=$?
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    if [ "$status" != 0 ] && [ -n "${KEEP_REHEARSAL:-}" ]; then
      printf '\nleft up for inspection: %s (project %s)\n' "$WORK" "$STACK"
      exit "$status"
    fi
    rcompose down --remove-orphans --rmi local >/dev/null 2>&1 || true
    [ -z "$OTHER_IMAGE" ] || docker rmi "$OTHER_IMAGE" >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
  if [ "$status" = 0 ]; then
    printf '\nmalachi rehearsal passed: %s checks\n' "$PASSED"
  else
    printf '\nmalachi rehearsal FAILED at: %s\n' "$STEP"
  fi
}

[ -z "$(git -C "$SRC" status --porcelain)" ] || {
  printf 'rehearsal: commit first; it clones HEAD, and a dirty tree proves nothing\n' >&2
  exit 1
}
[ "$(code_of --max-time 2 "$BASE/livez")" = 000 ] || {
  printf 'rehearsal: something already answers on %s\n' "$BASE" >&2
  exit 1
}

trap teardown EXIT
WORK=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/malachi-rehearsal.XXXXXX")" && pwd -P)
ENV_FILE=$WORK/env
DATA=$WORK/data
MALACHI_DIR=apps/server/proto/malachi
export MIN_FREE_GB=1 MIN_DOCKER_FREE_GB=1

say "1. plain clone of $SHA"
git clone -q --bare "$SRC" "$WORK/origin.git"
git clone -q "$WORK/origin.git" "$WORK/host"
git -C "$WORK/host" checkout -q --detach "$SHA"
git clone -q "$WORK/origin.git" "$WORK/dev"
git -C "$WORK/dev" checkout -q --detach "$SHA"
PROTO_BEFORE=$(proto_state)
pass "cloned; recorded $(printf '%s\n' "$PROTO_BEFORE" | grep -c . || true) proto containers"

say "2. first bring-up with the edge off"
PUBLIC_URL=$BASE DATA_DIR=$DATA ALLOWED_EMAILS=$SEED_EMAIL MALACHI_ENV=$ENV_FILE "$WORK/host/$MALACHI_DIR/malachi.sh" env-init
{
  printf 'EDGE_PORT=%s\n' "$PORT"
  printf 'WIKI_API_URL=http://edge:8006\nPOP_STATS_URL=http://edge:8006\n'
} >>"$ENV_FILE"
ENV_SUM=$(shasum "$ENV_FILE")
must_pass "malachi-up EDGE=off" malachi-up EDGE=off
[ "$(code_of --max-time 3 "$BASE/livez")" = 000 ] || fail "port $PORT answers with EDGE=off"
pass "port $PORT refuses with EDGE=off"
must_pass "malachi-check EDGE=off" malachi-check EDGE=off
must_refuse "malachi-check with the edge stopped and no EDGE=off" "edge is not running" malachi-check
must_refuse "EDGE=typo is refused" "EDGE must be on or off" malachi-up EDGE=of

say "3. the edge last"
must_pass "malachi-up" malachi-up
must_pass "malachi-check" malachi-check

say "4. what the tiers came up as"
[ "$(code_of "$BASE/")" = 404 ] || fail "/ does not answer 404"
[ "$(code_of "$BASE/index.html")" = 404 ] || fail "/index.html does not answer 404"
pass "web serves no SPA: / and /index.html answer 404"
rcompose exec -T web python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8085/api/health').read().decode())" >"$WORK/health.json"
grep -q '"queue":null' "$WORK/health.json" || fail "the queue is not null: $(cat "$WORK/health.json")"
grep -q '"ok":true' "$WORK/health.json" || fail "/api/health is not ok: $(cat "$WORK/health.json")"
pass "chat off, no queue: $(cat "$WORK/health.json")"
for service in web tools; do
  if docker inspect -f '{{json .Config.Env}}' "$(container_id "$service")" | grep -q 'QUEUE_URL\|DEV_LOGIN'; then
    fail "$service carries QUEUE_URL or DEV_LOGIN"
  fi
done
pass "neither tier carries QUEUE_URL or DEV_LOGIN"
host_make malachi-logs SERVICE=tools TAIL=500 >"$WORK/tools.log" 2>&1
grep -q 'collections cache: shared' "$WORK/tools.log" || fail "the tool server does not share the collections cache"
pass "the tool server shares the collections cache"
want=$(find "$WORK/host/apps/server/proto/sql" -name '*.sql' | wc -l | tr -d ' ')
got=$(rcompose exec -T postgres psql -U postgres -d genealogy -Atc 'SELECT count(*) FROM schema_migrations')
[ "$got" = "$want" ] || fail "ledger holds $got rows, the repo ships $want files"
pass "migrations applied: $got of $want"

say "5. the DML role"
DML_PW=$(sed -n 's/^DML_PASSWORD=//p' "$ENV_FILE")
as_dml() { rcompose exec -T -e PGPASSWORD="$DML_PW" postgres psql -h 127.0.0.1 -U genealogy_dml -d genealogy -v ON_ERROR_STOP=1 -Atc "$1" 2>&1; }
for statement in 'CREATE TABLE intruder (i int)' 'DROP TABLE documents' "UPDATE schema_migrations SET sha256 = 'x'"; do
  if out=$(as_dml "$statement"); then
    fail "the role ran: $statement"
  fi
  printf '%s' "$out" | grep -q 'permission denied\|must be owner' || fail "$statement: $out"
done
pass "the role cannot run DDL or touch the ledger"
[ "$(as_dml 'SELECT count(*) > 0 FROM schema_migrations')" = t ] || fail "the role cannot read the ledger"
pass "the role reads the ledger"

say "6. only the edge publishes"
docker ps --filter label=com.docker.compose.project="$STACK" --format '{{.Names}} {{.Ports}}' | tee "$WORK/ps.txt"
published=$(grep -c -- '->' "$WORK/ps.txt" || true)
[ "$published" = 1 ] || fail "$published containers publish"
grep -q "edge.*127\.0\.0\.1:$PORT->8006/tcp" "$WORK/ps.txt" || fail "the edge does not publish 127.0.0.1:$PORT"
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | tee "$WORK/lsof.txt"
grep -q "127\.0\.0\.1:$PORT" "$WORK/lsof.txt" || fail "lsof does not show loopback $PORT"
if grep -q "\*:$PORT" "$WORK/lsof.txt"; then fail "lsof shows $PORT on every interface"; fi
pass "one publish, 127.0.0.1:$PORT"

say "7. seed a user, a project and a connector token as the DML role"
cat >"$WORK/seed.py" <<'PY'
import base64
import hashlib
import json
import os
import secrets

import psycopg
from psycopg.types.json import Jsonb

from web import auth

user = "rehearsal-user"
project = "proj_" + secrets.token_hex(8)
token = "rehearsal-" + secrets.token_hex(32)
with psycopg.connect(os.environ["PG_DSN"]) as conn:
    conn.execute("INSERT INTO users (id, email) VALUES (%s, %s)", (user, os.environ["SEED_EMAIL"]))
    conn.execute("INSERT INTO familysearch_tokens (user_id, access_token_enc, expires_at, granted_at) "
                 "VALUES (%s, %s, now() + interval '1 day', now())", (user, auth.encrypt("fake-familysearch-token")))
    conn.execute("INSERT INTO connector_tokens (token_sha256, user_id, client_id, scopes, expires_at) "
                 "VALUES (%s, %s, 'rehearsal', '{}', now() + interval '1 day')",
                 (hashlib.sha256(token.encode("utf-8")).hexdigest(), user))
    conn.execute("INSERT INTO projects (project_id, owner_id) VALUES (%s, %s)", (project, user))
    for name, var in (("research.json", "SEED_RESEARCH"), ("tree.gedcomx.json", "SEED_TREE")):
        doc = json.loads(base64.b64decode(os.environ[var]))
        conn.execute("INSERT INTO documents (project_id, name, doc) VALUES (%s, %s, %s)", (project, name, Jsonb(doc)))
print(f"PROJECT={project}")
print(f"TOKEN={token}")
print(f"COOKIE={auth.session_cookie_value(user)}")
PY
rcompose exec -T -e SEED_EMAIL="$SEED_EMAIL" \
  -e SEED_RESEARCH="$(base64 <"$WORK/host/$FIXTURE/research.json" | tr -d '\n')" \
  -e SEED_TREE="$(base64 <"$WORK/host/$FIXTURE/tree.gedcomx.json" | tr -d '\n')" \
  web python - <"$WORK/seed.py" >"$WORK/seed.out"
PROJECT=$(sed -n 's/^PROJECT=//p' "$WORK/seed.out")
TOKEN=$(sed -n 's/^TOKEN=//p' "$WORK/seed.out")
COOKIE=$(sed -n 's/^COOKIE=//p' "$WORK/seed.out")
[ -n "$PROJECT" ] && [ -n "$TOKEN" ] && [ -n "$COOKIE" ] || fail "the seed printed nothing"
pass "seeded $PROJECT"

say "8. the connector door through the edge"
mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' >"$WORK/list.json"
grep -q '"research_append"' "$WORK/list.json" || fail "tools/list: $(head -c 300 "$WORK/list.json")"
pass "tools/list answers through the edge"
append() { # marker
  mcp "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"research_append\",\"arguments\":{\"projectPath\":\"/$PROJECT\",\"section\":\"project\",\"op\":\"update\",\"fields\":{\"status\":\"$1\"}}}}"
}
doc_version() { rcompose exec -T postgres psql -U postgres -d genealogy -Atc "SELECT version FROM documents WHERE project_id = '$PROJECT' AND name = 'research.json'"; }
append completed >"$WORK/append.json"
if grep -q '"isError":true' "$WORK/append.json"; then fail "research_append: $(head -c 400 "$WORK/append.json")"; fi
[ "$(doc_version)" = 2 ] || fail "research_append did not write: $(head -c 400 "$WORK/append.json")"
pass "research_append wrote through the DML role, document now version 2"
rcompose exec -T web python -c "import urllib.request; print(urllib.request.urlopen('http://tools:8787/healthz').read().decode())" >"$WORK/tools.json"
grep -q '"ok":true' "$WORK/tools.json" || fail "tools /healthz: $(cat "$WORK/tools.json")"
pass "tools /healthz is ok under the DML role"

say "9. OpenRouter: linking off, one key seeded by hand"
[ "$(code_of "$BASE/openrouter/link")" = 404 ] || fail "/openrouter/link does not answer 404"
pass "the linking routes answer 404"
stored_key() { rcompose exec -T postgres psql -U postgres -d genealogy -Atc "SELECT openrouter_key_enc FROM users WHERE email = '$SEED_EMAIL'"; }
[ -z "$(stored_key)" ] || fail "a key is on the row before any seed"
must_refuse "malachi-openrouter with no EMAIL" "EMAIL= is required" malachi-openrouter
must_refuse "malachi-openrouter with a blank key" "OPENROUTER_SEED_KEY is blank" malachi-openrouter "EMAIL=$SEED_EMAIL"
SEED_KEY=rehearsal-openrouter-key
sed -i '' "s/^OPENROUTER_SEED_KEY=.*/OPENROUTER_SEED_KEY=$SEED_KEY/" "$ENV_FILE"
must_refuse "malachi-openrouter for nobody" "no user nobody@example.test" malachi-openrouter EMAIL=nobody@example.test
must_pass "malachi-openrouter" malachi-openrouter "EMAIL=$SEED_EMAIL"
if grep -q "$SEED_KEY" "$WORK/last.log"; then fail "the key reached the target's output"; fi
STORED=$(stored_key)
case $STORED in
  gAAAAA*) ;;
  *) fail "the row does not hold ciphertext" ;;
esac
got=$(rcompose exec -T -e STORED="$STORED" web python -c "import os; from web import auth; print(auth.decrypt(os.environ['STORED']))")
[ "$got" = "$SEED_KEY" ] || fail "the stored key does not decrypt to the seeded one"
pass "the key is ciphertext on the row, and decrypts under the stack's key"
for service in web tools; do
  if docker inspect -f '{{json .Config.Env}}' "$(container_id "$service")" | grep -q "$SEED_KEY\|OPENROUTER_SEED_KEY"; then
    fail "$service carries the seed key"
  fi
done
pass "neither tier carries the seed key"

say "10. uploads off, then on through the env file"
{
  printf '\211PNG\r\n\032\n'
  head -c 20000000 /dev/urandom
} >"$WORK/rehearsal.png"
got=$(code_of -H "Cookie: wb_session=$COOKIE" -F "file=@$WORK/rehearsal.png" "$BASE/api/projects/$PROJECT/files")
[ "$got" = 404 ] || fail "an upload with the template's setting answered $got, want 404"
curl -s --max-time 10 "$BASE/auth/config" | grep -q '"uploads":false' || fail "/auth/config does not say uploads are off"
pass "the template's setting leaves uploads off"
sed -i '' 's/^UPLOADS_ENABLED=.*/UPLOADS_ENABLED=true/' "$ENV_FILE"
ENV_SUM=$(shasum "$ENV_FILE")
must_pass "malachi-up" malachi-up
curl -s --max-time 10 "$BASE/auth/config" | grep -q '"uploads":true' || fail "/auth/config does not say uploads are on"
pass "the env file turns uploads on"

say "11. uploads through the edge"
got=$(code_of -H "Cookie: wb_session=$COOKIE" -F "file=@$WORK/rehearsal.png" "$BASE/api/projects/$PROJECT/files")
[ "$got" = 200 ] || fail "a 20 MB upload answered $got"
pass "a 20 MB upload through a read-only edge answered 200"
head -c 28311552 /dev/urandom >"$WORK/too-big.png"
got=$(curl -s -o "$WORK/413.txt" -w '%{http_code}' --max-time 60 -H "Cookie: wb_session=$COOKIE" \
  -H 'Transfer-Encoding: chunked' -F "file=@$WORK/too-big.png" "$BASE/api/projects/$PROJECT/files" || true)
[ "$got" = 413 ] || fail "a chunked 27 MiB upload answered $got"
if grep -q '"detail"' "$WORK/413.txt"; then fail "the 413 came from the web tier, not the edge"; fi
grep -qi 'too large' "$WORK/413.txt" || fail "the 413 body is not nginx's: $(head -c 200 "$WORK/413.txt")"
pass "a chunked 27 MiB upload stopped at the edge with nginx's 413"
got=$(curl -s -o "$WORK/413b.txt" -w '%{http_code}' --max-time 60 -F "file=@$WORK/too-big.png" "$BASE/api/projects/$PROJECT/files" || true)
[ "$got" = 413 ] || fail "a declared 27 MiB body with no session answered $got"
grep -qi 'too large' "$WORK/413b.txt" || fail "that 413 is not nginx's: $(head -c 200 "$WORK/413b.txt")"
pass "a declared 27 MiB body with no session stopped at the edge"
got=$(code_of -H 'Transfer-Encoding: chunked' -F "file=@$WORK/rehearsal.png" "$BASE/api/projects/$PROJECT/files")
[ "$got" = 401 ] || fail "a chunked upload with no session answered $got, want 401"
pass "a chunked upload with no session is refused by the web tier, since bodies stream"

say "12. no sign-in code reaches a log"
got=$(code_of "$BASE/callback?code=SECRETCODE&state=SECRETSTATE")
[ "$got" = 400 ] || fail "/callback answered $got, want 400"
sleep 1
host_make malachi-logs SERVICE=edge TAIL=500 >"$WORK/edge.log" 2>&1
host_make malachi-logs SERVICE=web TAIL=500 >"$WORK/web.log" 2>&1
grep -q '"path":"/callback","status":400' "$WORK/edge.log" || fail "the edge log has no /callback line, so the read proves nothing"
if grep -q 'SECRET' "$WORK/edge.log" "$WORK/web.log"; then fail "a secret reached a log"; fi
pass "edge log shows /callback 400, and neither log holds the code or state"

say "13. export by email and by project"
must_refuse "malachi-export with no selector" "exactly one" malachi-export
must_pass "malachi-export EMAIL=" malachi-export "EMAIL=$SEED_EMAIL"
[ -f "$DATA/exports/$PROJECT/research.json" ] || fail "no research.json in the export"
[ -f "$DATA/exports/$PROJECT/uploads/rehearsal.png" ] || fail "no upload in the export"
rm -rf "${DATA:?}/exports/$PROJECT"
must_pass "malachi-export PROJECT=" malachi-export "PROJECT=$PROJECT"
got=$(wc -c <"$DATA/exports/$PROJECT/uploads/rehearsal.png" | tr -d ' ')
want=$(wc -c <"$WORK/rehearsal.png" | tr -d ' ')
[ "$got" = "$want" ] || fail "the exported upload is $got bytes, want $want"
pass "the export holds the upload at its full size"

say "14. backup and restore check"
must_refuse "KEEP=x is refused" "must be a whole number" malachi-backup KEEP=x
must_pass "malachi-backup" malachi-backup
must_pass "malachi-restore-check" malachi-restore-check
GOOD=$(basename "$(find "$DATA/backups" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)")
[ "$(rcompose exec -T postgres psql -U postgres -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'restore_check_%'")" = 0 ] || fail "a scratch database was left behind"
pass "the scratch database is gone"

cp -R "$DATA/backups/$GOOD" "$DATA/backups/planted-missing"
victim=$(find "$DATA/backups/planted-missing/objects" -type f | head -n 1)
[ -n "$victim" ] || fail "the mirror is empty"
rm "$victim"
must_refuse "restore check with a mirror object deleted" "object missing from the mirror: ${victim#"$DATA/backups/planted-missing/objects/"}" malachi-restore-check BACKUP=planted-missing
rm -rf "$DATA/backups/planted-missing"

cp -R "$DATA/backups/$GOOD" "$DATA/backups/planted-short"
dump=$DATA/backups/planted-short/postgres.dump
head -c "$(($(wc -c <"$dump") / 2))" "$dump" >"$dump.short"
mv "$dump.short" "$dump"
must_refuse "restore check with a truncated dump" "does not restore" malachi-restore-check BACKUP=planted-short
rm -rf "$DATA/backups/planted-short"
[ "$(rcompose exec -T postgres psql -U postgres -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'restore_check_%'")" = 0 ] || fail "a failed check left its scratch database"
pass "failed checks left no scratch database"

sleep 1
must_pass "a second backup" malachi-backup
sleep 1
must_refuse "KEEP=2 with no CONFIRM" "pass CONFIRM=yes" malachi-backup KEEP=2
must_pass "a third backup with KEEP=2" malachi-backup KEEP=2 CONFIRM=yes
got=$(find "$DATA/backups" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
[ "$got" = 2 ] || fail "KEEP=2 left $got backups"
GOOD=$(basename "$(find "$DATA/backups" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)")
pass "KEEP=2 left 2 backups"

say "15. deploy a commit that leaves nginx.conf alone"
EDGE_START=$(started_at edge)
WEB_ID=$(container_id web)
TOOLS_ID=$(container_id tools)
PROJECT_ROWS=$(rcompose exec -T postgres psql -U postgres -d genealogy -Atc "SELECT count(*) FROM documents")
git -C "$WORK/dev" -c user.name=rehearsal -c user.email=rehearsal@example.test commit -q --allow-empty -m "rehearsal: a new commit"
git -C "$WORK/dev" push -q origin HEAD:refs/heads/rehearsal-deploy
REF=$(git -C "$WORK/dev" rev-parse HEAD)
must_pass "malachi-deploy REF=" malachi-deploy "REF=$REF"
[ "$(container_id web)" != "$WEB_ID" ] || fail "web was not recreated"
[ "$(container_id tools)" != "$TOOLS_ID" ] || fail "tools was not recreated"
pass "web and tools recreated"
[ "$(started_at edge)" = "$EDGE_START" ] || fail "the edge restarted"
pass "the edge did not restart"
[ "$(docker inspect -f '{{index .Config.Labels "genealogy.git-sha"}}' "$(container_id web)")" = "$REF" ] || fail "web's sha label is not the new commit"
[ "$(shasum "$ENV_FILE")" = "$ENV_SUM" ] || fail "the env file changed"
[ "$(rcompose exec -T postgres psql -U postgres -d genealogy -Atc "SELECT count(*) FROM documents")" = "$PROJECT_ROWS" ] || fail "documents changed"
[ "$(doc_version)" = 2 ] || fail "the document changed"
mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -q '"research_append"' || fail "the connector token stopped working"
pass "secrets, documents and the connector token survived the redeploy"
must_refuse "malachi-deploy with no REF" "REF=<sha> is required" malachi-deploy
must_refuse "malachi-deploy with a branch name" "REF must be a sha" malachi-deploy REF=main
printf 'dirt\n' >"$WORK/host/dirt.txt"
must_refuse "malachi-deploy on a dirty tree" "the tree is not clean" malachi-deploy "REF=$REF"
rm "$WORK/host/dirt.txt"

say "16. deploy a commit that changes nginx.conf and web's image"
EDGE_ID=$(container_id edge)
WEB_IMAGE=$(docker inspect -f '{{.Image}}' "$(container_id web)")
mkdir "$WORK/other"
printf 'rehearsal\n' >"$WORK/other/marker"
printf 'FROM scratch\nCOPY marker /marker\n' >"$WORK/other/Dockerfile"
OTHER_IMAGE=$(docker build -q --label com.docker.compose.project="$STACK-other" "$WORK/other")
sed -i '' 's/^        listen 8006;$/        listen 8006; add_header X-Rehearsal deployed always;/' "$WORK/dev/$MALACHI_DIR/nginx.conf"
grep -q 'X-Rehearsal' "$WORK/dev/$MALACHI_DIR/nginx.conf" || fail "the planted line did not land"
printf '\n# rehearsal\n' >>"$WORK/dev/apps/server/proto/web/auth.py"
git -C "$WORK/dev" -c user.name=rehearsal -c user.email=rehearsal@example.test commit -q -am "rehearsal: change the edge"
git -C "$WORK/dev" push -q origin HEAD:refs/heads/rehearsal-deploy
REF=$(git -C "$WORK/dev" rev-parse HEAD)
must_pass "malachi-deploy REF=" malachi-deploy "REF=$REF"
[ "$(container_id edge)" != "$EDGE_ID" ] || fail "the edge was not recreated"
curl -s -D - -o /dev/null --max-time 10 "$BASE/livez" | grep -qi 'x-rehearsal: deployed' || fail "the edge does not serve the new file"
pass "the edge recreated and serves the new file"
[ "$(docker inspect -f '{{.Image}}' "$(container_id web)")" != "$WEB_IMAGE" ] || fail "web's image was not rebuilt"
if docker image inspect "$WEB_IMAGE" >/dev/null 2>&1; then fail "the superseded web image is still here"; fi
pass "the deploy removed the superseded web image"
docker image inspect "$OTHER_IMAGE" >/dev/null 2>&1 || fail "the deploy removed another project's image"
docker rmi "$OTHER_IMAGE" >/dev/null
OTHER_IMAGE=''
pass "another project's untagged image survived the deploy"

say "17. down and up keep the data"
must_pass "malachi-down" malachi-down
[ -z "$(docker ps -q --filter label=com.docker.compose.project="$STACK")" ] || fail "containers survive malachi-down"
must_pass "malachi-up" malachi-up
must_pass "malachi-check" malachi-check
[ "$(doc_version)" = 2 ] || fail "the document is gone"
got=$(download "$WORK/down.zip")
[ "$got" = 200 ] || fail "the download answered $got"
unzip -l "$WORK/down.zip" | grep -q 'uploads/rehearsal.png' || fail "the upload left the project"
pass "the document and the upload are still there"
must_refuse "malachi-restore over live data" "A restore goes into an empty stack" malachi-restore CONFIRM=yes "BACKUP=$GOOD"
must_refuse "malachi-restore without CONFIRM" "pass CONFIRM=yes" malachi-restore "BACKUP=$GOOD"

say "18. wipe, restore, and read it back"
must_refuse "malachi-wipe without CONFIRM" "pass CONFIRM=yes" malachi-wipe
[ -d "$DATA/postgres" ] || fail "the refused wipe removed data"
must_pass "malachi-wipe CONFIRM=yes" malachi-wipe CONFIRM=yes
[ ! -e "$DATA/postgres" ] && [ ! -e "$DATA/minio" ] || fail "the data survived the wipe"
[ -d "$DATA/backups/$GOOD" ] || fail "the wipe took the backups"
[ "$(shasum "$ENV_FILE")" = "$ENV_SUM" ] || fail "the wipe changed the env file"
pass "postgres/ and minio/ are gone; backups and the env file stayed"
must_pass "malachi-restore" malachi-restore CONFIRM=yes "BACKUP=$GOOD"
must_pass "malachi-up" malachi-up
must_pass "malachi-check" malachi-check
[ "$(doc_version)" = 2 ] || fail "the restored document is not version 2"
pass "the document came back"
mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -q '"research_append"' || fail "the connector token did not come back"
pass "the connector token decrypts its grant after the restore"
append paused >"$WORK/append2.json"
[ "$(doc_version)" = 3 ] || fail "no write after the restore: $(head -c 400 "$WORK/append2.json")"
pass "the role writes after the restore"
got=$(download "$WORK/restored.zip")
[ "$got" = 200 ] || fail "the download after the restore answered $got"
mkdir "$WORK/restored"
(cd "$WORK/restored" && unzip -q "$WORK/restored.zip")
cmp -s "$WORK/restored/uploads/rehearsal.png" "$WORK/rehearsal.png" || fail "the restored upload differs from the original"
[ ! -e "$WORK/restored/MISSING.txt" ] || fail "the restored download names missing files: $(cat "$WORK/restored/MISSING.txt")"
pass "the restored upload matches the original byte for byte"

say "19. the reach probe reports a real status"
must_refuse "REACH=1 against a path nothing serves" "wiki from inside tools: 404" malachi-check REACH=1

say "20. proto"
PROTO_AFTER=$(proto_state)
if [ "$PROTO_AFTER" = "$PROTO_BEFORE" ]; then
  pass "proto containers unchanged"
else
  note "proto containers differ from the start; another job shares them"
  printf '%s\n' "$PROTO_BEFORE" >"$WORK/proto.before"
  printf '%s\n' "$PROTO_AFTER" >"$WORK/proto.after"
  diff "$WORK/proto.before" "$WORK/proto.after" || true
fi
