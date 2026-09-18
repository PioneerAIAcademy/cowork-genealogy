"""The prototype worker: the HTTP handler the sqsd shim POSTs turns to, running one
patron turn per message through the Claude Agent SDK (plan: D9-10, D11-12, D15).

``POST /turn`` claims the turn in Postgres (upserts ``sessions``/``turns``; a
redelivered ``turn_id`` is granted immediately -- that IS the resume path) and then:

- a message carrying ``text`` -- the web tier's ``{turn_id, session_id, project_id,
  text, enqueued_at}`` -- runs the real turn (``run_turn``). A turn whose
  ``turns.completed_at`` is already set answers 200 without running anything: the shim's
  error-path requeue can redeliver a completed turn.
- otherwise the D3 stub arms, kept so ``make proto-smoke`` still drives every shim
  outcome with no model:

    {"behaviour": "ok"}                   -> session_events row (kind turn_done),
                                             turns.completed_at/outcome, 200
    {"behaviour": "sleep", "seconds": N}  -> sleep N (first delivery only), then as ok
    {"behaviour": "fail"}                 -> 500, every delivery
    {"behaviour": "crash"}                -> os._exit(1) before replying (first
                                             delivery only; compose restarts us)

The real turn: the SDK session id is CHOSEN by the worker at claim time --
``sessions.sdk_session_id`` is set (once, ``COALESCE``) before the CLI spawns, so the
first transcript append can never land under an id no row names -- and passed as
``session_id=`` on a fresh session or ``resume=`` when the session store already holds
entries for it (a mid-turn kill on either path resumes on redelivery); the options from
``options.py``; ``get_server_info()`` checked for the six bare agent names
(``EXPECTED_AGENTS``, a constant -- never the set that happened to load) and the 28
``genealogy-research:<skill>`` commands (``EXPECTED_SKILLS``, a literal -- never a count
of the directory the SDK loads from) BEFORE the query bills a token (D15) -- a miss
is a 500; the CLI's ``system/init`` must arrive and declare the chosen id, or the
turn fails; every SDK message through ``map_message`` -- transient kinds upsert
``session_activity``, everything else is a ``session_events`` row via
``next_session_seq`` (kind = the event's kind, payload = its other fields); a
``MirrorErrorMessage`` is fatal (the store dropped a batch, and local disk dies with
the worker); the ``ResultMessage``'s cost/num_turns/duration and the turn's token
counts -- summed from ``session_entries`` above the turn's first-claim high-water mark,
so a killed attempt's spend is on the row too -- land on the turns row in the same
commit as ``turn_done`` (``complete``). Any exception answers 500 with the error in the
body and one JSON log line; the shim backs off and the redelivery resumes.

Env: PG_DSN, PORT (8080), WORKER_CWD (/project -- created empty if missing, never
written), ENGINE_DIR, ENGINE_PLUGIN_DIR, TMPDIR (per-turn CLAUDE_CONFIG_DIRs go under
it), MODEL_PROVIDER + ANTHROPIC_API_KEY / the Bedrock variables, the GENEALOGY_* store
variables and FS_ACCESS_TOKEN (see options.py). Startup applies ../sql/*.sql (all
idempotent) and parses the plugin's agents once. ``GET /healthz`` -> 200.
ThreadingHTTPServer, so a second POST is served while a turn is running.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

HERE = Path(__file__).resolve().parent
# apps/server in the repo, /opt/genealogy/server in the container: the import root for
# both ``app.agent.real_agent`` (map_message) and ``proto.worker.*``.
SERVER_DIR = HERE.parents[1]
SQL_DIR = HERE.parent / "sql"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from proto.worker.options import build_worker_options, check_registration, make_pretool_hook  # noqa: E402
from proto.worker.plugin_agents import load_agent_definitions  # noqa: E402
from proto.worker.session_store import PgSessionStore  # noqa: E402

PG_DSN = os.environ.get("PG_DSN", "postgresql://postgres:proto@postgres:5432/proto")
PORT = int(os.environ.get("PORT", "8080"))
WORKER_CWD = os.environ.get("WORKER_CWD", "/project")
_REPO = HERE.parents[3]  # apps/server/proto/worker -> the repo root (venv runs only)
ENGINE_DIR = os.environ.get("ENGINE_DIR", str(_REPO / "packages" / "engine" / "mcp-server"))
ENGINE_PLUGIN_DIR = os.environ.get("ENGINE_PLUGIN_DIR", str(_REPO / "packages" / "engine" / "plugin"))
SCHEMA_RETRIES = 30

# The agents the plugin ships, by bare name. The D15 precondition compares
# get_server_info() against THIS set, never against whatever agents/*.md happened to
# load: a renamed or missing file must refuse every real turn before a token is billed,
# not shrink the expectation to match (every skill that delegates to the missing agent
# would then fail silently at delegation time -- the zero-tools class of failure).
EXPECTED_AGENTS = frozenset({
    "gps-mentor",
    "image-reader",
    "person-evidence",
    "proof-conclusion",
    "record-extractor",
    "research-exhaustiveness",
})
# The other half of the same precondition, a literal for the same reason: a count of
# the directory the SDK loads the plugin from shrinks with it -- an image shipping 27
# skills registers 27 and passes. test_proto_worker pins this against the repo.
EXPECTED_SKILLS = 28

_stdout_lock = threading.Lock()

# Parsed once at start (prepare); a real turn refuses to run without them.
_AGENTS: dict[str, Any] | None = None
_AGENTS_ERROR: str | None = None


class RegistrationError(RuntimeError):
    """The D15 precondition failed: an agent or skill the plugin ships is not registered."""


class MirrorError(RuntimeError):
    """The session store dropped a transcript batch; the turn cannot be resumed faithfully."""


def log(**fields: object) -> None:
    line = json.dumps(fields, separators=(",", ":"), default=str)
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


# -- rows ----------------------------------------------------------------------


def claim(conn: psycopg.Connection, turn: dict, receive_count: int) -> None:
    """Record the claim: sessions/turns upsert; a redelivery just bumps receive_count.
    ``entries_seq_before`` -- the ``session_entries`` high-water mark -- is taken on the
    FIRST claim only, so the token sum in ``complete`` spans every attempt of the turn."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sessions (session_id, project_id, created_at) VALUES (%s, %s, now()) "
            "ON CONFLICT (session_id) DO NOTHING",
            (turn["session_id"], turn["project_id"]),
        )
        cur.execute(
            "INSERT INTO turns (turn_id, session_id, project_id, message, enqueued_at, "
            "claimed_at, receive_count, entries_seq_before) "
            "VALUES (%s, %s, %s, %s, COALESCE(%s::timestamptz, now()), now(), %s, "
            "(SELECT COALESCE(max(seq), 0) FROM session_entries)) "
            "ON CONFLICT (turn_id) DO UPDATE "
            "SET claimed_at = now(), receive_count = EXCLUDED.receive_count, "
            "entries_seq_before = COALESCE(turns.entries_seq_before, EXCLUDED.entries_seq_before)",
            (
                turn["turn_id"],
                turn["session_id"],
                turn["project_id"],
                Jsonb(turn["message"]),
                turn["message"].get("enqueued_at"),
                receive_count,
            ),
        )
    conn.commit()


