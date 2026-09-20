"""Offline shape checks on the D3 compose skeleton under apps/server/proto/.

Plan: docs/plan/search-agent-prototype.md, "Week 1" D3. These pin the decisions the
topology exists to make, so a well-meaning edit cannot quietly undo one:

- the shim is its own service and holds the docker socket -- that is what lets it
  kill the worker on a step-ceiling overrun without dying with it;
- the worker restarts unless stopped -- a kill needs a fresh worker to redeliver to;
- READ_TIMEOUT_S is the 1800 s step ceiling by default -- an `up` environment may set it
  (proto-demo-auto's 7200), read here off the interpolation's default -- and only the
  ceiling override lowers it;
- elasticmq's visibility timeout sits above every ceiling the shim can run at -- the
  compose default and the one proto-demo-auto exports -- and there is NO redrive
  policy -- ChangeMessageVisibility never resets the receive count, so any
  maxReceiveCount would dead-letter a legitimately long turn;
- the schema creates every table the plan names and not committed_batches
  (cut 2026-09-10);
- the D16 tool server runs read-only with /tmp its only tmpfs (no /projects: project
  state is in Postgres/S3, bound per request from X-Genealogy-Project-Id), publishes on
  loopback only, waits on postgres and minio being healthy, carries the worker's
  GENEALOGY_* store block byte for byte (one store, two readers), and is waited on by
  proto-up but never by proto-up-core (the D3 smoke must not gate on the engine image).

No Docker needed: the compose files parse as YAML; the HOCON conf and the SQL are
read as text with their comments stripped first, so a comment that *mentions*
deadLettersQueue or committed_batches is not an offence.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

PROTO = Path(__file__).resolve().parents[1] / "proto"
COMPOSE = PROTO / "docker-compose.yml"
CEILING_OVERRIDE = PROTO / "docker-compose.ceiling.yml"
ELASTICMQ_CONF = PROTO / "elasticmq.conf"
SQL_DIR = PROTO / "sql"
MAKEFILE = Path(__file__).resolve().parents[3] / "Makefile"

STEP_CEILING_S = 1800

# PLAN.md "Postgres schema". committed_batches was cut 2026-09-10 and must not
# reappear in this tree; it belongs to D6-8 if it comes back at all.
EXPECTED_TABLES = frozenset({
    "projects",
    "documents",
    "blobs",
    "staging",
    "session_entries",
    "sessions",
    "turns",
    "session_events",
    "session_seq",
    "session_activity",
    "tool_calls",
})

_CREATE_TABLE = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?(\w+)\"?", re.IGNORECASE)
# HOCON durations: elasticmq reads a Duration, so a bare number would be milliseconds;
# the check requires a unit it understands and converts to seconds.
_DURATION = re.compile(r"defaultVisibilityTimeout\s*[=:]\s*\"?(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes)\b")
_UNIT_S = {"s": 1, "sec": 1, "second": 1, "seconds": 1, "m": 60, "min": 60, "minute": 60, "minutes": 60}
# Compose durations ("30s", "1m30s", "500ms"); the shim's stop budget is read from these.
_COMPOSE_DURATION = re.compile(r"(\d+)(ms|s|m|h)")
_COMPOSE_UNIT_S = {"ms": 0.001, "s": 1.0, "m": 60.0, "h": 3600.0}
SHIM_LONG_POLL_S = 20  # WAIT_TIME_S in shim.py: the poll a stopping shim must let return


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _service(compose: dict, name: str) -> dict:
    return compose["services"][name]


def _env(service: dict) -> dict[str, str]:
    """Compose accepts `environment` as a mapping or a list of KEY=VALUE strings."""
    raw = service.get("environment") or {}
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    out: dict[str, str] = {}
    for item in raw:
        key, _, value = str(item).partition("=")
        out[key] = value
    return out


def _volumes(service: dict) -> list[str]:
    """Normalise short ("src:dst[:mode]") and long ({source, target}) volume syntax."""
    out: list[str] = []
    for entry in service.get("volumes") or []:
        if isinstance(entry, str):
            out.append(entry)
        else:
            out.append(f"{entry.get('source')}:{entry.get('target')}")
    return out


def _ports(service: dict) -> list[str]:
    """Normalise short ("host:container") and long ({published, target}) port syntax to
    the short string, so a loopback check can read the host side."""
    out: list[str] = []
    for entry in service.get("ports") or []:
        if isinstance(entry, (str, int)):
            out.append(str(entry))
        else:
            out.append(f"{entry.get('host_ip', '')}:{entry.get('published')}:{entry.get('target')}".lstrip(":"))
    return out


def _recipe(target: str) -> list[str]:
    """The recipe of a root-Makefile target as make sees it: the tab-indented lines after
    its rule line, up to the next non-indented line, with backslash-continued lines joined
    into one logical line (so a reflowed `--wait` list is still one line)."""
    lines = MAKEFILE.read_text(encoding="utf-8").splitlines()
    rule = re.compile(rf"^{re.escape(target)}\s*:")
    for i, line in enumerate(lines):
        if rule.match(line):
            body: list[str] = []
            for follow in lines[i + 1:]:
                if follow.startswith("\t"):
                    if body and body[-1].endswith("\\"):
                        body[-1] = body[-1][:-1] + " " + follow.strip()
                    else:
                        body.append(follow)
                elif follow.strip() == "" or follow.startswith("#"):
                    continue
                else:
                    break
            return body
    raise AssertionError(f"Makefile has no target {target!r}")


def _strip_line_comments(text: str, markers: tuple[str, ...]) -> str:
    pattern = re.compile("(" + "|".join(re.escape(m) for m in markers) + r").*$")
    return "\n".join(pattern.sub("", line) for line in text.splitlines())


def _hocon() -> str:
    return _strip_line_comments(ELASTICMQ_CONF.read_text(encoding="utf-8"), ("#", "//"))


def _turns_block() -> str:
    """The body of the `turns { ... }` block, matched by brace depth so a nested block
    (a deadLettersQueue { }, say) does not truncate it at its first `}`."""
    text = _hocon()
    match = re.search(r"\"?turns\"?\s*\{", text)
    assert match, "elasticmq.conf must define a `turns` queue"
    depth, start = 1, match.end()
    for i in range(start, len(text)):
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        if depth == 0:
            return text[start:i]
    raise AssertionError("elasticmq.conf: unbalanced braces in the `turns` block")


def _created_tables() -> set[str]:
    names: set[str] = set()
    for sql in sorted(SQL_DIR.glob("*.sql")):
        body = _strip_line_comments(sql.read_text(encoding="utf-8"), ("--",))
        names.update(m.group(1).lower() for m in _CREATE_TABLE.finditer(body))
    return names


# ── compose topology ────────────────────────────────────────────────────────────


def test_shim_is_its_own_service_and_holds_the_docker_socket():
    compose = _load(COMPOSE)
    shim_socket = [v for v in _volumes(_service(compose, "shim")) if v.startswith("/var/run/docker.sock:")]
    assert shim_socket, "the shim must mount /var/run/docker.sock: it kills the worker on a ceiling overrun"
    assert not shim_socket[0].endswith(":ro"), "the kill is a POST to the engine API; the socket cannot be read-only"
    worker_socket = [v for v in _volumes(_service(compose, "worker")) if "docker.sock" in v]
    assert not worker_socket, "the worker must NOT hold the socket; the shim is a separate service by design"


def test_worker_restarts_unless_stopped():
    assert _service(_load(COMPOSE), "worker").get("restart") == "unless-stopped"


def test_worker_is_not_published_on_the_host():
    assert "ports" not in _service(_load(COMPOSE), "worker"), "the worker listens inside the network only"


def test_shim_kill_target_is_the_worker_container():
    compose = _load(COMPOSE)
    target = _env(_service(compose, "shim"))["WORKER_CONTAINER"]
    assert target == _service(compose, "worker")["container_name"]


def test_shim_stop_grace_covers_a_full_long_poll():
    """A stopping shim lets its in-flight ReceiveMessage return before exiting; compose
    must not SIGKILL it first (the default 10 s would), or that poll is orphaned and
    swallows the next message for the whole visibility timeout."""
    shim = _service(_load(COMPOSE), "shim")
    raw = str(shim.get("stop_grace_period") or "")
    parts = _COMPOSE_DURATION.findall(raw)
    assert parts and _COMPOSE_DURATION.sub("", raw) == "", f"shim needs a stop_grace_period, got {raw!r}"
    grace_s = sum(int(n) * _COMPOSE_UNIT_S[u] for n, u in parts)
    stop_grace_env = float(_env(shim).get("STOP_GRACE_S", "30"))
    assert grace_s >= stop_grace_env > SHIM_LONG_POLL_S, (
        f"stop_grace_period {grace_s}s must cover STOP_GRACE_S {stop_grace_env}s, "
        f"which must exceed the {SHIM_LONG_POLL_S}s long poll"
    )


def test_shim_waits_for_a_healthy_worker():
    """A shim that starts before the worker listens burns a receive count on a refused
    connection, so a crash/sleep turn sent right after `up` never runs its arm."""
    assert _service(_load(COMPOSE), "shim")["depends_on"]["worker"] == {"condition": "service_healthy"}


# ── tool server (D16) ───────────────────────────────────────────────────────────


def test_tools_runs_read_only_with_no_project_root():
    tools = _service(_load(COMPOSE), "tools")
    assert tools.get("read_only") is True, "project state is in Postgres/S3; nothing writes to the rootfs"
    tmpfs = [str(t).split(":", 1)[0] for t in (tools.get("tmpfs") or [])]
    assert "/projects" not in tmpfs, "no file root: a /projects tmpfs would mean the file backend is back"
    assert "/tmp" in tmpfs, "/tmp stays writable on the read-only rootfs"


def test_tools_is_published_on_loopback_only():
    ports = _ports(_service(_load(COMPOSE), "tools"))
    assert ports, "the host smoke (make engine-smoke-http BASE=...) reaches the server from the host"
    assert all(p.startswith("127.0.0.1:") for p in ports), "no auth beyond header -> principal: publish on loopback only"


def test_tools_depends_on_the_store_services():
    depends = _service(_load(COMPOSE), "tools").get("depends_on") or {}
    assert depends.get("postgres") == {"condition": "service_healthy"}, "the per-request PgS3ProjectStore needs Postgres up"
    assert depends.get("minio") == {"condition": "service_healthy"}, "and the blob side needs minio up"


def test_tools_and_worker_read_one_store():
    """The stdio fork (worker) and the shared HTTP server (tools) are two readers of one
    store: their GENEALOGY_* blocks must be identical, or a TOOL_SERVER flip silently
    moves the project tools onto a store the rest of the stack never reads."""
    compose = _load(COMPOSE)
    tools = {k: v for k, v in _env(_service(compose, "tools")).items() if k.startswith("GENEALOGY_")}
    worker = {k: v for k, v in _env(_service(compose, "worker")).items() if k.startswith("GENEALOGY_")}
    assert tools == worker, f"tools and worker GENEALOGY_* differ: {tools} vs {worker}"
    assert set(tools) == {
        "GENEALOGY_PG_DSN", "GENEALOGY_S3_ENDPOINT", "GENEALOGY_S3_BUCKET",
        "GENEALOGY_S3_ACCESS_KEY", "GENEALOGY_S3_SECRET_KEY", "GENEALOGY_ANCHOR_PATH",
    }, "the five store variables plus the anchor, and no GENEALOGY_PROJECT_ID: the id is per request"


def _wait_services(line: str) -> list[str]:
    """The service names after `--wait` on one logical recipe line, a trailing comment stripped."""
    return line.split("#", 1)[0].split("--wait", 1)[1].split()


def test_proto_up_waits_for_tools_but_proto_up_core_does_not():
    core = _recipe("proto-up-core")
    assert core, "proto-up-core has a recipe"
    assert not any(re.search(r"\btools\b", line) for line in core), "the D3 smoke must not gate on the engine image"
    wait_lines = [line for line in _recipe("proto-up") if "--wait" in line]
    assert wait_lines, "proto-up has a --wait line"
    assert any("tools" in _wait_services(line) for line in wait_lines), "proto-up must wait for the tool server's healthcheck"


# ── step ceiling ────────────────────────────────────────────────────────────────


# A compose interpolation: `${VAR:-default}` / `${VAR-default}` -> (VAR, default); a literal
# -> (None, literal). The shim's ceiling is read off the default, not the literal.
_INTERPOLATION = re.compile(r"^\$\{(\w+):?-([^}]*)\}$")


def _compose_default(value: str) -> tuple[str | None, str]:
    match = _INTERPOLATION.match(value.strip())
    return (match.group(1), match.group(2)) if match else (None, value.strip())


def test_tools_carries_the_per_user_config_the_stdio_fork_used_to_pass():
    """With http the default, the shared service is where image_transcribe's key has to be:
    the per-turn fork got it from the worker's env (PER_USER_ENV_KEYS) and the two headers
    the service reads carry no config. Passed through, never a literal."""
    env = _env(_service(_load(COMPOSE), "tools"))
    for name in ("OPENROUTER_API_KEY", "OPENROUTER_MODEL", "WIKI_API_URL", "POP_STATS_URL"):
        var, default = _compose_default(env[name])
        assert var == name and default == "", f"{name} must pass the caller's value through, empty when unset"


def test_worker_tool_server_default_is_http_and_matches_the_workers_own_fallback():
    """The lead's call, 2026-09-20: an unqualified `make proto-up` runs the shared `tools`
    service, the shape production runs, and TOOL_SERVER=stdio is the opt-out. Compose and
    options.py must agree, or a worker started outside compose quietly does the other thing."""
    from proto.worker import options

    var, default = _compose_default(_env(_service(_load(COMPOSE), "worker"))["TOOL_SERVER"])
    assert var == "TOOL_SERVER", "the interpolation must read the name the recipes and the lead export"
    assert default == options.TOOL_SERVER_DEFAULT == "http"


def test_only_the_recipes_that_wait_for_tools_can_run_a_real_turn_on_the_default():
    """With http as the default a worker reaches `tools` over the compose network, so every
    recipe that runs a REAL turn has to bring it up. proto-up-core deliberately does not (the
    D3 smoke's stub arms never build worker options, so they never reach a tool server)."""
    def brings_tools_up(target: str, seen: frozenset = frozenset()) -> bool:
        """The recipe waits for `tools` itself, or delegates to one that does."""
        assert target not in seen, f"{target} delegates in a cycle"
        body = _recipe(target)
        assert body, f"{target} has a recipe"
        if any("tools" in _wait_services(line) for line in body if "--wait" in line):
            return True
        return any(
            brings_tools_up(other, seen | {target})
            for other in ("proto-up", "proto-turn", "proto-demo")
            if f"$(MAKE) {other} " in "\n".join(body)
        )

    for target in ("proto-up", "proto-turn", "proto-demo", "proto-kill", "proto-demo-auto"):
        assert brings_tools_up(target), \
            f"{target} runs a real turn on the http default: it must wait for `tools` or delegate to one that does"
    # The exception, with its reason: the D3 smoke's stub arms never build worker options.
    assert not any(re.search(r"\btools\b", line) for line in _recipe("proto-up-core"))


def test_shim_read_timeout_is_the_step_ceiling():
    """The compose default is the pinned 1800 s; the variable that overrides it is the one
    proto-demo-auto exports (7200 for the D18 arm), so a renamed interpolation would leave
    that arm silently at 1800."""
    env = _env(_service(_load(COMPOSE), "shim"))
    var, default = _compose_default(env["READ_TIMEOUT_S"])
    assert int(default) == STEP_CEILING_S
    assert var == "READ_TIMEOUT_S", "proto-demo-auto exports READ_TIMEOUT_S; the interpolation must read that name"


def test_compose_default_reads_the_interpolation_or_the_literal():
    assert _compose_default("${READ_TIMEOUT_S:-1800}") == ("READ_TIMEOUT_S", "1800")
    assert _compose_default("${READ_TIMEOUT_S-1800}") == ("READ_TIMEOUT_S", "1800")
    assert _compose_default("1800") == (None, "1800")
    assert _compose_default("${READ_TIMEOUT_S}") == (None, "${READ_TIMEOUT_S}"), "no default: not a pinned ceiling"


def test_ceiling_override_lowers_read_timeout_and_nothing_else():
    override = _load(CEILING_OVERRIDE)
    assert set(override["services"]) == {"shim"}, "the override touches the shim only"
    shim = override["services"]["shim"]
    assert set(shim) == {"environment"}, "the override sets environment only"
    env = _env(shim)
    assert set(env) == {"READ_TIMEOUT_S"}
    assert 0 < int(env["READ_TIMEOUT_S"]) < STEP_CEILING_S


# ── queue ───────────────────────────────────────────────────────────────────────


# proto-demo-auto's `export READ_TIMEOUT_S="${READ_TIMEOUT_S:-7200}"` in raw make text ($$
# is the shell's $); either default form, since this reads the number only.
_EXPORTED_CEILING = re.compile(r'export READ_TIMEOUT_S="\$\$\{READ_TIMEOUT_S:?-(\d+)\}"')


def _exported_ceiling_s() -> int:
    match = _EXPORTED_CEILING.search("\n".join(_recipe("proto-demo-auto")))
    assert match, "proto-demo-auto no longer exports READ_TIMEOUT_S; re-derive the largest ceiling here"
    return int(match.group(1))


def test_elasticmq_visibility_timeout_exceeds_the_ceiling():
    """The shim never extends a message's visibility while its POST is in flight, so an
    attempt longer than the visibility timeout is redelivered mid-flight and the worker
    runs the same turn twice at once on one SDK session. The literal must therefore top
    every ceiling the shim can run at -- the compose default and the one proto-demo-auto
    exports (7200 s) -- not only the 1800 s this compared against until 2026-09-20."""
    match = _DURATION.search(_turns_block())
    assert match, "turns needs a defaultVisibilityTimeout with a seconds/minutes unit"
    seconds = int(match.group(1)) * _UNIT_S[match.group(2)]
    ceiling = max(STEP_CEILING_S, _exported_ceiling_s())
    assert seconds > ceiling, f"visibility timeout {seconds}s must exceed the largest step ceiling, {ceiling}s"


def test_elasticmq_has_no_redrive_policy():
    assert "deadLettersQueue" not in _hocon(), "no redrive policy: any maxReceiveCount dead-letters a long turn"


# ── schema ──────────────────────────────────────────────────────────────────────


def test_schema_creates_every_planned_table():
    missing = EXPECTED_TABLES - _created_tables()
    assert not missing, f"sql/*.sql is missing CREATE TABLE for: {sorted(missing)}"


def test_schema_has_no_committed_batches():
    assert "committed_batches" not in _created_tables()
