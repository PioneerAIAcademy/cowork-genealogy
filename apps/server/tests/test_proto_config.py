"""Offline shape checks on the D3 compose skeleton under apps/server/proto/.

Plan: docs/plan/search-agent-prototype.md, "Week 1" D3. These pin the decisions the
topology exists to make, so a well-meaning edit cannot quietly undo one:

- the shim is its own service and holds the docker socket -- that is what lets it
  kill the worker on a step-ceiling overrun without dying with it;
- the worker restarts unless stopped -- a kill needs a fresh worker to redeliver to;
- READ_TIMEOUT_S is the 1800 s step ceiling by default -- an `up` environment may still
  set it, read here off the interpolation's default -- and only the
  ceiling override lowers it;
- elasticmq's visibility timeout sits above every ceiling the shim can run at -- the
  compose default and the one proto-demo-auto exports -- and there is NO redrive
  policy -- ChangeMessageVisibility never resets the receive count, so any
  maxReceiveCount would dead-letter a legitimately long turn;
- U5's interim sqsd values (proto/eb-worker/README.md): the Beanstalk template
  under eb-worker/ tells the worker the same numbers it gives sqsd, the sqsd overlay
  mirrors them, and the base profile keeps unlimited retries with the sweep off;
- the schema creates every table the plan names and not committed_batches
  (cut 2026-09-10);
- the D16 tool server runs read-only with /tmp its only tmpfs (no /projects: project
  state is in Postgres/S3, bound per request from X-Genealogy-Project-Id), publishes on
  loopback only, waits on postgres and minio being healthy, reads the Postgres the worker
  reads under the worker's anchor, and is waited on by proto-up but never by
  proto-up-core (the D3 smoke must not gate on the engine image).

No Docker needed: the compose files parse as YAML; the HOCON conf and the SQL are
read as text with their comments stripped first, so a comment that *mentions*
deadLettersQueue or committed_batches is not an offence.
"""

from __future__ import annotations

import ast
import contextlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

from proto.web import app

ROOT = Path(__file__).resolve().parents[3]
PROTO = Path(__file__).resolve().parents[1] / "proto"
REPO = Path(__file__).resolve().parents[3]
COMPOSE = PROTO / "docker-compose.yml"
CEILING_OVERRIDE = PROTO / "docker-compose.ceiling.yml"
SQSD_OVERLAY = PROTO / "docker-compose.sqsd.yml"
EB_WORKER = PROTO / "eb-worker"
SQSD_TEMPLATE = EB_WORKER / ".ebextensions" / "01-sqsd.config"
EB_NGINX = EB_WORKER / ".platform" / "nginx" / "conf.d" / "01-worker-timeouts.conf"
WORKER_PY = PROTO / "worker" / "worker.py"
SMOKE_PY = PROTO / "smoke.py"
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
    # 008 (U2): patron sign-in.
    "users",
    "allowed_emails",
    "familysearch_tokens",
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
    """The tools write research.json into Postgres and the worker's Stop hook reads it back
    on its own connection, and the worker tells the model its cwd is the projectPath the
    tools anchor on. A different database or anchor would leave the worker reading a
    project nobody writes, or every project tool refusing the path."""
    compose = _load(COMPOSE)
    tools = {k: v for k, v in _env(_service(compose, "tools")).items() if k.startswith("GENEALOGY_")}
    worker = _env(_service(compose, "worker"))
    assert tools["GENEALOGY_PG_DSN"] == worker["PG_DSN"], "the tools' Postgres is the worker's"
    assert tools["GENEALOGY_ANCHOR_PATH"] == worker["WORKER_CWD"], "the tools' anchor is the worker's cwd"
    assert set(tools) == {
        "GENEALOGY_PG_DSN", "GENEALOGY_S3_ENDPOINT", "GENEALOGY_S3_BUCKET",
        "GENEALOGY_S3_ACCESS_KEY", "GENEALOGY_S3_SECRET_KEY", "GENEALOGY_ANCHOR_PATH",
    }, "the five store variables plus the anchor, and no GENEALOGY_PROJECT_ID: the id is per request"


def _wait_services(line: str) -> list[str]:
    """The service names after `--wait` on one logical recipe line, a trailing comment stripped."""
    return line.split("#", 1)[0].split("--wait", 1)[1].split()


# ── step ceiling ────────────────────────────────────────────────────────────────


# A compose interpolation: `${VAR:-default}` / `${VAR-default}` -> (VAR, default); a literal
# -> (None, literal). The shim's ceiling is read off the default, not the literal.
_INTERPOLATION = re.compile(r"^\$\{(\w+):?-([^}]*)\}$")


def _compose_default(value: str) -> tuple[str | None, str]:
    match = _INTERPOLATION.match(value.strip())
    return (match.group(1), match.group(2)) if match else (None, value.strip())


def test_tools_carries_the_per_user_config_the_engine_reads():
    """The shared service is where image_transcribe's key has to be: the two headers it
    reads carry no config. The engine's PER_USER_ENV names the keys http.js reads from its
    environment, and a key there that compose does not pass makes that tool fail on the
    prototype only, so the service's environment is held to the engine's list rather than
    spelled out a second time. Passed through, never a literal."""
    engine = re.search(r"export const PER_USER_ENV = \[([^\]]*)\]",
                       (ROOT / "packages/engine/mcp-server/src/hosted-config-env.ts").read_text(encoding="utf-8"))
    assert engine, "hosted-config-env.ts no longer exports PER_USER_ENV as a literal list"
    names = re.findall(r'"(\w+)"', engine.group(1))
    assert names, "PER_USER_ENV names no keys"
    env = _env(_service(_load(COMPOSE), "tools"))
    for name in names:
        assert name in env, f"the tools service does not pass {name}"
        var, default = _compose_default(env[name])
        assert var == name and default == "", f"{name} must pass the caller's value through, empty when unset"


