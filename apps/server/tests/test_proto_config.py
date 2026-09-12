"""Offline shape checks on the D3 compose skeleton under apps/server/proto/.

Plan: docs/plan/search-agent-prototype.md, "Week 1" D3. These pin the decisions the
topology exists to make, so a well-meaning edit cannot quietly undo one:

- the shim is its own service and holds the docker socket -- that is what lets it
  kill the worker on a step-ceiling overrun without dying with it;
- the worker restarts unless stopped -- a kill needs a fresh worker to redeliver to;
- READ_TIMEOUT_S is the 1800 s step ceiling, and only the ceiling override lowers it;
- elasticmq's visibility timeout sits above the ceiling and there is NO redrive
  policy -- ChangeMessageVisibility never resets the receive count, so any
  maxReceiveCount would dead-letter a legitimately long turn;
- the schema creates every table the plan names and not committed_batches
  (cut 2026-09-10).

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


# ── step ceiling ────────────────────────────────────────────────────────────────


def test_shim_read_timeout_is_the_step_ceiling():
    env = _env(_service(_load(COMPOSE), "shim"))
    assert int(env["READ_TIMEOUT_S"]) == STEP_CEILING_S


def test_ceiling_override_lowers_read_timeout_and_nothing_else():
    override = _load(CEILING_OVERRIDE)
    assert set(override["services"]) == {"shim"}, "the override touches the shim only"
    shim = override["services"]["shim"]
    assert set(shim) == {"environment"}, "the override sets environment only"
    env = _env(shim)
    assert set(env) == {"READ_TIMEOUT_S"}
    assert 0 < int(env["READ_TIMEOUT_S"]) < STEP_CEILING_S


# ── queue ───────────────────────────────────────────────────────────────────────


def test_elasticmq_visibility_timeout_exceeds_the_ceiling():
    match = _DURATION.search(_turns_block())
    assert match, "turns needs a defaultVisibilityTimeout with a seconds/minutes unit"
    seconds = int(match.group(1)) * _UNIT_S[match.group(2)]
    assert seconds > STEP_CEILING_S, f"visibility timeout {seconds}s must exceed the {STEP_CEILING_S}s step ceiling"


def test_elasticmq_has_no_redrive_policy():
    assert "deadLettersQueue" not in _hocon(), "no redrive policy: any maxReceiveCount dead-letters a long turn"


# ── schema ──────────────────────────────────────────────────────────────────────


def test_schema_creates_every_planned_table():
    missing = EXPECTED_TABLES - _created_tables()
    assert not missing, f"sql/*.sql is missing CREATE TABLE for: {sorted(missing)}"


def test_schema_has_no_committed_batches():
    assert "committed_batches" not in _created_tables()
