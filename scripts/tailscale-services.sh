#!/usr/bin/env bash
#
# The public ingress for the hosted sidecar services, as source.
#
# WHY THIS FILE EXISTS
#
# Two MCP tools reach hosted services over the public internet, and their
# default URLs are compiled into the engine:
#
#   packages/engine/mcp-server/src/auth/config.ts:39
#     DEFAULT_WIKI_API_URL  = "https://malachi.taild68f1b.ts.net/wiki"
#   packages/engine/mcp-server/src/tools/place-population.ts:8
#     DEFAULT_POP_STATS_URL = "https://malachi.taild68f1b.ts.net/pop-stats"
#
# Every installed .mcpb reaches those URLs, so they are production ingress for
# `wiki_search`, `wiki_read`, `wiki_place_page` and `place_population`. But the
# config that makes them resolve -- the Tailscale Serve/Funnel mappings -- lived
# only in tailscaled's own state on one machine. It persists across reboots,
# which is exactly what made it easy to forget: nothing recorded it, and it was
# not reconstructible from any repo. If that host were rebuilt, the URLs above
# would stop resolving for every install, and nobody could recover the mappings.
#
# This script is that record. It is the documentation; the commands below are
# the authoritative form, verified against `tailscale serve status` on the live
# host and `tailscale --help` for 1.104.4.
#
# WHAT IS SERVED
#
#   https://malachi.taild68f1b.ts.net/wiki        -> 127.0.0.1:8008  wiki-query-api
#   https://malachi.taild68f1b.ts.net/pop-stats   -> 127.0.0.1:8005  pop-stats-api
#   https://malachi.taild68f1b.ts.net/            -> 127.0.0.1:8006  (reserved)
#
# The first two are durable. The third is a reserved slot, held for a test MCP
# server not yet deployed. The #3529 connector probe occupied it until
# 2026-11-03 and is retired; its own `:8443` mapping is gone (see RETIRED).
#
# THE RESERVED SLOT: WHY IT IS THE BARE ROOT
#
# `/` is a catch-all: every path not matched by a more specific mapping goes to
# 8006. That looks untidy beside `--set-path=/mcp`, and is nonetheless the
# correct shape for an MCP server, for the reason in 1. 2 is a measured trap.
#
# 1. An MCP server's sign-in does not live under /mcp. OAuth discovery is at
#    host-root paths -- /.well-known/oauth-protected-resource,
#    /.well-known/oauth-authorization-server -- plus, when the server is its
#    own authorization server, /authorize and /token. A /mcp-only mapping
#    routes none of them, so sign-in cannot complete.
#
# 2. `--set-path` strips the mount prefix before forwarding. Measured on this
#    host, against a target carrying no path of its own:
#        curl localhost:8005/openapi.json            -> 200  (the real route)
#        curl localhost:8005/pop-stats/openapi.json  -> 404  (no such route)
#        curl $HOST/pop-stats/openapi.json           -> 200  (works anyway)
#    All three hold only if Tailscale removes `/pop-stats` and forwards
#    `/openapi.json`. So `--set-path=/mcp` with a bare target delivers `/` to
#    the server; put the path on the target (`http://127.0.0.1:8006/mcp`) to
#    keep it, since the stripped remainder is appended to the target's own path
#    (Tailscale's serve.go, via Go's documented SetURL behaviour -- read, not
#    measured here). That is a trap, not a reason: 1 alone rules out /mcp.
#
# More specific paths still win, so /wiki and /pop-stats are unaffected by the
# catch-all -- verified: both answer 200 with `/` mapped.
#
# CONSEQUENCE, worth knowing before binding that port: anything listening on
# 127.0.0.1:8006 is published to the public internet at the host root the
# moment it starts, with no further action and no warning. 8005 and 8008 are
# occupied right beside it, so 8006 is a plausible port for an unrelated dev
# process to grab. If the eventual test server wants isolation instead, give it
# its own Funnel port (8443 or 10000) with a root mapping on that port, and set
# the server's advertised public URL to include the port -- see RETIRED.
#
# RETIRED: the :8443 mapping
#
# The probe first ran at `…ts.net:8443/`, on the theory that a service needing
# the host root could not share 443 with /wiki. That theory was wrong -- `/`
# coexists with /wiki and /pop-stats fine. The port also caused a real failure:
# the server advertises one public URL, and with that URL set to the 443 form,
# a client arriving on :8443 sent `resource=…:8443/mcp` and was refused with
# `invalid_target`. A dedicated port is viable, but only if the advertised URL
# carries the port. Turned off 2026-11-03: `tailscale funnel --https=8443 off`.
#
# THE SERVICES BEHIND IT (not managed here)
#
# The two durable services run from a sibling repo (fs-eng/search-agent-tools)
# under system systemd units, enabled, each bound to loopback only so that
# Tailscale is the sole public path in:
#
#   /etc/systemd/system/wiki-query-api.service
#     uv run python scripts/serve.py --port 8008        (WorkingDirectory: wiki-query-api/)
#   /etc/systemd/system/pop-stats-api.service
#     uv run uvicorn api.app:app --host 127.0.0.1 --port 8005
#
# Both are Type=simple, Restart=always, RestartSec=3, After/Wants
# network-online.target, running as the host user.
#
# Nothing occupies the reserved slot today. When the test MCP server lands,
# note that the #3529 probe deliberately had no unit: its OAuth tokens lived in
# memory, so a restart invalidated every issued token in a way a client cannot
# distinguish from expiry, and Restart=always would have silently broken the
# measurements it existed to take. Whether that applies to the real server
# depends on where it keeps its tokens.
#
# A NOTE ON PORTS
#
# Funnel is only available on 443, 8443 and 10000 (`tailscale status --json`,
# Self.Capabilities: "funnel-ports?ports=443,8443,10000"). That is why the
# services here share 443 by path prefix rather than taking a port each. A
# service needing the host root does NOT have to take its own port -- the bare
# `/` on 443 coexists with the prefixed mappings; see THE RESERVED SLOT above.
#
# USAGE
#
#   ./scripts/tailscale-services.sh status   show the live mappings
#   ./scripts/tailscale-services.sh check    probe the durable two and the empty slot
#   ./scripts/tailscale-services.sh apply    (re)create all three mappings
#   ./scripts/tailscale-services.sh reset    remove ALL serve/funnel config
#
# `apply` is idempotent: it sets the mapping to the stated target rather than
# appending, so re-running changes nothing. It needs `tailscale` already logged
# in on the host, and Funnel enabled for the tailnet in the admin console.
set -euo pipefail