def test_only_the_recipes_that_wait_for_tools_can_run_a_real_turn():
    """A worker reaches `tools` over the compose network, so every
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
            f"{target} runs a real turn: it must wait for `tools` or delegate to one that does"
    # The exception, with its reason: the D3 smoke's stub arms never build worker options.
    assert not any(re.search(r"\btools\b", line) for line in _recipe("proto-up-core"))


def test_shim_read_timeout_is_the_step_ceiling():
    """The compose default is the pinned 1800 s, and the variable an `up` environment
    overrides it through is the one proto-demo-auto exports -- so a renamed interpolation
    would leave an override silently ignored."""
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


# proto-demo-auto's `export READ_TIMEOUT_S="${READ_TIMEOUT_S:-1800}"` in raw make text ($$
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
    exports. Both are 1800 s since PR #2870 item 0b, but this still takes the LARGER
    of the two, so raising either one again without raising the literal reds this test."""
    match = _DURATION.search(_turns_block())
    assert match, "turns needs a defaultVisibilityTimeout with a seconds/minutes unit"
    seconds = int(match.group(1)) * _UNIT_S[match.group(2)]
    ceiling = max(STEP_CEILING_S, _exported_ceiling_s())
    assert seconds > ceiling, f"visibility timeout {seconds}s must exceed the largest step ceiling, {ceiling}s"
    # ...and not wastefully above it. `> ceiling` alone is satisfied by the stale 7500 s
    # this was before 0b, which is why reverting the change to 2100 broke no test. The
    # cost of an over-large value is real and asymmetric: a POST abandoned by a shim
    # killed mid-flight is invisible for the whole timeout, so at 7500 s a lost message
    # reappears two hours later instead of in 35 minutes.
    assert seconds <= 2 * ceiling, (
        f"visibility timeout {seconds}s is more than twice the {ceiling}s ceiling: an "
        f"abandoned POST stays invisible for all of it. 0b sets this to 2100."
    )


# ── 1a: the nudge cap the web tier stamps ────────────────────────────────────────

RUNLOGS_E2E = REPO / "eval" / "runlogs" / "e2e"
_STEP_TOOLS = {"Skill", "Task", "Agent"}


def _steps_per_run() -> list[int]:
    """Skill/Task/Agent calls per committed e2e run -- the STEP count the nudge cap is
    sized on. A run that yields at every step boundary needs one nudge per step, which is
    the worst case the cap has to clear; the nudge HISTOGRAM cannot answer this because
    every committed run was produced under a harness that forbids yielding."""
    steps = []
    for path in sorted(RUNLOGS_E2E.glob("*/run-*.json")):
        if path.name.endswith((".ann.json", ".final-research.json", ".final-tree.gedcomx.json")):
            continue
        try:
            calls = json.loads(path.read_text(encoding="utf-8")).get("tool_calls") or []
        except (ValueError, OSError):
            continue
        if isinstance(calls, list):
            steps.append(sum(1 for c in calls
                             if isinstance(c, dict) and (c.get("tool") or c.get("name")) in _STEP_TOOLS))
    return sorted(steps)


def test_the_web_tiers_nudge_cap_clears_the_corpus_p99_step_count():
    """The number is DERIVED, not remembered. Measured 2026-09-23 over 189 runs: median
    15, p90 25, p99 51, max 76 -- so the shipped 60 clears p99. Re-deriving it here means
    a corpus that grows past the cap reds this instead of silently truncating runs.

    The plan's floor is 30, and the max (76) is deliberately NOT the target: the cap is
    not the spend control (1e's per-session bound is), and sizing to the longest run in
    the corpus would mean the cap never fires at all."""
    steps = _steps_per_run()
    assert len(steps) >= 100, f"only {len(steps)} runs readable; the derivation needs the corpus"
    p99 = steps[int(0.99 * (len(steps) - 1))]
    default = _compose_default(_env(_service(_load(COMPOSE), "web"))["AUTONOMOUS_MAX_NUDGES"])[1]
    assert int(default) >= p99, \
        f"the web tier's cap {default} is below the corpus p99 step count {p99}: runs would be truncated"
    assert int(default) >= 30, "the plan's floor"
    assert int(default) == app.DEFAULT_MAX_NUDGES, \
        "compose and the tier's own fallback must agree, or an unset variable changes behaviour"


def test_the_cap_is_not_read_off_the_request():
    """This tier has no auth. A field on MessageBody would let any client set its own
    nudge budget, which is the one thing bounding how long an unattended run works for."""
    assert "max_nudges" not in app.MessageBody.model_fields, "the cap must not be a request field"
    assert app.MessageBody(text="hi", max_nudges=999).model_dump() == {"text": "hi"}, \
        "an extra field on the request is dropped, never carried through to the queue body"


@pytest.mark.parametrize("env, expected", [
    ({}, app.DEFAULT_MAX_NUDGES),
    ({"AUTONOMOUS_MAX_NUDGES": ""}, app.DEFAULT_MAX_NUDGES),
    ({"AUTONOMOUS_MAX_NUDGES": "  "}, app.DEFAULT_MAX_NUDGES),
    ({"AUTONOMOUS_MAX_NUDGES": "nonsense"}, app.DEFAULT_MAX_NUDGES),
    ({"AUTONOMOUS_MAX_NUDGES": "0"}, 0),
    ({"AUTONOMOUS_MAX_NUDGES": "40"}, 40),
    ({"AUTONOMOUS_MAX_NUDGES": " 7 "}, 7),
    ({"AUTONOMOUS_MAX_NUDGES": "-3"}, 0),
])
def test_max_nudges_reads_the_environment_and_never_silently_disables_itself(env, expected):
    """Unset, blank and malformed all take the DEFAULT rather than 0. Guessing 0 here
    would ship the stop-every-step behaviour the plan exists to remove, and it would look
    exactly like the feature not working. An explicit 0 is honoured -- proto-demo needs it."""
    assert app.max_nudges(env) == expected


def test_elasticmq_has_no_redrive_policy():
    assert "deadLettersQueue" not in _hocon(), "no redrive policy: any maxReceiveCount dead-letters a long turn"


# ── U5: interim sqsd values ─────────────────────────────────────────────────────

BEANSTALK_MAX_INACTIVITY_S = 36000  # the sqsd options table: InactivityTimeout "1 to 36000"
SQS_MAX_VISIBILITY_S = 43200
# Beanstalk's worker stop grace is unmeasured (U13); systemd's default stop timeout is
# the bound the template is sized against until then.
BEANSTALK_STOP_GRACE_S = 90
STOP_GRACE_MARGIN_S = 2  # worker stop_grace_period above SHUTDOWN_GRACE_S + RELEASE_BUDGET_S (main()'s join slack)
CONTAINER_RESTART_S = 10  # a `docker restart` bringing proto-worker back up
_SQSD_ENV_OPTIONS = {
    "SQSD_MAX_RETRIES": "MaxRetries",
    "SQSD_VISIBILITY_TIMEOUT_S": "VisibilityTimeout",
    "SQSD_RETENTION_PERIOD_S": "RetentionPeriod",
}


