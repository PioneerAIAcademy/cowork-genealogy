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
#                      (dev/fs-token.ts). A failed refresh leaves the file as it was: a
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
proto_tok="${FS_ACCESS_TOKEN:-$(cd packages/engine/mcp-server && npx tsx dev/fs-token.ts 2>/dev/null)}"
if [ -n "$proto_tok" ]; then
  printf '%s' "$proto_tok" > "$PROTO_TOKEN_FILE"
  proto_tok_status="written to $PROTO_TOKEN_FILE (lives an hour; make proto-token refreshes it)"
elif [ -s "$PROTO_TOKEN_FILE" ]; then
  proto_tok_status="refresh FAILED; the previous token in $PROTO_TOKEN_FILE is kept (it may have expired)"
else
  proto_tok_status="UNSET (no desktop login to refresh)"
fi
echo "proto env: ANTHROPIC_API_KEY $([ -n "$ANTHROPIC_API_KEY" ] && echo set || echo UNSET); OPENROUTER_API_KEY $([ -n "$OPENROUTER_API_KEY" ] && echo set || echo UNSET); FS token $proto_tok_status" >&2
unset proto_tok proto_tok_status
