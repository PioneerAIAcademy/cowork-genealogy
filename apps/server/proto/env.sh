# Sourced by the proto make recipes before `compose up`, from the repo root:
#
#   . apps/server/proto/env.sh
#
# Two secrets, neither ever echoed:
#
#   ANTHROPIC_API_KEY  exported: the caller's, else the line in eval/.env. The worker
#                      reads it from the environment of the `up` that creates it.
#   the FS token       written to apps/server/proto/.fs-token (mode 600), which compose
#                      mounts at /run/fs-token and the worker reads PER TURN -- so
#                      `make proto-token` (this file again) refreshes it under a running
#                      worker. FamilySearch access tokens live an hour. The value is the
#                      caller's FS_ACCESS_TOKEN, else the desktop login's token refreshed
#                      through the engine's own path (dev/fs-token.ts); empty when there
#                      is no login, and then every FamilySearch tool answers with the
#                      reconnect instruction. Written in place: the bind mount follows
#                      the inode, so a rename would leave the container on the old file.
#
# One status line on stderr says what is set.
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  ANTHROPIC_API_KEY="$(sed -n 's/^ANTHROPIC_API_KEY=//p' eval/.env 2>/dev/null | head -1)"
fi
export ANTHROPIC_API_KEY

PROTO_TOKEN_FILE=apps/server/proto/.fs-token
# A compose `up` before the file existed leaves an empty directory in its place.
if [ -d "$PROTO_TOKEN_FILE" ]; then rmdir "$PROTO_TOKEN_FILE"; fi
if [ ! -f "$PROTO_TOKEN_FILE" ]; then : > "$PROTO_TOKEN_FILE"; chmod 600 "$PROTO_TOKEN_FILE"; fi
proto_tok="${FS_ACCESS_TOKEN:-$(cd packages/engine/mcp-server && npx tsx dev/fs-token.ts 2>/dev/null)}"
printf '%s' "$proto_tok" > "$PROTO_TOKEN_FILE"
echo "proto env: ANTHROPIC_API_KEY $([ -n "$ANTHROPIC_API_KEY" ] && echo set || echo UNSET); FS token $([ -n "$proto_tok" ] && echo "written to $PROTO_TOKEN_FILE (lives an hour; make proto-token refreshes it)" || echo "UNSET (no desktop login to refresh)")" >&2
unset proto_tok