def _sqsd_template() -> tuple[dict[str, int | str], dict[str, str]]:
    """The template's sqsd options (numbers as ints) and its application environment."""
    settings = _load(SQSD_TEMPLATE)["option_settings"]
    sqsd = {k: (int(v) if str(v).isdigit() else str(v))
            for k, v in settings["aws:elasticbeanstalk:sqsd"].items()}
    env = {str(k): str(v) for k, v in settings["aws:elasticbeanstalk:application:environment"].items()}
    return sqsd, env


def _worker_path() -> str:
    match = re.search(r'self\.path != "([^"]+)"', WORKER_PY.read_text(encoding="utf-8"))
    assert match, "worker.py no longer 404s on a literal path; re-derive the POST path here"
    return match.group(1)


def _worker_shutdown_grace_s() -> float:
    match = re.search(r"""["']SHUTDOWN_GRACE_S["']\s*,\s*["']?(\d+(?:\.\d+)?)""",
                      WORKER_PY.read_text(encoding="utf-8"))
    assert match, "worker.py does not read SHUTDOWN_GRACE_S with a literal default"
    return float(match.group(1))


def _worker_release_budget_s() -> float:
    match = re.search(r"^RELEASE_BUDGET_S = (\d+(?:\.\d+)?)$", WORKER_PY.read_text(encoding="utf-8"), re.M)
    assert match, "worker.py no longer defines RELEASE_BUDGET_S as a literal"
    return float(match.group(1))


def _compose_seconds(raw: object) -> float:
    raw = str(raw or "")
    parts = _COMPOSE_DURATION.findall(raw)
    assert parts and _COMPOSE_DURATION.sub("", raw) == "", f"not a compose duration: {raw!r}"
    return sum(int(n) * _COMPOSE_UNIT_S[u] for n, u in parts)


def _worker_stop_grace_s() -> float:
    return _compose_seconds(_service(_load(COMPOSE), "worker").get("stop_grace_period"))


def _overlay_defaults(service: str) -> dict[str, str]:
    return {k: _compose_default(v)[1] for k, v in _env(_service(_load(SQSD_OVERLAY), service)).items()}


def test_sqsd_template_holds_the_interim_values():
    sqsd, _ = _sqsd_template()
    assert sqsd["InactivityTimeout"] == BEANSTALK_MAX_INACTIVITY_S, "sqsd cuts only a run past 10 h"
    assert BEANSTALK_MAX_INACTIVITY_S < sqsd["VisibilityTimeout"] <= SQS_MAX_VISIBILITY_S
    assert sqsd["MaxRetries"] == 5
    assert sqsd["ErrorVisibilityTimeout"] == 300
    assert sqsd["HttpPath"] == _worker_path(), "the worker 404s every other path"
    assert sqsd["HttpConnections"] == 2
    assert sqsd["RetentionPeriod"] == 345600


def test_sqsd_template_env_matches_its_sqsd_options():
    """The worker's last-receive close and sweep read these; a value that drifts from sqsd's
    closes a receive early or disables the fast close."""
    sqsd, env = _sqsd_template()
    for var, option in _SQSD_ENV_OPTIONS.items():
        assert var in env, f"the template does not tell the worker {var}"
        assert int(env[var]) == sqsd[option], f"{var}={env[var]} but sqsd {option}={sqsd[option]}"
    assert int(env["SWEEP_INTERVAL_S"]) > 0, "Beanstalk runs the dead-letter sweep"


def test_worker_nginx_read_timeout_exceeds_inactivity():
    """At equal values nginx's 504 would redeliver a running message."""
    text = _strip_line_comments(EB_NGINX.read_text(encoding="utf-8"), ("#",))
    match = re.search(r"proxy_read_timeout\s+(\d+)s?\s*;", text)
    assert match, "the worker template must raise nginx's proxy_read_timeout"
    sqsd, _ = _sqsd_template()
    assert int(match.group(1)) > sqsd["InactivityTimeout"]


def test_error_visibility_exceeds_the_worker_stop_grace():
    """A redelivery after a SIGTERM's 500 must never meet the old process's CLI."""
    sqsd, _ = _sqsd_template()
    assert sqsd["ErrorVisibilityTimeout"] > BEANSTALK_STOP_GRACE_S
    assert int(_overlay_defaults("shim")["ERROR_VISIBILITY_S"]) > _worker_stop_grace_s()


def test_worker_stop_grace_covers_shutdown_grace():
    """Compose SIGKILLs at stop_grace_period; the worker's own shutdown must finish first."""
    needed = _worker_shutdown_grace_s() + _worker_release_budget_s() + STOP_GRACE_MARGIN_S
    assert _worker_stop_grace_s() >= needed


def test_no_compose_file_overrides_the_worker_shutdown_grace():
    """The grace tests read worker.py's literal default; a compose override would make that
    default not the value the container runs with, and they would pass regardless."""
    files = sorted(PROTO.glob("docker-compose*.yml"))
    assert COMPOSE in files and SQSD_OVERLAY in files
    for path in files:
        worker = (_load(path).get("services") or {}).get("worker")
        if worker is not None:
            assert "SHUTDOWN_GRACE_S" not in _env(worker), f"{path.name} sets the worker's SHUTDOWN_GRACE_S"


def test_sqsd_overlay_touches_only_sqsd_variables():
    overlay = _load(SQSD_OVERLAY)
    assert set(overlay["services"]) == {"worker", "shim"}
    for name, service in overlay["services"].items():
        assert set(service) == {"environment"}, f"the overlay sets {name}'s environment only"
    assert set(_env(overlay["services"]["worker"])) == {*_SQSD_ENV_OPTIONS, "SWEEP_INTERVAL_S", "QUEUE_URL"}
    assert set(_env(overlay["services"]["shim"])) == {
        "KILL_ON_READ_TIMEOUT", "READ_TIMEOUT_S", "VISIBILITY_TIMEOUT_S",
        "ERROR_VISIBILITY_S", "SQSD_MAX_RETRIES", "DLQ_URL",
    }
    sqsd, _ = _sqsd_template()
    worker, shim = _overlay_defaults("worker"), _overlay_defaults("shim")
    for var, option in _SQSD_ENV_OPTIONS.items():
        assert int(worker[var]) == sqsd[option], f"the overlay's {var} default is not the template's"
    assert int(shim["SQSD_MAX_RETRIES"]) == sqsd["MaxRetries"]
    assert int(shim["VISIBILITY_TIMEOUT_S"]) == sqsd["VisibilityTimeout"]
    assert int(shim["ERROR_VISIBILITY_S"]) == sqsd["ErrorVisibilityTimeout"]
    assert int(shim["READ_TIMEOUT_S"]) == sqsd["InactivityTimeout"]
    assert shim["KILL_ON_READ_TIMEOUT"] == "false", "sqsd abandons at InactivityTimeout, it never kills"
    assert shim["DLQ_URL"].rsplit("/", 1)[-1] == "turns-dlq"
    var, default = _compose_default(_env(overlay["services"]["worker"])["QUEUE_URL"])
    assert var == "WORKER_QUEUE_URL", "smoke.py empties the worker's queue through WORKER_QUEUE_URL"
    assert default == _env(_service(_load(COMPOSE), "worker"))["QUEUE_URL"]