HOST_FQDN="malachi.taild68f1b.ts.net"

WIKI_PORT=8008
POP_STATS_PORT=8005
# The reserved slot's local port. Served at the bare `/` on 443, so whatever
# binds it is public at the host root immediately.
RESERVED_PORT=8006

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

require_tailscale() {
  command -v tailscale >/dev/null 2>&1 || die "tailscale is not on PATH"
}

cmd_status() {
  require_tailscale
  tailscale serve status
}

# Each service's cheapest unauthenticated proof of life. The two APIs have no
# route at their own root, so a bare /wiki or /pop-stats answers 404 from the
# app itself -- correct, but indistinguishable from a broken mapping. openapi.json
# is a real route, so a 200 proves the whole path end to end.
#
# The reserved slot is probed on /livez, the malachi stack's public liveness route,
# and on /auth/config, which only that stack's web tier serves: 502 means nothing is
# listening on 8006 and 200 means the stack's edge is up. 404 at /livez means the
# mapping is gone; 404 at /auth/config alone is a tool server or the connector probe,
# which answer /livez too. Anything else means some other process bound 8006 and is
# now public -- the hazard the header warns about, which nothing else detects.
cmd_check() {
  local fail=0
  _probe() { # label expected url, where expected is a space-separated list
    local label=$1 expected=$2 url=$3 got
    # The fallback is required under `set -e` (curl exits non-zero when it cannot
    # connect) but must print nothing: curl has already written `000` from -w, so
    # an `echo 000` here would report the doubled "000000".
    got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)
    if [[ " $expected " == *" $got "* ]]; then
      printf '  ok    %-28s %s\n' "$label" "$got"
    else
      printf '  FAIL  %-28s got %s, want %s  (%s)\n' "$label" "$got" "$expected" "$url"
      fail=1
    fi
  }
  printf 'checking https://%s\n' "$HOST_FQDN"
  _probe "wiki"            200 "https://${HOST_FQDN}/wiki/openapi.json"
  _probe "pop-stats"       200 "https://${HOST_FQDN}/pop-stats/openapi.json"
  _probe "reserved /livez (502 or 200)" "502 200" "https://${HOST_FQDN}/livez"
  _probe "reserved /auth/config (502 or 200)" "502 200" "https://${HOST_FQDN}/auth/config"
  if (( fail )); then
    printf '\nA probe failure is either the mapping or the service behind it.\n'
    printf 'Check both: ./scripts/tailscale-services.sh status\n'
    printf '            systemctl status wiki-query-api pop-stats-api\n'
    printf 'If the reserved slot answered neither 502 nor 200, something other than\n'
    printf "the stack's edge bound 8006 and is public at the host root: ss -ltnp | grep :8006\n"
    return 1
  fi
}

cmd_apply() {
  require_tailscale

  # --bg detaches (the mapping outlives this shell and survives reboot, since
  # tailscaled holds it); --yes skips the interactive confirmation so the script
  # is non-interactive. Funnel implies Serve, so these also make it tailnet-local.
  echo "serving /wiki -> 127.0.0.1:${WIKI_PORT}"
  tailscale funnel --bg --yes --set-path=/wiki "http://127.0.0.1:${WIKI_PORT}"

  echo "serving /pop-stats -> 127.0.0.1:${POP_STATS_PORT}"
  tailscale funnel --bg --yes --set-path=/pop-stats "http://127.0.0.1:${POP_STATS_PORT}"

  # The reserved slot. Applied unconditionally: it is part of the recorded
  # configuration, and a bare `/` with nothing behind it answers 502 -- which
  # leaks nothing and is the honest state of an unoccupied slot.
  echo "serving / -> 127.0.0.1:${RESERVED_PORT} (reserved; 502 until something binds it)"
  tailscale funnel --bg --yes "http://127.0.0.1:${RESERVED_PORT}"

  echo
  cmd_status
}

cmd_reset() {
  require_tailscale
  echo "This removes ALL serve/funnel config on this node, including /wiki and"
  echo "/pop-stats, which every installed .mcpb depends on."
  read -r -p "Type 'reset' to continue: " reply
  [[ "$reply" == "reset" ]] || die "aborted"
  tailscale serve reset
  cmd_status
}

case "${1:-}" in
  status) cmd_status ;;
  check)  cmd_check ;;
  apply)  cmd_apply ;;
  reset)  cmd_reset ;;
  *)
    sed -n '/^# USAGE$/,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; $d'
    exit 1
    ;;
esac
