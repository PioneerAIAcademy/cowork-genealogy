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
#   https://malachi.taild68f1b.ts.net:8443/       -> 127.0.0.1:8006  connector probe
#
# The first two are durable. The third is temporary -- the issue #3529 connector
# probe, on its own port because connector sign-in needs the host root and /wiki
# already occupies the 443 root. It is NOT applied by default; pass --with-probe.
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
# The probe has deliberately NO unit: its OAuth tokens live in memory, so a
# restart invalidates every issued token in a way a client cannot distinguish
# from expiry. Restart=always would silently break the measurements it exists
# to take. It is run in the foreground for as long as a test needs it.
#
# A NOTE ON PORTS
#
# Funnel is only available on 443, 8443 and 10000 (`tailscale status --json`,
# Self.Capabilities: "funnel-ports?ports=443,8443,10000"). That is why the two
# durable services share 443 by path prefix rather than taking a port each, and
# why a service needing the host root has to go to 8443.
#
# USAGE
#
#   ./scripts/tailscale-services.sh status           show the live mappings
#   ./scripts/tailscale-services.sh check            probe all three over HTTPS
#   ./scripts/tailscale-services.sh apply            (re)create the durable two
#   ./scripts/tailscale-services.sh apply --with-probe   ... and the probe on 8443
#   ./scripts/tailscale-services.sh reset            remove ALL serve/funnel config
#
# `apply` is idempotent: it sets the mapping to the stated target rather than
# appending, so re-running changes nothing. It needs `tailscale` already logged
# in on the host, and Funnel enabled for the tailnet in the admin console.
set -euo pipefail

HOST_FQDN="malachi.taild68f1b.ts.net"

WIKI_PORT=8008
POP_STATS_PORT=8005
PROBE_PORT=8006
PROBE_PUBLIC_PORT=8443

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
# is a real route, so a 200 proves the whole path end to end. The probe answers
# /livez, and its /mcp must answer 401: that is auth being enforced, not a fault.
cmd_check() {
  local fail=0
  _probe() { # label expected url
    local label=$1 expected=$2 url=$3 got
    got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo "000")
    if [[ "$got" == "$expected" ]]; then
      printf '  ok    %-28s %s\n' "$label" "$got"
    else
      printf '  FAIL  %-28s got %s, want %s  (%s)\n' "$label" "$got" "$expected" "$url"
      fail=1
    fi
  }
  printf 'checking https://%s\n' "$HOST_FQDN"
  _probe "wiki"            200 "https://${HOST_FQDN}/wiki/openapi.json"
  _probe "pop-stats"       200 "https://${HOST_FQDN}/pop-stats/openapi.json"
  _probe "probe /livez"    200 "https://${HOST_FQDN}:${PROBE_PUBLIC_PORT}/livez"
  _probe "probe /mcp (401)" 401 "https://${HOST_FQDN}:${PROBE_PUBLIC_PORT}/mcp"
  if (( fail )); then
    printf '\nA probe failure is either the mapping or the service behind it.\n'
    printf 'Check both: ./scripts/tailscale-services.sh status\n'
    printf '            systemctl status wiki-query-api pop-stats-api\n'
    printf 'The probe is expected to fail unless someone is running it; see above.\n'
    return 1
  fi
}

cmd_apply() {
  require_tailscale
  local with_probe=0
  [[ "${1:-}" == "--with-probe" ]] && with_probe=1

  # --bg detaches (the mapping outlives this shell and survives reboot, since
  # tailscaled holds it); --yes skips the interactive confirmation so the script
  # is non-interactive. Funnel implies Serve, so these also make it tailnet-local.
  echo "serving /wiki -> 127.0.0.1:${WIKI_PORT}"
  tailscale funnel --bg --yes --set-path=/wiki "http://127.0.0.1:${WIKI_PORT}"

  echo "serving /pop-stats -> 127.0.0.1:${POP_STATS_PORT}"
  tailscale funnel --bg --yes --set-path=/pop-stats "http://127.0.0.1:${POP_STATS_PORT}"

  if (( with_probe )); then
    echo "serving :${PROBE_PUBLIC_PORT}/ -> 127.0.0.1:${PROBE_PORT} (temporary, #3529)"
    tailscale funnel --bg --yes --https="${PROBE_PUBLIC_PORT}" "http://127.0.0.1:${PROBE_PORT}"
  else
    echo "skipping the #3529 probe on :${PROBE_PUBLIC_PORT} (pass --with-probe to add it)"
  fi

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
  apply)  shift; cmd_apply "${1:-}" ;;
  reset)  cmd_reset ;;
  *)
    sed -n '/^# USAGE$/,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; $d'
    exit 1
    ;;
esac