def test_base_profile_keeps_unlimited_retries():
    compose = _load(COMPOSE)
    for name in ("worker", "shim"):
        var, default = _compose_default(_env(_service(compose, name))["SQSD_MAX_RETRIES"])
        assert var == "SQSD_MAX_RETRIES" and int(default) == 0, f"{name}: base retries are unlimited"


def test_base_profile_disables_the_sweep():
    """Base compose runs on the persistent proto-pgdata volume: a sweep there would close
    old smoke leftovers and release their held messages into paid turns."""
    for name, service in _load(COMPOSE)["services"].items():
        env = _env(service)
        assert "SQSD_RETENTION_PERIOD_S" not in env, f"{name}: the sweep's backstop must stay off"
        if "SQSD_MAX_RETRIES" in env:
            assert int(_compose_default(env["SQSD_MAX_RETRIES"])[1]) == 0, f"{name}: the fast path must stay off"
        if "SWEEP_INTERVAL_S" in env:
            assert int(_compose_default(env["SWEEP_INTERVAL_S"])[1]) == 0, f"{name}: the sweep must stay off"


def test_smoke_error_visibility_exceeds_shutdown_grace():
    """The smoke's `sigterm` case restarts the worker mid-turn; its redelivery must arrive
    after the old process is gone, whether it exited on its own or was SIGKILLed."""
    match = re.search(r"^SIGTERM_ERROR_VISIBILITY_S\s*=\s*(\d+)", SMOKE_PY.read_text(encoding="utf-8"), re.M)
    assert match, "smoke.py must define SIGTERM_ERROR_VISIBILITY_S"
    gone_by = max(_worker_shutdown_grace_s(), _worker_stop_grace_s()) + CONTAINER_RESTART_S
    assert int(match.group(1)) > gone_by


def _smoke_cfg(smoke):
    cfg = smoke.Config()
    cfg.pg_dsn, cfg.endpoint, cfg.queue, cfg.worker_container = "dsn", "http://sqs", "turns", "proto-worker"
    return cfg


@pytest.mark.parametrize("fail_at", ["overlay_up", "purge"])
def test_smoke_sqsd_profile_always_restores_the_base_profile(monkeypatch, fail_at):
    """An overlay `up` that fails after recreating the containers, or a purge that fails,
    must not leave SQSD_MAX_RETRIES=1 and the sweep live for every later turn."""
    from proto import smoke

    ups: list[tuple] = []

    def compose(*args, files=(smoke.COMPOSE,), env=None):
        ups.append(tuple(files))
        if fail_at == "overlay_up" and smoke.SQSD in files:
            raise smoke.subprocess.CalledProcessError(1, "compose up --wait")
        return ""

    def purge_queue(*, endpoint, queue):
        if fail_at == "purge":
            raise smoke.SqsError(f"purge {queue}")

    monkeypatch.setattr(smoke, "compose", compose)
    monkeypatch.setattr(smoke, "purge_queue", purge_queue)
    with contextlib.suppress(smoke.subprocess.CalledProcessError):
        with smoke.sqsd_profile(_smoke_cfg(smoke)):
            pass
    assert ups[-1] == (smoke.COMPOSE,), f"the base profile was not restored: {ups}"


def test_smoke_preflight_names_the_missing_dlq(monkeypatch):
    from proto import smoke

    def queue_url(endpoint, queue):
        if queue == smoke.DLQ:
            raise smoke.SqsError(f"no queue {queue}")
        return f"{endpoint}/{queue}"

    monkeypatch.setattr(smoke, "inspect_worker", lambda cfg: (0, "t"))
    monkeypatch.setattr(smoke, "db_one", lambda cfg, sql, params: (1,))
    monkeypatch.setattr(smoke, "queue_url", queue_url)
    problem = smoke.preflight(_smoke_cfg(smoke))
    assert problem and "--force-recreate elasticmq" in problem and smoke.DLQ in problem
    monkeypatch.setattr(smoke, "queue_url", lambda endpoint, queue: f"{endpoint}/{queue}")
    assert smoke.preflight(_smoke_cfg(smoke)) is None


def test_sqsd_overlay_disables_the_sweep_by_default():
    """The overlay's sweep acts on the whole database; only a run that asks turns it on."""
    var, default = _compose_default(_env(_service(_load(SQSD_OVERLAY), "worker"))["SWEEP_INTERVAL_S"])
    assert var == "SWEEP_INTERVAL_S" and int(default) == 0


def test_elasticmq_has_a_plain_dlq():
    text = _hocon()
    assert re.search(r"\bturns-dlq\s*\{", text), "the shim's DLQ_URL needs a turns-dlq queue"


# ── schema ──────────────────────────────────────────────────────────────────────


def test_schema_creates_every_planned_table():
    missing = EXPECTED_TABLES - _created_tables()
    assert not missing, f"sql/*.sql is missing CREATE TABLE for: {sorted(missing)}"


def test_schema_has_no_committed_batches():
    assert "committed_batches" not in _created_tables()


def _statements(path: Path) -> list[str]:
    """Comment-stripped, whitespace-normalised statements, so a statement reflowed across
    lines is still the same statement and a comment that says NOT NULL is not one."""
    body = _strip_line_comments(path.read_text(encoding="utf-8"), ("--",))
    return [re.sub(r"\s+", " ", s).strip() for s in body.split(";") if s.strip()]


def test_008_is_idempotent_and_owner_is_nullable():
    """An unledgered database re-runs every sql/*.sql once (migrate.py's baseline, U9), so
    008 must be a no-op the second time. And projects.owner_id must stay NULLABLE: the engine creates projects
    with the id alone (PgS3ProjectStore.touchProject), so NOT NULL fails every engine
    write, and nothing but a real engine write on the compose stack would show it."""
    statements = _statements(SQL_DIR / "008_auth_owner.sql")
    assert statements, "008_auth_owner.sql has no statements"
    for stmt in statements:
        assert re.match(r"(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS) ",
                        stmt, re.I), f"not idempotent: {stmt}"
    [owner] = [s for s in statements if re.search(r"ADD COLUMN IF NOT EXISTS owner_id\b", s, re.I)]
    assert owner.upper().startswith("ALTER TABLE PROJECTS "), owner
    assert "NOT NULL" not in owner.upper(), f"projects.owner_id must be nullable: {owner}"
    [tokens] = [s for s in statements if re.search(r"CREATE TABLE IF NOT EXISTS familysearch_tokens\b", s, re.I)]
    assert re.search(r"\buser_id text PRIMARY KEY\b", tokens), "one grant row per patron: U3 locks it"
    assert re.search(r"\bgranted_at timestamptz NOT NULL\b", tokens), "the sign-in time"


