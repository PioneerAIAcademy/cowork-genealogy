# Sourced by the proto make recipes before `compose up`, from the repo root:
#
#   . apps/server/proto/env.sh
#
# Two secrets, neither ever echoed:
#
#   ANTHROPIC_API_KEY  exported: the caller's, else the line in $PROTO_ENV_FILE (default
#                      eval/.env; the test points it at a temp file). The worker
#                      reads it from the environment of the `up` that creates it.
#   OPENROUTER_API_KEY exported the same way (image_transcribe's OCR provider). The
#                      `tools` service reads it from its own environment.
#                      Absent, every image read answers with the no-key error.
#
# No FamilySearch token: the worker bears the turn's project owner's grant, which the web
# tier holds in Postgres and refreshes between attempts (U3). `make proto-grant` stores
# the dev-login patron's grant once per stack.
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

echo "proto env: ANTHROPIC_API_KEY $([ -n "$ANTHROPIC_API_KEY" ] && echo set || echo UNSET); OPENROUTER_API_KEY $([ -n "$OPENROUTER_API_KEY" ] && echo set || echo UNSET)" >&2