def turn_completed(conn: psycopg.Connection, turn_id: str) -> bool:
    """Whether ``turns.completed_at`` is already set -- a redelivery of a finished turn."""
    with conn.cursor() as cur:
        cur.execute("SELECT completed_at FROM turns WHERE turn_id = %s", (turn_id,))
        row = cur.fetchone()
    return bool(row and row[0] is not None)


# The turn's token counts: every assistant entry the SDK session appended after the
# turn's first claim, one row per API message (a streamed message is written once per
# content block, all carrying its usage -- the LAST one holds the final figures).
# Unlike cost_usd, which is the completing attempt's ResultMessage, this spans a killed
# attempt's calls too; token counts do not drift with price tables.
TURN_USAGE_SQL = (
    "SELECT sum((u->>'input_tokens')::bigint), "
    "sum((u->>'cache_creation_input_tokens')::bigint), "
    "sum((u->>'cache_read_input_tokens')::bigint), "
    "sum((u->>'output_tokens')::bigint) "
    "FROM (SELECT DISTINCT ON (entry->'message'->>'id') entry->'message'->'usage' AS u "
    "FROM session_entries WHERE session_id = %s AND entry->>'type' = 'assistant' "
    "AND seq > COALESCE((SELECT entries_seq_before FROM turns WHERE turn_id = %s), 0) "
    "ORDER BY entry->'message'->>'id', seq DESC) m"
)