# U9: a shipped file runs once and is never edited, so a later file may only add. Read off the
# comment-stripped statements, dollar-quoted bodies included (an EXECUTE string is still DDL).
_CONTRACTING = (
    ("DROP", re.compile(r"\bDROP\b", re.I)),
    ("RENAME", re.compile(r"\bRENAME\b", re.I)),
    ("SET NOT NULL", re.compile(r"\bSET\s+NOT\s+NULL\b", re.I)),
    ("ALTER COLUMN ... TYPE", re.compile(r"\bALTER\s+(?:COLUMN\s+)?\"?\w+\"?\s+(?:SET\s+DATA\s+)?TYPE\b", re.I)),
)


def _contracting(statements: list[str]) -> list[tuple[str, str]]:
    return [(label, stmt) for stmt in statements for label, rx in _CONTRACTING if rx.search(stmt)]


def test_migrations_are_expand_only():
    """migrate.py runs each file once, before the new code ships, while the old code is still
    serving: a file that drops, renames, sets NOT NULL or retypes a column breaks the build
    still running. Those four shapes only; other tightenings (a new NOT NULL column with no
    default, a constraint) are the author's to see. Contraction needs its own design (two
    deploys), not a 010."""
    files = sorted(SQL_DIR.glob("*.sql"))
    assert len(files) >= 9, files
    offences = [(f.name, label, stmt) for f in files for label, stmt in _contracting(_statements(f))]
    assert not offences, f"not expand-only: {offences}"


@pytest.mark.parametrize("text, expected", [
    ("ALTER TABLE turns DROP COLUMN nudges;", ["DROP"]),
    ("DROP INDEX IF EXISTS turns_open_project_idx;", ["DROP"]),
    ("ALTER TABLE turns RENAME TO turn;", ["RENAME"]),
    ("ALTER TABLE turns RENAME COLUMN nudges TO n;", ["RENAME"]),
    ("ALTER TABLE projects ALTER COLUMN owner_id SET NOT NULL;", ["SET NOT NULL"]),
    ("ALTER TABLE turns ALTER COLUMN nudges TYPE bigint;", ["ALTER COLUMN ... TYPE"]),
    ("ALTER TABLE turns ALTER nudges SET DATA TYPE bigint;", ["ALTER COLUMN ... TYPE"]),
    ("DO $$ BEGIN\n  EXECUTE 'ALTER TABLE x DROP COLUMN y';\nEND $$;", ["DROP"]),
    ("-- DROP the old shape, RENAME it, SET NOT NULL\nALTER TABLE turns ADD COLUMN IF NOT EXISTS u9 int;", []),
    ("ALTER TABLE turns ADD COLUMN IF NOT EXISTS dropped_at timestamptz NOT NULL DEFAULT now();", []),
    ("CREATE TYPE mood AS ENUM ('a'); ALTER TYPE mood ADD VALUE IF NOT EXISTS 'b';", []),
])
def test_the_expand_only_reader_sees_each_shape(tmp_path, text, expected):
    sql = tmp_path / "010_x.sql"
    sql.write_text(text, encoding="utf-8")
    assert [label for label, _ in _contracting(_statements(sql))] == expected


def _depends_on(service: dict) -> dict[str, dict]:
    """Compose accepts `depends_on` as a list (each `service_started`) or a mapping."""
    raw = service.get("depends_on") or {}
    if isinstance(raw, list):
        return {str(name): {"condition": "service_started"} for name in raw}
    return {str(k): dict(v or {}) for k, v in raw.items()}


def test_migrate_is_the_only_schema_applier():
    """U9: the `migrate` one-shot is the stack's one schema applier and nothing that runs DDL
    at start remains. Postgres's initdb would be a second applier with no ledger, and a tier
    that started before the one-shot exited would report `schema: unmigrated` until it did.
    MIGRATE_PG_DSN is the owner's DSN: on any other service it is a DDL credential nothing
    there needs."""
    files = sorted(PROTO.glob("docker-compose*.yml"))
    assert COMPOSE in files and SQSD_OVERLAY in files, files
    for path in files:
        for name, service in (_load(path).get("services") or {}).items():
            initdb = [v for v in _volumes(service) if ":/docker-entrypoint-initdb.d" in v]
            assert not initdb, f"{path.name}: {name} mounts {initdb}; migrate.py is the one applier"
            if name != "migrate" or path != COMPOSE:
                assert "MIGRATE_PG_DSN" not in _env(service), f"{path.name}: {name} carries MIGRATE_PG_DSN"
    compose = _load(COMPOSE)
    migrate, worker = _service(compose, "migrate"), _service(compose, "worker")
    assert migrate.get("restart") == "no", "a one-shot: a restart would re-run it on every exit"
    assert migrate.get("command") == ["python3", "proto/migrate.py"], migrate.get("command")
    assert migrate.get("build") == worker.get("build") and migrate.get("build"), \
        "migrate builds the worker's image (migrate.py, sql/ and psycopg at WORKDIR /opt/genealogy/server)"
    assert "image" not in migrate and "image" not in worker, \
        "an `image:` on migrate alone is pulled by an `up` naming tools; one shared by both fails the parallel build"
    assert _env(migrate).get("MIGRATE_PG_DSN", "").startswith("postgresql://"), _env(migrate)
    assert _depends_on(migrate).get("postgres", {}).get("condition") == "service_healthy"
    for name in ("worker", "web", "tools"):
        condition = _depends_on(_service(compose, name)).get("migrate", {}).get("condition")
        assert condition == "service_completed_successfully", f"{name} must wait for the migration, not {condition}"


REQUIREMENTS = {"web": PROTO / "web" / "requirements.txt", "worker": PROTO / "worker" / "requirements.txt"}
REGENERATE = "run `make proto-requirements` and commit apps/server/proto/{web,worker}/requirements.txt"


