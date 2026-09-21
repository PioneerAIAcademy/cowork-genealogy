# Sourced by the proto make recipes before `compose up`, from the repo root:
#
#   . apps/server/proto/env.sh
#
# Three secrets, none ever echoed:
#
#   ANTHROPIC_API_KEY  exported: the caller's, else the line in $PROTO_ENV_FILE (default
#                      eval/.env; the test points it at a temp file). The worker
#                      reads it from the environment of the `up` that creates it.
#   OPENROUTER_API_KEY exported the same way (image_transcribe's OCR provider). The
#                      `tools` service reads it from its own environment on the http
#                      default, and the TOOL_SERVER=stdio fork from the worker's.
#                      Absent, every image read answers with the no-key error.
#   the FS token       written to $PROTO_TOKEN_FILE (default apps/server/proto/.fs-token,
#                      always mode 600), which compose mounts at /run/fs-token and the
#                      worker reads PER TURN -- so `make proto-token` (this file again)
#                      refreshes it under a running worker. FamilySearch access tokens
#                      live an hour. The value is the caller's FS_ACCESS_TOKEN, else the
#                      desktop login's token refreshed through the engine's own path
#                      (dev/fs-token.ts, which FORCES a refresh when under 35 minutes of
#                      life are left -- PROTO_TOKEN_MIN_LIFE minutes, default 30, plus the
#                      auth module's own 5-minute expiry buffer. getValidToken alone
#                      returns a token that has not yet expired, so a refresh at minute 52
#                      handed back the same eight minutes; 30 is the step ceiling
#                      READ_TIMEOUT_S in minutes, so the token outlives a full-length
#                      turn). Start a session with `make e2e-login` -- the refresh
#                      token it mints lives ~24 h, and nothing here can renew a dead one.
#                      A failed refresh leaves the file as it was, and says why: a
#                      still-good token survives a blip, and a dead one is no worse dead.
#                      Written in place: the bind mount follows the inode, so a rename
#                      would leave the container on the old file.
#
# One status line on stderr says what is set.
PROTO_ENV_FILE="${PROTO_ENV_FILE:-eval/.env}"
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  ANTHROPIC_API_KEY="$(sed -n 's/^ANTHROPIC_API_KEY=//p' "$PROTO_ENV_FILE" 2>/dev/null | head -1)"
fi
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  OPENROUTER_API_KEY="$(sed -n 's/^OPENROUTER_API_KEY=//p' "$PROTO_ENV_FILE" 2>/dev/null | head -1)"
fi
export ANTHROPIC_API_KEY OPENROUTER_API_KEY

PROTO_TOKEN_FILE="${PROTO_TOKEN_FILE:-apps/server/proto/.fs-token}"
# A compose `up` before the file existed leaves an empty directory in its place, and
# proto-up-core creates it empty under the default umask -- so the mode is set every time,
# before anything is written.
if [ -d "$PROTO_TOKEN_FILE" ]; then rmdir "$PROTO_TOKEN_FILE"; fi
if [ ! -f "$PROTO_TOKEN_FILE" ]; then : > "$PROTO_TOKEN_FILE"; fi
chmod 600 "$PROTO_TOKEN_FILE"
# fs-token.ts reports every failure on stderr and exits 2 with nothing on stdout, so the
# reason -- "log in again with make e2e-login" when the refresh token is dead -- is kept
# here rather than dropped down /dev/null, and joins the status line on the failed branch.
# One run, both streams: a second invocation would be a second refresh.
proto_tok_err_file="$(mktemp)"
proto_tok="${FS_ACCESS_TOKEN:-$(cd packages/engine/mcp-server && npx tsx dev/fs-token.ts --min-life "${PROTO_TOKEN_MIN_LIFE:-30}" 2>"$proto_tok_err_file")}"
proto_tok_err="$(tr '\n' ' ' < "$proto_tok_err_file")"
rm -f "$proto_tok_err_file"
if [ -n "$proto_tok" ]; then
  printf '%s' "$proto_tok" > "$PROTO_TOKEN_FILE"
  proto_tok_status="written to $PROTO_TOKEN_FILE (lives an hour; make proto-token between turns forces a refresh under 35 min left)"
elif [ -s "$PROTO_TOKEN_FILE" ]; then
  proto_tok_status="refresh FAILED; the previous token in $PROTO_TOKEN_FILE is kept (it may have expired)${proto_tok_err:+ -- $proto_tok_err}"
else
  proto_tok_status="UNSET (no desktop login to refresh)${proto_tok_err:+ -- $proto_tok_err}"
fi
echo "proto env: ANTHROPIC_API_KEY $([ -n "$ANTHROPIC_API_KEY" ] && echo set || echo UNSET); OPENROUTER_API_KEY $([ -n "$OPENROUTER_API_KEY" ] && echo set || echo UNSET); FS token $proto_tok_status" >&2
unset proto_tok proto_tok_status proto_tok_err proto_tok_err_file