def complete(
    conn: psycopg.Connection,
    turn: dict,
    receive_count: int,
    *,
    cost_usd: float | None = None,
    num_turns: int | None = None,
    duration_ms: int | None = None,
    sdk_session_id: str | None = None,
) -> int:
    """Append the turn_done event (per-session seq via next_session_seq) and close the
    turn -- with the ResultMessage's figures when there are any, and the token sum over
    ``session_entries`` when ``sdk_session_id`` is given -- in ONE commit."""
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT next_session_seq(%s)", (turn["session_id"],))
            seq = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO session_events (session_id, seq, kind, payload, ts) "
                "VALUES (%s, %s, 'turn_done', %s, now())",
                (
                    turn["session_id"],
                    seq,
                    Jsonb({"turn_id": turn["turn_id"], "receive_count": receive_count}),
                ),
            )
            tokens: tuple = (None, None, None, None)
            if sdk_session_id:
                cur.execute(TURN_USAGE_SQL, (sdk_session_id, turn["turn_id"]))
                tokens = tuple(cur.fetchone() or tokens)
            cur.execute(
                "UPDATE turns SET completed_at = now(), outcome = 'ok', "
                "cost_usd = COALESCE(%s, cost_usd), num_turns = COALESCE(%s, num_turns), "
                "duration_ms = COALESCE(%s, duration_ms), "
                "input_tokens = COALESCE(%s, input_tokens), "
                "cache_creation_tokens = COALESCE(%s, cache_creation_tokens), "
                "cache_read_tokens = COALESCE(%s, cache_read_tokens), "
                "output_tokens = COALESCE(%s, output_tokens) WHERE turn_id = %s",
                (cost_usd, num_turns, duration_ms, *tokens, turn["turn_id"]),
            )
    conn.commit()
    return seq