def _locked_version(package: str) -> str:
    lock = (PROTO.parent / "uv.lock").read_text(encoding="utf-8")
    m = re.search(rf'^\[\[package\]\]\nname = "{re.escape(package)}"\nversion = "([^"]+)"', lock, re.M)
    assert m, f"{package} is not in apps/server/uv.lock"
    return m.group(1)


def _requirements(text: str) -> tuple[dict[str, tuple[str, str, frozenset[str]]], list[str]]:
    """A hash-mode requirements file by meaning: ``{name: (version, marker, hashes)}``
    plus any option lines. Continuations are joined and comments dropped, so uv's header
    and ``# via`` annotations, quoting and wrapping never count."""
    reqs: dict[str, tuple[str, str, frozenset[str]]] = {}
    options: list[str] = []
    for line in text.replace("\\\n", " ").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-"):
            options.append(line)
            continue
        spec, *hashes = line.split("--hash=")
        m = re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?==(\S+)\s*(?:;\s*(.+?))?\s*", spec)
        assert m, f"not an exact pin: {spec!r}"
        name = re.sub(r"[-_.]+", "-", m.group(1)).lower()
        marker = " ".join((m.group(4) or "").replace('"', "'").split())
        assert name not in reqs, f"{name} is listed twice"
        reqs[name] = (m.group(3), marker, frozenset(h.strip() for h in hashes))
    return reqs, options


