#!/bin/bash
# The web tier's proxy to the tools tier, for a connector deployment (self-hosted beta
# shape on Beanstalk; handoff step 15, TOOLS_UPSTREAM_URL). Claude reaches the MCP server
# and its sign-in on ONE origin: the tools tier names its protected-resource metadata
# under the web tier's issuer, so /mcp, that metadata document and /img must answer on
# the web tier's host. malachi's edge (../malachi/nginx.conf) routes the same three paths.
#
# TOOLS_UPSTREAM_URL unset or empty: writes nothing and removes an earlier file, so nginx
# is exactly the platform's plus conf.d/*.conf, as before this hook. Set: it must be
# http(s)://host[:port] with nothing after it, else the deploy fails here.
#
# A prebuild hook, because Beanstalk runs prebuild before it configures the web server
# from the staged .platform/nginx; files under conf.d/elasticbeanstalk/ are included
# inside its default server block. Hooks do not inherit the application's environment,
# so the value is read from get-config's whole environment object, never `-k`, whose
# answer for a missing key -- the default, unset case -- is not documented; with no
# get-config (offline smoke) it is read from this process's environment. A get-config that
# fails or prints no JSON object is read as unset, with a warning in eb-hooks.log: a chat-on
# deploy must never fail here, and a connector deploy missing its proxy shows at its first
# check (/mcp answers the web tier's 404, not the tools tier's 401). GENEALOGY_GET_CONFIG
# points the tests at a stand-in. A configuration-only deploy does not re-run it:
# change the value with an application deploy (every Blueprint deploy is one).
set -euo pipefail

NAME=110_tools-proxy
OUT_REL=.platform/nginx/conf.d/elasticbeanstalk/10-tools-proxy.conf
URL_RE='^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'

fail() {
  echo "$NAME: $*" >&2
  exit 1
}

warn_unset() {
  echo "$NAME: WARNING: $*; treating TOOLS_UPSTREAM_URL as unset, so no tools proxy" >&2
  url=""
}

GET_CONFIG="${GENEALOGY_GET_CONFIG:-/opt/elasticbeanstalk/bin/get-config}"
staging=""
url=""
if [ -x "$GET_CONFIG" ]; then
  staging="$("$GET_CONFIG" platformconfig -k AppStagingDir 2>/dev/null || true)"
  if env_json="$("$GET_CONFIG" environment 2>/dev/null)"; then
    url="$(printf '%s' "$env_json" | python3 -c '
import json, sys
value = json.load(sys.stdin).get("TOOLS_UPSTREAM_URL", "")
print(value if isinstance(value, str) else "")
' 2>/dev/null)" || warn_unset "get-config environment did not print a JSON object"
  else
    warn_unset "get-config environment failed"
  fi
else
  url="${TOOLS_UPSTREAM_URL:-}"
fi
staging="${staging:-$PWD}"
[ -f "$staging/web/app.py" ] || fail "$staging is not the web bundle"

out="$staging/$OUT_REL"
if [ -z "$url" ]; then
  rm -f "$out"
  echo "$NAME: TOOLS_UPSTREAM_URL unset; no tools proxy"
  exit 0
fi
[[ "$url" =~ $URL_RE ]] || fail "TOOLS_UPSTREAM_URL must be http(s)://host[:port] with no path, query or user info"

# The VPC's resolver as the instance sees it, read per request through the variable below,
# because a load balancer's addresses change; nginx resolves a literal proxy_pass host once.
resolver="$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)"
[[ "$resolver" =~ ^[0-9.]+$ ]] || resolver=169.254.169.253

mkdir -p "$(dirname "$out")"
tmp="$out.tmp"
{
  printf '# Written by %s from TOOLS_UPSTREAM_URL; do not edit.\n' "$NAME"
  printf 'resolver %s valid=30s ipv6=off;\n' "$resolver"
  printf 'set $genealogy_tools_upstream %s;\n' "$url"
  cat <<'EOF'

location = /mcp {
    proxy_pass $genealogy_tools_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 1800s;
    proxy_send_timeout 1800s;
}

location = /.well-known/oauth-protected-resource/mcp {
    proxy_pass $genealogy_tools_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
}

location = /img {
    proxy_pass $genealogy_tools_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
}
EOF
} > "$tmp"
mv "$tmp" "$out"
echo "$NAME: /mcp, its metadata and /img proxied to $url"