def choose_sdk_session_id(conn: psycopg.Connection, session_id: str, candidate: str) -> str:
    """The session's SDK session id: the one already on the row, else ``candidate``
    written now -- one ``COALESCE`` statement, so two claims racing on a fresh session
    agree on the first writer's id. Called BEFORE the CLI spawns, which is what closes
    the window between the SDK's first store append and the row that names its id."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE sessions SET sdk_session_id = COALESCE(sdk_session_id, %s) "
            "WHERE session_id = %s RETURNING sdk_session_id",
            (candidate, session_id),
        )
        row = cur.fetchone()
    conn.commit()
    if not row or not row[0]:
        raise RuntimeError(f"no sessions row for {session_id} to hold an sdk_session_id")
    return str(row[0])


def insert_tool_call(conn: psycopg.Connection, row: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO tool_calls (turn_id, session_id, agent_id, agent_type, tool_name, "
            "input_path, decision) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                row["turn_id"],
                row["session_id"],
                row.get("agent_id"),
                row.get("agent_type"),
                row["tool_name"],
                row.get("input_path"),
                row["decision"],
            ),
        )
    conn.commit()


def route_event(event: dict[str, Any], transient_kinds: frozenset[str]) -> tuple[str, str, dict[str, Any]]:
    """Where one ``map_message`` event goes: ``("activity", kind, event)`` for a transient
    kind (the whole event is the ``session_activity`` payload), else
    ``("event", kind, payload)`` with ``kind`` lifted out into the column."""
    kind = str(event.get("kind") or "")
    if kind in transient_kinds:
        return "activity", kind, dict(event)
    return "event", kind, {k: v for k, v in event.items() if k != "kind"}


def write_event(
    conn: psycopg.Connection,
    session_id: str,
    event: dict[str, Any],
    transient_kinds: frozenset[str],
    counters: dict[str, int],
) -> None:
    table, kind, payload = route_event(event, transient_kinds)
    with conn.cursor() as cur:
        if table == "activity":
            cur.execute(
                "INSERT INTO session_activity (session_id, payload, updated_at) "
                "VALUES (%s, %s, now()) ON CONFLICT (session_id) DO UPDATE "
                "SET payload = EXCLUDED.payload, updated_at = now()",
                (session_id, Jsonb(payload)),
            )
            counters["activity"] += 1
        else:
            cur.execute("SELECT next_session_seq(%s)", (session_id,))
            seq = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO session_events (session_id, seq, kind, payload, ts) "
                "VALUES (%s, %s, %s, %s, now())",
                (session_id, seq, kind, Jsonb(payload)),
            )
            counters["events"] += 1
    conn.commit()


def message_session_id(msg: Any) -> str | None:
    sid = getattr(msg, "session_id", None)
    if sid is None:
        data = getattr(msg, "data", None)
        if isinstance(data, dict):
            sid = data.get("session_id")
    return str(sid) if sid else None


def is_init_message(msg: Any) -> bool:
    """The CLI's ``system/init`` -- the one message that declares which session id the
    process is running under."""
    return getattr(msg, "subtype", None) == "init" and isinstance(getattr(msg, "data", None), dict)


# -- startup -------------------------------------------------------------------


def ensure_cwd(path: str) -> None:
    """The anchor must exist or the CLI will not spawn; it is never written into."""
    Path(path).mkdir(parents=True, exist_ok=True)


def apply_schema(dsn: str, sql_dir: Path = SQL_DIR, retries: int = SCHEMA_RETRIES) -> list[str]:
    """Run ../sql/*.sql in name order (every statement idempotent), waiting for Postgres."""
    files = sorted(sql_dir.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no schema files under {sql_dir}")
    last: Exception | None = None
    for _ in range(retries):
        try:
            with psycopg.connect(dsn) as conn:
                for path in files:
                    conn.execute(path.read_text(encoding="utf-8"))
                conn.commit()
            return [p.name for p in files]
        except psycopg.OperationalError as exc:
            last = exc
            time.sleep(1)
    raise RuntimeError(f"postgres not reachable after {retries}s: {last}")


def count_skills(plugin_dir: str) -> int:
    skills = Path(plugin_dir) / "skills"
    return sum(1 for d in skills.iterdir() if (d / "SKILL.md").is_file()) if skills.is_dir() else 0


def load_plugin_agents(plugin_dir: str) -> tuple[dict[str, Any] | None, str | None]:
    """``(agents, None)`` when ``<plugin_dir>/agents/*.md`` is exactly ``EXPECTED_AGENTS``,
    else ``(None, why)`` -- and every real turn is then refused (``require_agents``)."""
    try:
        agents = load_agent_definitions(Path(plugin_dir))
    except Exception as exc:  # noqa: BLE001 - the reason travels to the turn's 500
        return None, f"{type(exc).__name__}: {exc}"
    found = set(agents)
    if found != EXPECTED_AGENTS:
        why = f"plugin agents {sorted(EXPECTED_AGENTS - found)} missing under {plugin_dir}/agents"
        if found - EXPECTED_AGENTS:
            why += f"; unexpected {sorted(found - EXPECTED_AGENTS)}"
        return None, why
    return agents, None


def prepare() -> None:
    """Everything a real turn needs, done once; a failure is logged and fails only the
    real turns (the stub arms keep working)."""
    global _AGENTS, _AGENTS_ERROR
    try:
        ensure_cwd(WORKER_CWD)
    except OSError as exc:
        log(ev="prepare", step="cwd", error=f"{type(exc).__name__}: {exc}", cwd=WORKER_CWD)
    try:
        log(ev="prepare", step="schema", applied=apply_schema(PG_DSN))
    except Exception as exc:  # noqa: BLE001 - reported, then the server still serves /healthz
        log(ev="prepare", step="schema", error=f"{type(exc).__name__}: {exc}")
    _AGENTS, _AGENTS_ERROR = load_plugin_agents(ENGINE_PLUGIN_DIR)
    try:
        from claude_agent_sdk._cli_version import __cli_version__ as cli_version
    except Exception:  # noqa: BLE001
        cli_version = None
    log(
        ev="prepare", step="agents", agents=sorted(_AGENTS or {}),
        skills_on_disk=count_skills(ENGINE_PLUGIN_DIR), skills_expected=EXPECTED_SKILLS,
        error=_AGENTS_ERROR, plugin_dir=ENGINE_PLUGIN_DIR, engine_dir=ENGINE_DIR,
        cli_version=cli_version,
    )


def require_agents() -> dict[str, Any]:
    if _AGENTS is None:
        raise RuntimeError(f"plugin agents not loaded from {ENGINE_PLUGIN_DIR}: {_AGENTS_ERROR}")
    return _AGENTS


def registration_problems(info: Any) -> list[str]:
    """The D15 precondition against the two CONSTANTS -- this function has no way to be
    handed the agents that loaded or a count of the skills on disk, which is the point."""
    return check_registration(info, expected_agents=set(EXPECTED_AGENTS), expected_skills=EXPECTED_SKILLS)


# -- the real turn -------------------------------------------------------------


async def run_turn(
    turn: dict,
    receive_count: int,
    sdk_session_id: str,
    *,
    agents: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from claude_agent_sdk import ClaudeSDKClient, MirrorErrorMessage, ResultMessage

    from app.agent.real_agent import TRANSIENT_KINDS, map_message

    agents = require_agents() if agents is None else agents
    message = turn["message"]
    turn_id, session_id, project_id = turn["turn_id"], turn["session_id"], turn["project_id"]
    text = str(message["text"])
    ensure_cwd(WORKER_CWD)

    started = time.monotonic()
    counters = {"events": 0, "activity": 0, "tool_calls": 0}
    store = PgSessionStore(PG_DSN, project_id)
    config_dir = tempfile.mkdtemp(prefix="worker-cfg-")
    # The directory the CLI really runs in: on a resumed turn the SDK repoints it to its
    # own mkdtemp, which is where the tool-result spill then lands.
    config_root = {"path": config_dir}
    conn = psycopg.connect(PG_DSN, autocommit=True)
    result = None
    try:
        # The id was chosen at claim time (serve_real_turn); the store decides which of
        # the two mutually exclusive CLI flags carries it.
        resume = sdk_session_id if await store.has_entries(sdk_session_id) else None

        def record(row: dict[str, Any]) -> None:
            insert_tool_call(conn, row)
            counters["tool_calls"] += 1

        hook = make_pretool_hook(
            turn_id=turn_id, session_id=session_id, cwd=WORKER_CWD,
            config_root=lambda: config_root["path"], record=record, log=log,
        )
        options = build_worker_options(
            project_id=project_id,
            cwd=WORKER_CWD,
            engine_dir=ENGINE_DIR,
            plugin_dir=ENGINE_PLUGIN_DIR,
            agents=agents,
            store=store,
            config_dir=config_dir,
            pretool_hook=hook,
            resume=resume,
            session_id=None if resume else sdk_session_id,
            fs_access_token=message.get("fs_access_token"),
            stderr=lambda line: log(ev="cli_stderr", turn_id=turn_id, line=line[:500]),
        )
        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            materialized = getattr(client, "_materialized", None)
            if materialized is not None and getattr(materialized, "config_dir", None):
                config_root["path"] = str(materialized.config_dir)
            problems = registration_problems(await client.get_server_info())
            if problems:
                raise RegistrationError("; ".join(problems))

            await client.query(text)
            saw_init = False
            tool_names: dict[str, str] = {}
            tasks: dict[str, str] = {}
            live: set[str] = set()
            async for msg in client.receive_response():
                if is_init_message(msg):
                    saw_init = True
                    sid = message_session_id(msg)
                    if sid != sdk_session_id:
                        raise RuntimeError(
                            f"the CLI is running session {sid}, not the chosen {sdk_session_id}"
                        )
                if isinstance(msg, MirrorErrorMessage):
                    raise MirrorError(f"session store append failed: {msg.error or msg.data}")
                for event in map_message(msg, tool_names, tasks, live):
                    write_event(conn, session_id, event, TRANSIENT_KINDS, counters)
                if isinstance(msg, ResultMessage):
                    result = msg
            if not saw_init:
                # Without this the session-id assertion above fails open: a CLI whose init
                # message stopped matching would run unverified and pass.
                raise RuntimeError("the CLI never declared its session (no system/init message)")
            if result is None:
                raise RuntimeError("message stream ended without a ResultMessage")
            if result.is_error:
                raise RuntimeError(
                    f"ResultMessage is_error ({result.subtype}"
                    f"{', api ' + str(result.api_error_status) if result.api_error_status else ''}): "
                    f"{'; '.join(result.errors or []) or result.result or 'no detail'}"
                )
            seq = complete(
                conn, turn, receive_count,
                cost_usd=result.total_cost_usd, num_turns=result.num_turns, duration_ms=result.duration_ms,
                sdk_session_id=sdk_session_id,
            )
        finally:
            await client.disconnect()
    finally:
        conn.close()
        shutil.rmtree(config_dir, ignore_errors=True)

    summary = {
        "seq": seq,
        "resumed": resume is not None,
        "sdk_session_id": sdk_session_id,
        "num_turns": result.num_turns,
        "cost_usd": result.total_cost_usd,
        "duration_ms": result.duration_ms,
        "wall_ms": int((time.monotonic() - started) * 1000),
        "events": counters["events"],
        "activity": counters["activity"],
        "entries_appended": store.calls["entries_appended"],
        "tool_calls": counters["tool_calls"],
    }
    return summary


def run_turn_sync(turn: dict, receive_count: int, sdk_session_id: str) -> dict[str, Any]:
    return asyncio.run(run_turn(turn, receive_count, sdk_session_id))


def is_real_turn(message: dict) -> bool:
    text = message.get("text")
    return isinstance(text, str) and bool(text.strip())


def serve_real_turn(turn: dict, receive_count: int, *, connect=psycopg.connect, run=run_turn_sync) -> tuple[int, dict]:
    """Claim, skip a turn that already completed, else choose the SDK session id and run
    it. ``(status, body)``."""
    turn_id = turn["turn_id"]
    try:
        with connect(PG_DSN) as conn:
            claim(conn, turn, receive_count)
            done = turn_completed(conn, turn_id)
            sdk_session_id = None if done else choose_sdk_session_id(conn, turn["session_id"], str(uuid.uuid4()))
    except psycopg.Error as exc:
        error = f"{type(exc).__name__}: {exc}"
        log(ev="turn", turn_id=turn_id, receive_count=receive_count, status=500, error=error)
        return 500, {"ok": False, "turn_id": turn_id, "error": error}
    if done:
        log(ev="turn", turn_id=turn_id, receive_count=receive_count, status=200, already_completed=True)
        return 200, {"ok": True, "turn_id": turn_id, "receive_count": receive_count, "already_completed": True}
    try:
        summary = run(turn, receive_count, sdk_session_id)
    except Exception as exc:  # noqa: BLE001 - every failure is a 500 the shim backs off on
        error = f"{type(exc).__name__}: {exc}"
        log(ev="turn", turn_id=turn_id, session_id=turn["session_id"], receive_count=receive_count,
            status=500, error=error)
        return 500, {"ok": False, "turn_id": turn_id, "error": error}
    log(ev="turn", turn_id=turn_id, session_id=turn["session_id"], receive_count=receive_count,
        status=200, **summary)
    return 200, {"ok": True, "turn_id": turn_id, "receive_count": receive_count, **summary}


# -- HTTP ----------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "proto-worker/0.2"

    def log_message(self, format, *args):  # noqa: A002 - BaseHTTPRequestHandler's signature
        pass  # JSON lines below replace the default access log

    def _reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._reply(200, {"ok": True})
        else:
            self._reply(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/turn":
            self._reply(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            message = json.loads(raw.decode("utf-8"))
            if not isinstance(message, dict):
                raise ValueError("body is not a JSON object")
        except (ValueError, UnicodeDecodeError) as exc:
            log(ev="turn", status=400, error=f"bad body: {exc}")
            self._reply(400, {"ok": False, "error": f"bad body: {exc}"})
            return

        msgid = self.headers.get("X-Aws-Sqsd-Msgid")
        try:
            receive_count = int(self.headers.get("X-Aws-Sqsd-Receive-Count") or 1)
        except ValueError as exc:
            log(ev="turn", status=400, error=f"bad receive count: {exc}")
            self._reply(400, {"ok": False, "error": f"bad X-Aws-Sqsd-Receive-Count: {exc}"})
            return
        turn = {
            "turn_id": message.get("turn_id") or msgid or "turn-unknown",
            "session_id": message.get("session_id") or "sess-unknown",
            "project_id": message.get("project_id") or "proj-unknown",
            "message": message,
        }

        if is_real_turn(message):
            status, payload = serve_real_turn(turn, receive_count)
            self._reply(status, payload)
            return

        behaviour = message.get("behaviour", "ok")
        seconds = float(message.get("seconds") or 0)
        if behaviour not in ("ok", "sleep", "fail", "crash"):
            log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status=400)
            self._reply(400, {"ok": False, "error": f"unknown behaviour {behaviour!r}"})
            return

        try:
            with psycopg.connect(PG_DSN) as conn:
                claim(conn, turn, receive_count)

            if behaviour == "fail":
                log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status=500)
                self._reply(500, {"ok": False, "turn_id": turn["turn_id"], "error": "behaviour=fail"})
                return
            if behaviour == "crash" and receive_count == 1:
                log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status="crash")
                os._exit(1)
            if behaviour == "sleep" and receive_count == 1:
                time.sleep(seconds)

            with psycopg.connect(PG_DSN) as conn:
                seq = complete(conn, turn, receive_count)
        except psycopg.Error as exc:
            log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status=500, error=f"{type(exc).__name__}: {exc}")
            self._reply(500, {"ok": False, "turn_id": turn["turn_id"], "error": f"{type(exc).__name__}: {exc}"})
            return

        log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status=200, seq=seq)
        self._reply(200, {"ok": True, "turn_id": turn["turn_id"], "receive_count": receive_count, "seq": seq})


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    prepare()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log(ev="start", port=PORT, pg_dsn=PG_DSN.split("@")[-1], cwd=WORKER_CWD,
        provider=os.environ.get("MODEL_PROVIDER") or "anthropic")
    server.serve_forever()


if __name__ == "__main__":
    main()