def _uv_export(group: str) -> str:
    uv = os.environ.get("UV") or shutil.which("uv")
    if not uv:
        pytest.fail("uv is not on PATH: the requirements drift check needs it, and a skip would hide drift")
    proc = subprocess.run(
        [uv, "export", "--locked", "--only-group", f"proto-{group}", "--no-emit-project",
         "--format", "requirements-txt", "--no-header"],
        cwd=PROTO.parent, capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, f"uv export --locked failed (is uv.lock current? run `uv lock`, then {REGENERATE}):\n{proc.stderr}"
    return proc.stdout


def _dockerfile_logical_lines(dockerfile: Path) -> list[str]:
    text = dockerfile.read_text(encoding="utf-8")
    body = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    return [" ".join(line.split()) for line in body.replace("\\\n", " ").splitlines() if line.strip()]


@pytest.mark.parametrize("tier", sorted(REQUIREMENTS))
def test_proto_images_install_their_requirements_in_hash_mode(tier):
    """U12: each image installs the committed export of its uv group, every pip line in
    hash mode, so the image runs uv.lock's closure (the versions the suite tested) and a
    wheel that does not match the lock's hash fails the build."""
    dockerfile = PROTO / tier / "Dockerfile"
    lines = _dockerfile_logical_lines(dockerfile)
    source = f"apps/server/proto/{tier}/requirements.txt"
    dests = [line.split()[-1] for line in lines if re.match(rf"COPY (--\S+ )*{re.escape(source)} ", line)]
    assert len(dests) == 1, f"{dockerfile.relative_to(PROTO)} must COPY {source} exactly once"
    [dest] = dests
    if dest.endswith("/"):
        dest += "requirements.txt"
    accepted = {dest, dest.removeprefix("./")}
    pips = [line for line in lines if re.match(r"RUN\b.*\bpip3? install\b", line)]
    assert pips, f"{dockerfile.relative_to(PROTO)} has no pip install"
    for pip in pips:
        # Every command in the RUN: a second pip chained after the first decides hash mode
        # on its own.
        for seg in re.split(r"\s*(?:&&|\|\||;|\|)\s*", pip):
            if not re.search(r"\bpip3? install\b", seg):
                continue
            words = seg.split(" install ", 1)[1].split()
            assert "--require-hashes" in words, f"not in hash mode: {pip}"
            targets = [b for a, b in zip(words, words[1:]) if a in ("-r", "--requirement")]
            targets += [w.split("=", 1)[1] for w in words if w.startswith("--requirement=")]
            assert targets and set(targets) <= accepted, f"pip must install only {source} (copied to {dest}): {pip}"


@pytest.mark.parametrize("tier", sorted(REQUIREMENTS))
def test_committed_requirements_are_the_uv_export(tier):
    """The committed file is `uv export` of the tier's group, compared by meaning: the same
    (name, version, marker) set and the same hashes. A Dependabot bump to uv.lock that moves
    a package in either closure fails here until the files are regenerated."""
    committed, options = _requirements(REQUIREMENTS[tier].read_text(encoding="utf-8"))
    fresh, _ = _requirements(_uv_export(tier))
    assert not options, f"{REQUIREMENTS[tier].relative_to(PROTO)} carries options {options}; {REGENERATE}"
    stale = {n: (committed.get(n), fresh.get(n)) for n in committed.keys() | fresh.keys() if committed.get(n) != fresh.get(n)}
    assert not stale, (
        f"proto/{tier}/requirements.txt differs from uv.lock's proto-{tier} group; {REGENERATE}. "
        f"(committed, uv.lock) per package: " + "; ".join(
            f"{n}: {(c or ('absent',))[:2]} vs {(f or ('absent',))[:2]}" + (" (hashes differ)" if c and f and c[:2] == f[:2] else "")
            for n, (c, f) in sorted(stale.items())
        )
    )
    for name, (_, _, hashes) in committed.items():
        assert hashes, f"{name} has no --hash; pip --require-hashes would refuse the file"


@pytest.mark.parametrize(
    ("tier", "package", "pinned"),
    [
        ("web", "itsdangerous", None),
        ("web", "cryptography", None),
        ("web", "httpx", None),
        ("web", "botocore", None),
        ("web", "fastapi", None),
        ("web", "uvicorn", None),
        ("web", "psycopg-binary", None),
        ("worker", "claude-agent-sdk", "0.2.128"),
        ("worker", "psycopg-binary", None),
        ("worker", "botocore", None),
        # U3: grants.py decrypts what web/auth.py encrypts, at the one locked version.
        ("worker", "cryptography", None),
    ],
)
def test_requirements_carry_what_the_tiers_import_at_the_locked_version(tier, package, pinned):
    """web/auth.py and enqueue.py import these at module scope, and the worker's SDK pin is
    the flush-mode and CLI pin; the suite runs in a venv that has them all, so a missing one
    passes every other test and fails only when the tier starts. botocore at uv.lock's
    version is what the U7 signing vectors proved."""
    reqs, _ = _requirements(REQUIREMENTS[tier].read_text(encoding="utf-8"))
    assert package in reqs, f"proto/{tier}/requirements.txt does not carry {package}"
    version = reqs[package][0]
    assert version == _locked_version(package), f"proto/{tier} {package}=={version} vs uv.lock; {REGENERATE}"
    if pinned:
        assert version == pinned, f"proto/{tier} {package}=={version}, not the {pinned} pin"


def test_host_venv_sqs_recipes_use_static_dummies():
    """U7: the recipes that run enqueue.py from the host venv sign with a dummy static
    pair, so they never read the developer's ~/.aws or probe IMDS."""
    defined = [line for line in MAKEFILE.read_text(encoding="utf-8").splitlines()
               if line.startswith("PROTO_SQS_ENV")]
    assert defined and "GENEALOGY_SQS_ACCESS_KEY=" in defined[0] and "GENEALOGY_SQS_SECRET_KEY=" in defined[0]
    for target in ("proto-send", "proto-smoke", "proto-web"):
        assert any(re.search(r"\$\(PROTO_SQS_ENV\)\s+uv run\b", line) for line in _recipe(target)), target


# ── D18 grading recipes ─────────────────────────────────────────────────────────


def test_proto_grade_requires_a_session_and_runs_the_prototype_script():
    recipe = _recipe("proto-grade")
    assert any('test -n "$(SESSION)"' in line for line in recipe), "proto-grade must refuse without SESSION"
    assert any("exit 2" in line for line in recipe if "SESSION" in line)
    assert any("proto/grade.py" in line and "--session '$(SESSION)'" in line for line in recipe)
    assert any("--fixture '$(FIXTURE)'" in line for line in recipe), "FIXTURE is optional but must reach the script"


def test_proto_compare_requires_both_a_fixture_and_a_session():
    recipe = _recipe("proto-compare")
    guards = [line for line in recipe if "test -n" in line]
    assert any('test -n "$(FIXTURE)"' in line for line in guards), "proto-compare must refuse without FIXTURE"
    assert any('test -n "$(SESSION)"' in line for line in guards), "proto-compare must refuse without SESSION"
    assert all("exit 2" in line for line in guards)
    body = [line for line in recipe if "proto/compare.py" in line]
    assert body, "proto-compare must run proto/compare.py"
    assert "--fixture '$(FIXTURE)'" in body[0] and "--session '$(SESSION)'" in body[0]
    assert "--runlog '$(abspath $(RUNLOG))'" in body[0], "RUNLOG is a path: make it absolute, the script cd's away"


def test_the_grading_recipes_run_the_harness_module_in_the_harness_venv():
    """`apps/server` and `eval/harness` are separate environments. Both recipes enter
    apps/server; the harness module is reached only as a subprocess from eval/harness --
    grade.py's HARNESS_DIR + `uv run` -- never imported across the two."""
    for target in ("proto-grade", "proto-compare"):
        recipe = "\n".join(_recipe(target))
        assert "cd apps/server" in recipe, target
        assert "e2e.grade_files" not in recipe, f"{target} must not call the harness module directly"
    source = (PROTO / "grade.py").read_text(encoding="utf-8")
    assert 'HARNESS_DIR = ROOT / "eval" / "harness"' in source
    assert '"uv", "run", "python", "-m", "e2e.grade_files"' in source
    assert "cwd=HARNESS_DIR" in source


def test_proto_test_runs_every_test_proto_file():
    """The shared guard: every tests/test_proto_*.py is in make proto-test's list, or it runs
    nowhere a prototype change is checked (the real-Postgres one skips there without a DSN;
    proto-grants-test and CI run it for real)."""
    body = "\n".join(_recipe("proto-test"))
    files = sorted(p.name for p in (PROTO.parent / "tests").glob("test_proto_*.py"))
    assert files and "test_proto_grants_pg.py" in files
    missing = [name for name in files if not re.search(rf"\btests/{re.escape(name)}\b", body)]
    assert not missing, f"make proto-test does not run {missing}"


def test_no_recipe_mints_or_mounts_an_operator_token():
    """U3: the worker bears the patron's grant, so nothing mints, refreshes or mounts an
    operator token. `make proto-grant` stores the dev patron's grant instead."""
    text = MAKEFILE.read_text(encoding="utf-8")
    assert not re.search(r"^proto-token\s*:", text, re.M), "the operator-token recipe is gone"
    for target in ("proto-up", "proto-up-core", "proto-turn"):
        assert not any(".fs-token" in line or "fs-token.ts" in line for line in _recipe(target)), target
    grant = _recipe("proto-grant")
    assert any("proto/grant.py" in line and "--pg-dsn" in line for line in grant), grant
    assert (PROTO / "grant.py").is_file()
    assert not (REPO / "packages" / "engine" / "mcp-server" / "dev" / "fs-token.ts").exists()


# ── U3: grants ───────────────────────────────────────────────────────────────────


def test_009_is_idempotent_and_backfills_from_granted_at():
    """An unledgered database re-runs every sql/*.sql once (migrate.py's baseline, U9), so
    each statement must be a no-op the second time:
    an added column, an index, or a backfill guarded on the column still being NULL. The
    backfill is exact because before 009 only a sign-in wrote a row."""
    statements = _statements(SQL_DIR / "009_grant_session.sql")
    assert statements, "009_grant_session.sql has no statements"
    for stmt in statements:
        assert re.match(r"(ALTER TABLE familysearch_tokens ADD COLUMN IF NOT EXISTS \w+ \w+$"
                        r"|CREATE INDEX IF NOT EXISTS \w+ ON \w+ "
                        r"|UPDATE \w+ SET (\w+) = \w+ WHERE \2 IS NULL$)", stmt), f"not idempotent: {stmt}"
    added = {re.match(r"ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS (\w+)", s).group(1)
             for s in statements if s.startswith("ALTER")}
    assert added == {"session_started_at", "refresh_started_at", "refresh_refused_at", "refresh_refused_reason"}
    assert "UPDATE familysearch_tokens SET session_started_at = granted_at WHERE session_started_at IS NULL" in statements
    assert any("ON turns (project_id) WHERE completed_at IS NULL" in s for s in statements), \
        "the refresher's open-turn EXISTS needs its index"


def _proto_imports(source: str, *, packaged: bool) -> set[str]:
    """The proto/<name>.py modules a source imports. ``packaged`` (the worker's layout):
    ``from proto import X``, ``from proto.X import ...`` and ``import proto.X``; otherwise
    (the web image's flat /app): ``import X`` and ``from X import ...``."""
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                parts = alias.name.split(".")
                if packaged and parts[0] == "proto" and len(parts) > 1:
                    names.add(parts[1])
                elif not packaged:
                    names.add(parts[0])
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            parts = node.module.split(".")
            if packaged and parts[0] == "proto":
                names.update(parts[1:2] or [a.name for a in node.names])
            elif not packaged:
                names.add(parts[0])
    return {n for n in names if (PROTO / f"{n}.py").is_file()}


def _copied(dockerfile: Path) -> set[str]:
    """The repo paths a Dockerfile COPYs (continuation lines joined, flags skipped)."""
    text = dockerfile.read_text(encoding="utf-8").replace("\\\n", " ")
    sources: set[str] = set()
    for line in text.splitlines():
        parts = line.split("#", 1)[0].split()
        if parts and parts[0] == "COPY":
            args = [a for a in parts[1:] if not a.startswith("--")]
            sources.update(a.rstrip("/") for a in args[:-1])
    return sources


def _bundle_sources(tier: str) -> set[str]:
    """The repo paths the Beanstalk bundle builder ships for ``tier`` (scripts/eb_bundles)."""
    import importlib.util
    import sys

    scripts = REPO / "scripts" / "eb_bundles"
    sys.path.insert(0, str(scripts))  # build.py does `import layout`
    try:
        spec = importlib.util.spec_from_file_location("eb_bundles_build_for_proto_config", scripts / "build.py")
        build = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = build  # the dataclass decorator looks its module up
        spec.loader.exec_module(build)
    finally:
        sys.path.remove(str(scripts))
    return {rule.src for rule in build.RULES[tier]}


def test_images_and_bundles_carry_every_proto_module_they_import():
    """Both images and both Beanstalk bundles copy proto/ SELECTIVELY, so a module not
    shipped is simply not there -- and every test passes, because the suite has the whole
    tree on its path. The worker's held-message release swallowed exactly that ImportError
    once (enqueue.py), without grants.py neither tier can read a grant at all, and without
    migrate.py (U9) neither can read the ledger it reports `schema` from."""
    for image, packaged in (("web", False), ("worker", True)):
        needed: set[str] = set()
        for source in sorted((PROTO / image).glob("*.py")):
            needed |= _proto_imports(source.read_text(encoding="utf-8"), packaged=packaged)
        assert {"enqueue", "grants", "migrate"} <= needed, f"{image}: the guard no longer sees the imports ({needed})"
        for kind, shipped in (("image", _copied(PROTO / image / "Dockerfile")), ("bundle", _bundle_sources(image))):
            missing = sorted(n for n in needed if f"apps/server/proto/{n}.py" not in shipped)
            assert not missing, f"the {image} {kind} imports proto/{missing} but never ships it"


@pytest.mark.parametrize("source, packaged, expected", [
    ("import grants", False, {"grants"}),
    ("def f():\n    import enqueue\n", False, {"enqueue"}),
    ("from grants import Ready", False, {"grants"}),
    ("import os, json", False, set()),
    ("from proto import grants, enqueue", True, {"grants", "enqueue"}),
    ("from proto.grants import Ready", True, {"grants"}),
    ("import proto.grants as g", True, {"grants"}),
    ("from proto.worker.options import x", True, set()),
    ("import grants", True, set()),
])
def test_the_image_import_reader_sees_each_shape(source, packaged, expected):
    assert _proto_imports(source, packaged=packaged) == expected


def test_the_copy_reader_joins_a_reflowed_copy(tmp_path):
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text("FROM x\nCOPY --chown=1:1 \\\n    apps/server/proto/grants.py \\\n    /opt/x/\n"
                          "# COPY apps/server/proto/enqueue.py /opt/\n", encoding="utf-8")
    assert _copied(dockerfile) == {"apps/server/proto/grants.py"}


def _shim_kill_default() -> bool:
    m = re.search(r'^KILL_ON_READ_TIMEOUT = _env_bool\("KILL_ON_READ_TIMEOUT", (True|False)\)',
                  (PROTO / "shim" / "shim.py").read_text(encoding="utf-8"), re.M)
    assert m, "shim.py's KILL_ON_READ_TIMEOUT default moved"
    return m.group(1) == "True"


def _profiles() -> list[tuple[str, dict[str, str], dict[str, str], dict[str, str]]]:
    """(name, worker env, shim env, the overlay's own worker env) per compose profile."""
    base = _load(COMPOSE)
    out = [("base", _env(_service(base, "worker")), _env(_service(base, "shim")), {})]
    overlay = _load(SQSD_OVERLAY)["services"]
    over_worker = _env(overlay.get("worker") or {})
    out.append(("base+sqsd", {**out[0][1], **over_worker}, {**out[0][2], **_env(overlay.get("shim") or {})},
                over_worker))
    return out


def test_grant_start_age_leaves_an_attempt_of_session_life():
    """D4: where the shim KILLS an attempt at its read timeout, an attempt that starts at the
    maximum session age still ends 600 s before the session's guaranteed 8 h. Where it does
    not (docker-compose.sqsd.yml: sqsd abandons, never kills), nothing bounds an attempt
    until U26, so no start age is a guarantee there and the profile must not set one."""
    for name, worker_env, shim_env, own in _profiles():
        raw_kill = shim_env.get("KILL_ON_READ_TIMEOUT")
        kills = _shim_kill_default() if raw_kill is None else \
            _compose_default(raw_kill)[1].strip().lower() in {"1", "true", "yes", "on"}
        if kills:
            start_age = float(_compose_default(worker_env["FS_GRANT_MAX_START_AGE_S"])[1])
            read_timeout = float(_compose_default(shim_env["READ_TIMEOUT_S"])[1])
            assert start_age + read_timeout + 600 <= 8 * 3600, (
                f"{name}: an attempt starting at age {start_age} s can run {read_timeout} s, past the "
                "session's guaranteed 8 h")
        else:
            assert "FS_GRANT_MAX_START_AGE_S" not in own, (
                f"{name}: the shim never kills an attempt here, so a start age would read as a guarantee "
                "nothing enforces (U26)")
    from proto import grants

    base = _compose_default(_env(_service(_load(COMPOSE), "worker"))["FS_GRANT_MAX_START_AGE_S"])[1]
    assert float(base) == grants.DEFAULT_MAX_START_AGE_S, "one value everywhere: compose and the worker's default"


def test_grant_wait_is_below_the_shim_ceiling():
    """The wait for the refresher happens inside the POST, so it must end before the shim's
    1,800 s kill turns it into a redelivery that waits again."""
    from proto import grants

    wait = float(_compose_default(_env(_service(_load(COMPOSE), "worker"))["FS_GRANT_WAIT_S"])[1])
    ceiling = float(_compose_default(_env(_service(_load(COMPOSE), "shim"))["READ_TIMEOUT_S"])[1])
    assert wait == grants.DEFAULT_WAIT_S < ceiling == STEP_CEILING_S
