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
                                             turns.completed_at/outcome, 200 (a
                                             redelivery of a closed turn writes nothing)
    {"behaviour": "sleep", "seconds": N}  -> sleep N (first delivery only), then as ok
    {"behaviour": "fail"}                 -> 500, every delivery but the last receive,
                                             which closes the turn (below)
    {"behaviour": "crash"}                -> os._exit(1) before replying (first
                                             delivery only; compose restarts us)

The real turn: the SDK session id is CHOSEN by the worker at claim time --
``sessions.sdk_session_id`` is set (once, ``COALESCE``) before the CLI spawns, so the
first transcript append can never land under an id no row names -- and passed as
``session_id=`` on a fresh session or ``resume=`` when the session store already holds
entries for it (a mid-turn kill on either path resumes on redelivery); the options from
``options.py``; ``get_server_info()`` checked for the twenty bare agent names
(``EXPECTED_AGENTS``, a constant -- never the set that happened to load) and the 12
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

The resume rule (D17): a REDELIVERY (``receive_count`` > 1) whose result carries
``num_turns == 0`` has not redone the interrupted work -- the CLI answered its own meta
prompt about the orphaned agents and returned -- so the attempt logs
``resume_synthetic_result`` and sends ONE continue prompt (``RESUME_CONTINUE_TEXT``)
before completing on that second result's figures. A FIRST delivery is never re-queried,
whatever the SDK session already holds: the continue prompt orders the model to resume
the interrupted task and not start over, which on a first delivery would discard the
message the patron just sent. The bound is ``attempt_prompts``'s tuple, not a loop
condition. The
row takes the COMPLETING pass's ``cost_usd`` and ``duration_ms`` (``complete``'s
redelivery convention), while the token columns above sum every pass from
``session_entries`` -- an asymmetry that costs nothing in the shape the rule exists for,
since ``num_turns == 0`` means the discarded pass billed no model turn.

The resume GUARD (PR #2870 item 0a) is what happens when that re-query does not help.
A redelivered attempt whose figures still show no work -- ``attempt_did_work``:
``num_turns == 0``, or no ``tool_calls`` row recorded this pass -- is a resume FAILURE,
not a completion. D17 used to complete such a turn "as it stands", which records a
half-finished run as finished: PR #2695's acceptance run did exactly that on 2026-09-20,
in 10 ms, with ``project.status`` still ``active``. Now the attempt bumps
``turns.zero_progress_attempts`` and raises ``ResumeFailure``, which serve_real_turn
answers 500 and the shim requeues; the counter is cleared at the next attempt's first
tool call, so only CONSECUTIVE dead attempts accumulate. At ``ZERO_PROGRESS_CAP`` the
worker stops re-running the model and closes the turn ITSELF -- 200, ``outcome``
``no_progress`` -- because the queue has no redrive policy, so a terminal failure
surfaced as an error is redelivered forever, which is the paid loop the guard exists to
prevent.

Dead letters (U5 D3): sqsd moves a message on after ``MaxRetries`` receives, and the
worker never sees the DLQ. So a receive with ``receive_count >= SQSD_MAX_RETRIES`` that
is about to answer non-200 -- an exception, a ``ResumeFailure``, a SIGTERM -- closes the
turn itself instead (``close_turn``: 200, outcome ``retries_exhausted``, ``detail.cause``
``error``/``shutdown``/``sweep``) and releases the session's next held message. A crash
on the last receive runs no worker code, so a sweep thread closes what no delivery can
reach any more: the last receive's visibility lapsed (``SQSD_VISIBILITY_TIMEOUT_S`` +
60 s), or SQS's retention (``SQSD_RETENTION_PERIOD_S``) expired it. Each path is on
only when its variable is set, and ``SWEEP_INTERVAL_S=0`` turns the sweep off.

SIGTERM / SIGINT (U5 D2): every in-flight ``POST /turn`` answers 500 at once
(``"shutdown": true``) so sqsd redelivers after ``ErrorVisibilityTimeout`` rather than
``VisibilityTimeout``; then each attempt is cancelled through its anyio cancel scope,
which runs ``client.disconnect()``'s SIGTERM-then-SIGKILL; the replies and the attempts'
``finally`` blocks are waited for, bounded by ``SHUTDOWN_GRACE_S``; a last-receive
close's deferred release runs once its attempt has finished (within ``RELEASE_BUDGET_S``
more, else it is skipped and the row stays held); the server stops, a POST it accepted
meanwhile is waited for and released the same way; and the process exits 0. A POST after
SHUTDOWN answers 503, except on its last receive, which closes.

Env: PG_DSN, PORT (8080), WORKER_CWD (/project -- created empty if missing, never
written), ENGINE_PLUGIN_DIR, TMPDIR (per-turn CLAUDE_CONFIG_DIRs go under it),
MODEL_PROVIDER + ANTHROPIC_API_KEY / GATEWAY_BASE_URL, GATEWAY_API_KEY and
GATEWAY_TOOL_SEARCH, TOOL_SERVER_URL and FS_ACCESS_TOKEN (see options.py);
SQSD_MAX_RETRIES (0 = no last-receive close), SQSD_VISIBILITY_TIMEOUT_S,
SQSD_RETENTION_PERIOD_S (unset = no backstop), SWEEP_INTERVAL_S (300; 0 = off) and
SHUTDOWN_GRACE_S (20). With QUEUE_URL set (and only then): GENEALOGY_SQS_ACCESS_KEY +
GENEALOGY_SQS_SECRET_KEY (both or neither; neither signs with the default AWS chain, the
instance profile on AWS; one alone exits 2) and GENEALOGY_SQS_REGION (else the QUEUE_URL
host's region).

Startup (U10): a ``TMPDIR`` that is not absolute, missing, not a directory or not
writable exits 2 before anything else (``check_tmpdir``); so does a plugin-hook
``python3`` below 3.10 or missing -- the first on the CLI child's ``PATH``, which puts this
interpreter's directory first (U12, ``check_hook_python``); then the SQS credentials and
region are settled (U7: a half pair exits 2; the default chain may ask IMDS); then the
plugin's agents are parsed once, the server binds, and ../sql/*.sql (all idempotent) is
applied on a daemon thread that retries a refused or silent Postgres, and an apply that
raced the web tier's or another worker's (``schema_loop``), with backoff -- so Postgres
is never waited on before listen, and no failed store ever exits the process.
``GET /healthz`` is readiness: 200 or 503 with ``{ok, checks}`` over ``postgres`` (a
fresh connection that sees every table, under one ``READY_TIMEOUT_S`` deadline),
``schema`` (the start apply), ``agents``, ``cwd``, ``tmpdir`` and ``transcript`` (the
last model turn appended entries); each ``error`` is a label, never a message.
ThreadingHTTPServer, so a second POST is served while a turn is running.

A model turn that appended no transcript entries (D6) closes ``transcript_lost`` and
answers 500; its redelivery finds the row closed and answers 200 without running.
"""

from __future__ import annotations

import asyncio
import contextlib
import errno
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections.abc import Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import anyio
import psycopg
from psycopg.types.json import Jsonb

HERE = Path(__file__).resolve().parent
# apps/server in the repo, /opt/genealogy/server in the container: the import root for
# both ``app.agent.real_agent`` (map_message) and ``proto.worker.*``.
SERVER_DIR = HERE.parents[1]
SQL_DIR = HERE.parent / "sql"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from proto.worker.options import (  # noqa: E402
    PRICE_PER_MTOK,
    SPEND_CAP_USD,
    env_float,
    env_int,
    shared_price_usd,
    RESUME_CONTINUE_TEXT,
    HANDOVER_REASON,
    SPEND_CAP_REASON,
    STOP_REASON,
    TERMINAL_BUDGET,
    TERMINAL_QUEUED,
    TERMINAL_STOPPED,
    build_worker_options,
    check_registration,
    hook_path,
    make_posttool_hook,
    make_pretool_hook,
    make_stop_hook,
    parse_blocked_tools,
)
from proto.worker.plugin_agents import load_agent_definitions  # noqa: E402
from proto.worker.session_store import PgSessionStore  # noqa: E402

PG_DSN = os.environ.get("PG_DSN", "postgresql://postgres:proto@postgres:5432/proto")
# 1b: where a held message goes when the turn that held it ends. The worker is the only
# component that knows a turn finished -- the web tier is stateless and the browser may
# be closed -- so the release lives here. Unset means no release, which the D3 stub arms
# and the offline tests run with.
QUEUE_URL = os.environ.get("QUEUE_URL", "")
PORT = env_int("PORT", 8080)
WORKER_CWD = os.environ.get("WORKER_CWD", "/project")
_REPO = HERE.parents[3]  # apps/server/proto/worker -> the repo root (venv runs only)
ENGINE_PLUGIN_DIR = os.environ.get("ENGINE_PLUGIN_DIR", str(_REPO / "packages" / "engine" / "plugin"))

# U10: readiness. One deadline for the whole Postgres probe, under the image
# HEALTHCHECK's urlopen(timeout=2); psycopg's own connect_timeout floor is 2 s, so the
# deadline is a race (probe_postgres), not a connect option.
READY_TIMEOUT_S = 1.5
READY_CONNECT_TIMEOUT_S = 2
READY_STATEMENT_TIMEOUT_MS = 1500
# Bounds a probe whose host goes silent after the handshake, which connect_timeout and the
# server-side statement_timeout do not: unacknowledged data (tcp_user_timeout, Linux) and
# an idle wait for the reply (keepalives) each give up in ~3 s, not TCP's ~15 min.
READY_TCP_OPTIONS = {"tcp_user_timeout": 3000, "keepalives": 1, "keepalives_idle": 1,
                     "keepalives_interval": 1, "keepalives_count": 2}
# Every table and function the worker queries; a missing one fails `postgres`.
WORKER_TABLES = ("sessions", "turns", "session_events", "session_seq", "session_activity",
                 "session_entries", "tool_calls", "documents")
WORKER_FUNCTIONS = ("next_session_seq(text)",)
# The start schema apply's thread: one attempt's connect bound, and its backoff.
SCHEMA_CONNECT_TIMEOUT_S = 5
SCHEMA_BACKOFF_FIRST_S = 1.0
SCHEMA_BACKOFF_MAX_S = 30.0

# The agents the plugin ships, by bare name. The D15 precondition compares
# get_server_info() against THIS set, never against whatever agents/*.md happened to
# load: a renamed or missing file must refuse every real turn before a token is billed,
# not shrink the expectation to match (every skill that delegates to the missing agent
# would then fail silently at delegation time -- the zero-tools class of failure).
EXPECTED_AGENTS = frozenset({
    "check-warnings",
    "citation",
    "convert-dates",
    "gps-mentor",
    "historical-context",
    "hypothesis-tracking",
    "image-reader",
    "locality-guide",
    "person-evidence",
    "project-status",
    "proof-conclusion",
    "question-selection",
    "record-extractor",
    "research-exhaustiveness",
    "search-familysearch-wiki",
    "search-images",
    "search-wikipedia",
    "translation",
    "tree-edit",
    "validate-schema",
})
# The other half of the same precondition, a literal for the same reason: a count of
# the directory the SDK loads the plugin from shrinks with it -- an image shipping 12
# skills registers 12 and passes. test_proto_worker pins this against the repo.
EXPECTED_SKILLS = 12

_stdout_lock = threading.Lock()

# Parsed once at start (prepare); a real turn refuses to run without them.
_AGENTS: dict[str, Any] | None = None
_AGENTS_ERROR: str | None = None
_BLOCKED: frozenset[str] = frozenset()  # BLOCKED_TOOLS, the harness's tree-read block
# AUTONOMOUS_MAX_NUDGES (D18): the Stop hook's veto cap for a message WITHOUT max_nudges
# (turn_max_nudges); 0 = no Stop hook for those. The web tier stamps its own cap on every
# message it enqueues, so this value does not govern a web-tier turn.
_AUTONOMOUS_MAX_NUDGES: int = 0

# turns.outcome. 0a adds the first value that is not "ok": a turn the worker closed
# ITSELF, without the model having finished, because re-running it would not help.
OK_OUTCOME = "ok"
NO_PROGRESS_OUTCOME = "no_progress"
# U5 D3: the worker closed the turn because its message ran out of receives -- on the
# last receive itself, or from the sweep once no delivery can reach it any more.
RETRIES_EXHAUSTED_OUTCOME = "retries_exhausted"
# U10 D6: a model turn whose transcript never reached the store -- the worker closed it,
# because every redelivery would re-run the paid turn and fail the same way (the cause
# is this instance's configuration), and the spend cap cannot see a turn with no entries.
TRANSCRIPT_LOST_OUTCOME = "transcript_lost"
# halt() stops a turn at this many tool calls with no append attempted. The user-prompt frame
# is committed ~0.9 s after the claim, before the first model response (2026-10-01, n = 1
# tool-using turn), so the measured count before the first entry is 0; 3 is the margin.
# The count includes ToolSearch: the PreToolUse hook has no matcher.
TRANSCRIPT_LOST_AFTER_TOOL_CALLS = 3
# Text the MODEL reads as the turn halts, like options.py's STOP_REASON.
TRANSCRIPT_LOST_REASON = (
    "A server problem is keeping this run's conversation from being saved, so it is "
    "stopping here. Findings already written to the project are kept."
)

# PR #2870 item 1e: what one SITTING may spend before the worker stops it.
#
# Per SESSION, not per run and not per project: a sessions row carries a project_id, so a
# project spans many sessions and this caps one sitting, never the research. Sized against
# the corpus -- 155 runs with cost data, median $7.84, p90 $14.75, max $25.24 -- so $35 is
# about four median runs in one sitting and above the most expensive single run recorded.
#
# It exists because continuous work removes the human who used to end a run by not
# clicking Continue, and nothing replaced them. The nudge cap does not: it is consulted
# only at a voluntary yield, 31% of runs never yield, and it resets on every attempt.
#
# There is deliberately NO in-session grant flow. A session that reaches the bound stops,
# and the way to continue is a new session on the same project -- which is what users
# already do by default.
def _env_float(name: str, default: float) -> float:
    """A float from the environment that cannot crash-loop the container -- the shared
    guard, with this module's structured log as its error reporter. Every one of these is
    read at module scope, so a bare ``float()`` on a typo'd value raises before the worker
    binds and compose restarts it forever."""
    return env_float(
        name, default,
        on_error=lambda n, raw, d: log(ev="bad_env", name=n, value=raw[:40], using=d),
    )


# SPEND_CAP_USD and PRICE_PER_MTOK now live in `app.agent.continue_policy`, imported
# via options.py: the alpha's cap must fire at the same dollar as this one.

# PR #2870 item 0a: how many CONSECUTIVE zero-progress redeliveries of one turn the
# worker will pay for before closing it. Two, per the plan. The counter lives on
# turns.zero_progress_attempts (005_resume_guard.sql) and NOT on receive_count, which
# counts healthy ceiling crossings -- and crash, deploy and SIGTERM receives -- with the
# same number; see that file's header.
ZERO_PROGRESS_CAP = 2


def parse_max_nudges(value: str | None) -> int:
    """``AUTONOMOUS_MAX_NUDGES``: a non-negative int; unset or blank is 0 (off)."""
    text = (value or "").strip()
    if not text:
        return 0
    n = int(text)
    if n < 0:
        raise ValueError(f"AUTONOMOUS_MAX_NUDGES must be >= 0, not {n}")
    return n


class RegistrationError(RuntimeError):
    """The D15 precondition failed: an agent or skill the plugin ships is not registered."""


class MirrorError(RuntimeError):
    """The session store dropped a transcript batch; the turn cannot be resumed faithfully."""


class WorkerShutdown(RuntimeError):
    """The attempt was stopped by SIGTERM (U5 D2); the handler has already answered."""


class ResumeFailure(RuntimeError):
    """A REDELIVERED attempt did no work (0a), and the cap is not spent yet -- so the turn
    is NOT complete and must be redelivered. Raised rather than completed, which
    serve_real_turn answers 500 and decide.py requeues. The cap is what keeps that
    bounded: at ZERO_PROGRESS_CAP the worker closes the turn 200 instead."""


class TranscriptLost(RuntimeError):
    """A model turn appended no transcript entries (U10 D6). Raised only AFTER the turn
    is closed ``transcript_lost``, so serve_real_turn answers 500 and the redelivery finds
    the row closed. ``summary`` is the closed turn's summary."""

    def __init__(self, summary: dict[str, Any]) -> None:
        super().__init__(summary)
        self.summary = summary


def log(**fields: object) -> None:
    line = json.dumps(fields, separators=(",", ":"), default=str)
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


# U5: the sqsd options the worker must agree with, from the same environment block as
# the template's sqsd options -- read after ``log``, which a bad value reports
# through. 0 / unset turns the dependent path off.
SQSD_MAX_RETRIES = env_int("SQSD_MAX_RETRIES", 0)
SQSD_VISIBILITY_TIMEOUT_S = env_int("SQSD_VISIBILITY_TIMEOUT_S", 0)
SQSD_RETENTION_PERIOD_S = env_int("SQSD_RETENTION_PERIOD_S", 0)
SWEEP_INTERVAL_S = env_int("SWEEP_INTERVAL_S", 300)
SHUTDOWN_GRACE_S = _env_float("SHUTDOWN_GRACE_S", 20.0)
# The deferred last-receive releases run after the grace, inside their own budget: a
# release starts only if its connect and its SendMessage, each capped below, can finish
# before ``started + SHUTDOWN_GRACE_S + RELEASE_BUDGET_S``. That sum is what compose's
# worker ``stop_grace_period`` must cover (test_proto_config pins it). The SQS
# credentials are resolved before the claim, inside the budget: they are pre-warmed at
# start, so that is normally instant, and RELEASE_CREDENTIALS_TIMEOUT_S caps the rare
# IMDS refresh (a real IMDS answers in milliseconds) -- past it the release is not
# started and the row stays held for the web tier's rescue.
RELEASE_BUDGET_S = 6.0
RELEASE_CONNECT_TIMEOUT_S = 2
RELEASE_CREDENTIALS_TIMEOUT_S = 0.5
RELEASE_SQS_TIMEOUT_S = 3.0
# The fast sweep path waits this long past the last receive's visibility, so sqsd has
# certainly given up on the message before the worker closes its turn.
SWEEP_VISIBILITY_MARGIN_S = 60
SWEEP_BATCH = 100


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


# 1e. TURN_USAGE_SQL without its turn filter: the WHOLE session's assistant usage, one
# row per API message, deduplicated by message id. turns.cost_usd cannot answer this --
# it is the completing attempt's ResultMessage, so it misses every killed attempt, and
# per 0b the median run has two. The turns token columns do span attempts, but complete()
# writes them only when the turn CLOSES, and under continuous work one turn is the whole
# run: mid-run they are NULL, and a hook reading them never sees the run it exists to stop.
# The same four sums over the same de-duplicated assistant entries as TURN_USAGE_SQL,
# minus its `seq > entries_seq_before` bound: 1e's cap is per SESSION, so it prices every
# attempt of every turn including the ones that never closed. Derived rather than
# copy-pasted, because the two must keep agreeing about what an assistant entry's usage
# IS -- a fix to the DISTINCT ON that landed in one copy and not the other would make the
# cap and the per-turn figures disagree with no test able to see it.
SESSION_USAGE_SQL = TURN_USAGE_SQL.replace(
    "AND seq > COALESCE((SELECT entries_seq_before FROM turns WHERE turn_id = %s), 0) ", ""
)
assert "entries_seq_before" not in SESSION_USAGE_SQL, "the session cap must not be turn-bounded"


def price_usd(tokens: tuple) -> float:
    """Tokens (input, cache_write, cache_read, output) priced at PRICE_PER_MTOK.

    The shared estimator, so the prototype's cap and the alpha's cannot disagree about
    what a session has cost. ``int()`` first: Postgres returns a ``sum`` of ``bigint`` as
    ``numeric``, which psycopg hands back as ``Decimal``, and ``Decimal * float`` raises
    -- which made halt()'s spend clause raise on every tool call, and the hook allow it
    (U10). The sums are integral, so the conversion is exact."""
    return shared_price_usd(tuple(int(t or 0) for t in tokens))


def session_spend_usd(conn: psycopg.Connection, sdk_session_id: str) -> float:
    """What this SITTING has spent so far (1e), priced live off session_entries."""
    if not sdk_session_id:
        return 0.0
    with conn.cursor() as cur:
        cur.execute(SESSION_USAGE_SQL, (sdk_session_id,))
        row = cur.fetchone()
    return price_usd(tuple(row) if row else (0, 0, 0, 0))


def complete(
    conn: psycopg.Connection,
    turn: dict,
    receive_count: int,
    *,
    cost_usd: float | None = None,
    num_turns: int | None = None,
    duration_ms: int | None = None,
    sdk_session_id: str | None = None,
    nudges: int | None = None,
    outcome: str = OK_OUTCOME,
    detail: dict[str, Any] | None = None,
    only_if_open: bool = False,
) -> int | None:
    """Append the turn_done event (per-session seq via next_session_seq) and close the
    turn -- with the ResultMessage's figures when there are any, the token sum over
    ``session_entries`` when ``sdk_session_id`` is given, and the Stop hook's veto count
    (``nudges``: the cumulative count record_nudge persisted, else 0, since a turn the
    hook never vetoed has nothing on the row) -- in ONE commit.

    ``outcome`` is ``"ok"`` for every ordinary close. 0a passes
    ``NO_PROGRESS_OUTCOME`` when the worker closes the turn itself because redelivering
    it again would only re-run a model that is making no progress.

    ``only_if_open`` (U5 D3) closes the turn only if nobody has: the row is locked and
    read first, and a missing or completed row writes nothing and returns None. Two
    closers can race on one turn -- an attempt finishing while SIGTERM's last-receive close
    runs, or the sweep -- and only the one that gets a seq back may release a held
    message."""
    with conn.transaction():
        with conn.cursor() as cur:
            if only_if_open:
                cur.execute("SELECT completed_at FROM turns WHERE turn_id = %s FOR UPDATE", (turn["turn_id"],))
                row = cur.fetchone()
                if row is None or row[0] is not None:
                    return None
            cur.execute("SELECT next_session_seq(%s)", (turn["session_id"],))
            seq = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO session_events (session_id, seq, kind, payload, ts) "
                "VALUES (%s, %s, 'turn_done', %s, now())",
                (
                    turn["session_id"],
                    seq,
                    # 1c: the outcome rides the turn_done frame. row_to_wire spreads this
                    # payload straight onto the wire, so the browser can say WHY a run
                    # ended -- every ending used to look like success, and a half-finished
                    # run then reads to a genealogist as "nothing more was found".
                    Jsonb({"turn_id": turn["turn_id"], "receive_count": receive_count,
                           "outcome": outcome, **(detail or {})}),
                ),
            )
            tokens: tuple = (None, None, None, None)
            if sdk_session_id:
                cur.execute(TURN_USAGE_SQL, (sdk_session_id, turn["turn_id"]))
                tokens = tuple(cur.fetchone() or tokens)
            cur.execute(
                "UPDATE turns SET completed_at = now(), outcome = %s, "
                "cost_usd = COALESCE(%s, cost_usd), num_turns = COALESCE(%s, num_turns), "
                "duration_ms = COALESCE(%s, duration_ms), "
                "input_tokens = COALESCE(%s, input_tokens), "
                "cache_creation_tokens = COALESCE(%s, cache_creation_tokens), "
                "cache_read_tokens = COALESCE(%s, cache_read_tokens), "
                "output_tokens = COALESCE(%s, output_tokens), "
                "nudges = COALESCE(%s, nudges, 0) WHERE turn_id = %s"
                + (" AND completed_at IS NULL" if only_if_open else ""),
                (outcome, cost_usd, num_turns, duration_ms, *tokens, nudges, turn["turn_id"]),
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
            "input_path, decision, tool_use_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                row["turn_id"],
                row["session_id"],
                row.get("agent_id"),
                row.get("agent_type"),
                row["tool_name"],
                row.get("input_path"),
                row["decision"],
                row.get("tool_use_id"),
            ),
        )
    conn.commit()


def read_research(conn: psycopg.Connection, project_id: str) -> dict[str, Any] | None:
    """The project's research.json as the store holds it (a jsonb document), or None."""
    with conn.cursor() as cur:
        cur.execute("SELECT doc FROM documents WHERE project_id = %s AND name = 'research.json'", (project_id,))
        row = cur.fetchone()
    doc = row[0] if row else None
    return doc if isinstance(doc, dict) else None


def bump_zero_progress(conn: psycopg.Connection, turn_id: str) -> int:
    """Count this redelivered attempt as zero-progress and return the new total (0a).
    One statement on an autocommit connection, so the count survives the raise that
    follows it -- without that the next redelivery would start from zero and the loop
    the cap exists to bound would never terminate."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE turns SET zero_progress_attempts = zero_progress_attempts + 1 "
            "WHERE turn_id = %s RETURNING zero_progress_attempts",
            (turn_id,),
        )
        row = cur.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def reset_zero_progress(conn: psycopg.Connection, turn_id: str) -> None:
    """Clear the counter because this attempt did work (0a). Called at the attempt's FIRST
    tool call, not at completion: an attempt killed at the step ceiling -- or by a crash,
    a deploy or SIGTERM -- after real work never reaches completion, and must still clear
    the count."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE turns SET zero_progress_attempts = 0 "
            "WHERE turn_id = %s AND zero_progress_attempts <> 0",
            (turn_id,),
        )


# 1b: a message the patron typed while a turn was running. It is an ordinary `turns` row
# whose outcome says it has not been enqueued yet -- see 006_stop_and_queue.sql for why a
# row and not a second table, and for the cost that choice carries.
QUEUED_OUTCOME = "queued"


def stop_requested(conn: psycopg.Connection, session_id: str) -> bool:
    """Whether the patron pressed Stop on this session (1c). Read on the TURN's own
    connection, by both hooks."""
    with conn.cursor() as cur:
        cur.execute("SELECT stop_requested_at FROM sessions WHERE session_id = %s", (session_id,))
        row = cur.fetchone()
    return bool(row and row[0] is not None)


def pending_user_message(conn: psycopg.Connection, session_id: str) -> bool:
    """Whether a message is held for this session (1b). The Stop hook ALLOWS the stop when
    one is: that message becomes the next turn, and nudging the model onward would make
    the patron wait out the rest of a 53-minute job to be heard."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS (SELECT 1 FROM turns WHERE session_id = %s AND outcome = %s "
            "AND completed_at IS NULL)",
            (session_id, QUEUED_OUTCOME),
        )
        row = cur.fetchone()
    return bool(row and row[0])


# Releasing a held message IS enqueuing the session's next message, which is the exact
# condition 006_stop_and_queue.sql names for clearing the flag. Spelled the same as the
# web tier's CLEAR_STOP_SQL; `test_the_two_clear_stop_statements_match` pins them.
CLEAR_STOP_SQL = "UPDATE sessions SET stop_requested_at = NULL WHERE session_id = %s"


def take_queued_turn(conn: psycopg.Connection, session_id: str) -> dict[str, Any] | None:
    """Claim the session's oldest held message and hand back its queue body (1b).

    The UPDATE that clears the outcome IS the claim, in one statement, so two workers
    finishing turns on one session cannot both enqueue the same message. Returns None when
    nothing is held.

    AND it clears the Stop flag, because claiming IS enqueuing. 006_stop_and_queue.sql
    states the invariant -- "Cleared when the session's next message is enqueued, which is
    what makes 'a later message resumes it' true; a flag that outlived the turn would
    wedge the session" -- and the web tier's `begin_turn` deliberately does NOT clear it
    for a HELD message (clearing it there would cancel a Stop the patron pressed while the
    turn was still winding down). That left the held message as the one path to a turn
    with nobody to clear the flag: patron types mid-turn, presses Stop, the turn halts,
    the worker releases their message, and that turn halts at its FIRST tool call with
    "Stopped by the researcher." The patron's words are swallowed and the session looks
    wedged until they type again.

    `SELECT ... FOR UPDATE` above means only the claimer that wins gets here, so the clear
    happens exactly once per released message.

    ``claimed_at = now()`` dates the row from its RELEASE, not from when the patron typed
    it: the sweep's retention backstop reads ``COALESCE(claimed_at, enqueued_at)``, and a
    message held for days would otherwise look expired the moment it was released and be
    closed ``retries_exhausted`` before it ever ran. The worker's claim overwrites it."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE turns SET outcome = NULL, claimed_at = now() WHERE turn_id = ("
            "  SELECT turn_id FROM turns WHERE session_id = %s AND outcome = %s "
            "  AND completed_at IS NULL ORDER BY enqueued_at LIMIT 1 FOR UPDATE SKIP LOCKED"
            ") RETURNING message",
            (session_id, QUEUED_OUTCOME),
        )
        row = cur.fetchone()
        body = row[0] if row else None
        if body is not None:
            cur.execute(CLEAR_STOP_SQL, (session_id,))
    return body if isinstance(body, dict) else None


def hold_queued_turn(conn: psycopg.Connection, turn_id: str) -> None:
    """Put a claimed message back (1b): the enqueue failed, and losing the patron's words
    is worse than releasing it late. The next turn's completion tries again."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE turns SET outcome = %s WHERE turn_id = %s AND completed_at IS NULL",
            (QUEUED_OUTCOME, turn_id),
        )


def nudges_so_far(conn: psycopg.Connection, turn_id: str) -> int:
    """``turns.nudges`` for this turn, so a redelivery seeds the Stop hook's counter
    rather than restarting it (1c). The hook's state is created per ATTEMPT while the cap
    is meant to bound the TURN -- and since 0b makes resume the normal path, an unseeded
    cap of 60 is 60 per attempt, six times over on the longest run in the corpus."""
    with conn.cursor() as cur:
        cur.execute("SELECT nudges FROM turns WHERE turn_id = %s", (turn_id,))
        row = cur.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def record_nudge(conn: psycopg.Connection, turn_id: str, cumulative: int) -> None:
    """Persist the veto count AS IT HAPPENS (1c).

    ``complete()`` also writes this column, but only when the turn CLOSES -- and a
    redelivery happens precisely when the previous attempt did NOT close: killed at the
    step ceiling, by a crash, a deploy or SIGTERM, or failed. So a seed that read only ``complete``'s write would find NULL
    on every redelivery and hand each attempt a fresh budget: the per-attempt cap 1c
    exists to remove, six times over on the longest run in the corpus.

    ``GREATEST`` so a late write from a slower attempt cannot walk the count backwards."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE turns SET nudges = GREATEST(COALESCE(nudges, 0), %s) WHERE turn_id = %s",
            (cumulative, turn_id),
        )


def release_queued_turn(
    conn: psycopg.Connection, session_id: str, *, sqs_timeout: float = 30,
    credentials_timeout: float | None = None,
) -> str | None:
    """Enqueue the session's held message now that the turn holding it has ended (1b).
    Returns the SQS MessageId, or None when nothing was held, no queue is configured, or
    there are no SQS credentials to sign with. ``sqs_timeout`` bounds the SendMessage and
    ``credentials_timeout`` resolving the credentials (the shutdown release passes both).

    The credentials are resolved BEFORE the claim, so a worker that cannot sign leaves the
    message held rather than claiming it and putting it back.

    Never raises: a turn that did its work must not be reported as failed because the
    handover failed. A failed send puts the message back."""
    if not QUEUE_URL:
        return None
    try:
        from proto import enqueue

        ready, reason = enqueue.credentials_ready(credentials_timeout), "no AWS credentials"
    except Exception as exc:  # noqa: BLE001 - never raises
        ready, reason = False, f"{type(exc).__name__}: {exc}"
    if not ready:
        log(ev="sqs_credentials_unavailable", session_id=session_id, reason=reason)
        return None
    body = take_queued_turn(conn, session_id)
    # Committed before the send (a no-op on an autocommit connection), so the claim is
    # visible before the message it names can reach a worker.
    conn.commit()
    if body is None:
        return None
    try:
        parsed = urlparse(QUEUE_URL)
        doc = enqueue.sqs_call(
            f"{parsed.scheme}://{parsed.netloc}",
            "SendMessage",
            {"QueueUrl": QUEUE_URL, "MessageBody": json.dumps(body)},
            timeout=sqs_timeout,
        )
        return enqueue.xml_text(doc, "MessageId")
    except Exception as exc:  # noqa: BLE001 - the patron's words outlive one failed send
        log(ev="queued_release_failed", session_id=session_id, turn_id=body.get("turn_id"),
            error=f"{type(exc).__name__}: {exc}")
        hold_queued_turn(conn, str(body.get("turn_id") or ""))
        conn.commit()
        return None


# A turn is RUNNING on the session: open and not a held message. Spelled the same as the
# web tier's TURN_ACTIVE_SQL; `test_the_two_turn_active_statements_match` pins them.
TURN_ACTIVE_SQL = (
    "SELECT EXISTS (SELECT 1 FROM turns WHERE session_id = %s AND completed_at IS NULL "
    "AND outcome IS DISTINCT FROM %s) AS active"
)


def release_next_held(
    conn: psycopg.Connection, session_id: str, *, sqs_timeout: float = 30,
    credentials_timeout: float | None = None,
) -> str | None:
    """The one way the worker releases a held message (U5 D3): nothing while the session
    has a running turn, else ``release_queued_turn``. The guard is what lets the
    ``already_completed`` redelivery release a stranded held row without enqueuing a
    sibling beside a held turn that was already released and is running."""
    with conn.cursor() as cur:
        cur.execute(TURN_ACTIVE_SQL, (session_id, QUEUED_OUTCOME))
        row = cur.fetchone()
    if row and row[0]:
        return None
    return release_queued_turn(conn, session_id, sqs_timeout=sqs_timeout,
                               credentials_timeout=credentials_timeout)


def session_sdk_id(conn: psycopg.Connection, session_id: str) -> str | None:
    """The session's SDK session id if one was chosen -- for a close that runs no attempt."""
    with conn.cursor() as cur:
        cur.execute("SELECT sdk_session_id FROM sessions WHERE session_id = %s", (session_id,))
        row = cur.fetchone()
    return str(row[0]) if row and row[0] else None


def turn_outcome(conn: psycopg.Connection, turn_id: str) -> str | None:
    """``turns.outcome`` -- what a close that lost the race reports instead of its own."""
    with conn.cursor() as cur:
        cur.execute("SELECT outcome FROM turns WHERE turn_id = %s", (turn_id,))
        row = cur.fetchone()
    return str(row[0]) if row and row[0] is not None else None


def release_guarded(connect: Callable[..., Any], session_id: str, turn_id: str) -> None:
    """``release_next_held`` on its own connection, a failure logged and swallowed: the
    reply that follows must not turn into a dead letter because the handover failed."""
    try:
        with connect(PG_DSN) as conn:
            release_next_held(conn, session_id)
    except Exception as exc:  # noqa: BLE001 - the web tier's rescue is the fallback
        log(ev="release_failed", session_id=session_id, turn_id=turn_id, error=f"{type(exc).__name__}: {exc}")


def close_turn(
    conn: psycopg.Connection,
    turn: dict,
    receive_count: int,
    *,
    outcome: str = RETRIES_EXHAUSTED_OUTCOME,
    cause: str,
    sdk_session_id: str | None,
    release: bool = True,
) -> int | None:
    """Close a turn the worker is giving up on (U5 D3): ``complete(only_if_open=True)``
    with ``detail.cause``, then -- only if THIS call closed the row -- the session's next
    held message. ``release=False`` leaves the release to the caller, which SIGTERM's
    close needs: the held turn must not start while the old attempt's CLI is still
    alive. Returns the turn_done seq, or None when the row was already closed."""
    seq = complete(conn, turn, receive_count, outcome=outcome, detail={"cause": cause},
                   sdk_session_id=sdk_session_id, only_if_open=True)
    if seq is None:
        return None
    log(ev="close", turn_id=turn["turn_id"], session_id=turn["session_id"], outcome=outcome,
        cause=cause, receive_count=receive_count)
    if release:
        release_next_held(conn, turn["session_id"])
    return seq


def count_tool_calls(conn: psycopg.Connection, turn_id: str) -> int:
    """The turn's tool_calls rows so far -- every attempt's, which is what the Stop hook's
    no-progress check compares between two stops."""
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM tool_calls WHERE turn_id = %s", (turn_id,))
        row = cur.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def finish_tool_call(conn: psycopg.Connection, turn_id: str, tool_use_id: str) -> None:
    """Stamp the call's row with its wall time (Postgres clock, PreToolUse insert to
    PostToolUse update); the first stamp wins, so a redelivery's repeated id cannot
    overwrite a completed call."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE tool_calls SET duration_ms = (EXTRACT(EPOCH FROM (now() - ts)) * 1000)::int "
            "WHERE turn_id = %s AND tool_use_id = %s AND duration_ms IS NULL",
            (turn_id, tool_use_id),
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


def _apply_schema_once(
    dsn: str, *, connect_timeout: int = SCHEMA_CONNECT_TIMEOUT_S, sql_dir: Path = SQL_DIR,
) -> list[str]:
    """Run ../sql/*.sql in name order (every statement idempotent), once. Every exception
    goes through: ``schema_loop`` is what retries, and only the errors it names as transient."""
    files = sorted(sql_dir.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no schema files under {sql_dir}")
    with psycopg.connect(dsn, connect_timeout=connect_timeout) as conn:
        for path in files:
            conn.execute(path.read_text(encoding="utf-8"))
        conn.commit()
    return [p.name for p in files]


def _errno_label(exc: OSError) -> str:
    return errno.errorcode.get(exc.errno or 0, type(exc).__name__)


def check_tmpdir() -> str | None:
    """None when temp files can really be written where the CLI will write them, else a
    label (U10 D5). A set ``TMPDIR`` must be absolute and a directory, take one ``mkdtemp``
    with one byte in it, and be what Python's ``tempfile`` picks; unset, the write test
    runs on ``tempfile.gettempdir()``. A write, not ``os.access``: that says yes as root
    and on a full disk. Python falls back to /tmp silently on a bad ``TMPDIR`` while the
    CLI is handed the raw value, so the two would disagree about where temp files go."""
    raw = os.environ.get("TMPDIR")
    if raw:
        if not os.path.isabs(raw):
            return "not_absolute"
        if not os.path.isdir(raw):
            return "ENOTDIR" if os.path.exists(raw) else "ENOENT"
    target = raw or tempfile.gettempdir()
    try:
        probe = tempfile.mkdtemp(prefix="worker-tmpcheck-", dir=target)
        try:
            with open(os.path.join(probe, "probe"), "wb") as fh:
                fh.write(b"\0")
        finally:
            shutil.rmtree(probe, ignore_errors=True)
    except OSError as exc:
        return _errno_label(exc)
    if raw and tempfile.gettempdir() != os.path.abspath(raw):
        return "fallback"
    return None


# U12 D27: the plugin hook (guard_project_files.py) needs 3.10+ and fails open on 3.9,
# which is Beanstalk's /usr/bin/python3.
HOOK_PYTHON_MIN = (3, 10)
HOOK_PYTHON_TIMEOUT_S = 10
_VERSION_PROBE = 'import sys; print("%d.%d.%d" % tuple(sys.version_info[:3]))'


def check_hook_python(exe_dir: str, path: str | None) -> tuple[str | None, str | None, str | None]:
    """``(python3, version, error)`` for the ``python3`` the CLI child's hooks will run: the
    one first on the ``PATH`` ``options.build_worker_options`` gives the child
    (``hook_path``). ``error`` is a label -- ``missing``, ``unreadable`` or ``too_old`` --
    or None when that interpreter is ``HOOK_PYTHON_MIN`` or newer."""
    exe = shutil.which("python3", path=hook_path(exe_dir, path))
    if exe is None:
        return None, None, "missing"
    try:
        out = subprocess.run([exe, "-c", _VERSION_PROBE], capture_output=True, text=True,
                             encoding="utf-8", timeout=HOOK_PYTHON_TIMEOUT_S, check=True).stdout
        version = tuple(int(part) for part in out.strip().split("."))
    except (OSError, ValueError, subprocess.SubprocessError):
        return exe, None, "unreadable"
    label = ".".join(str(part) for part in version)
    if version[:2] < HOOK_PYTHON_MIN:
        return exe, label, "too_old"
    return exe, label, None


def require_hook_python(exe_dir: str | None = None, path: str | None = None) -> str:
    """``"<python3> <version>"`` for ``ev=start``; a refusal logs ``ev=prepare
    step=hook_python`` and exits 2. Static instance configuration, like ``TMPDIR``."""
    if exe_dir is None:
        exe_dir = os.path.dirname(sys.executable)
    if path is None:
        path = os.environ.get("PATH")
    exe, version, error = check_hook_python(exe_dir, path)
    if error is not None:
        log(ev="prepare", step="hook_python", error=error, python3=exe, version=version)
        raise SystemExit(2)
    return f"{exe} {version}"


def tmpdir_free_mb() -> int | None:
    """Free MB under the temp dir, for the start line; no threshold until U13 measures it."""
    try:
        st = os.statvfs(tempfile.gettempdir())
    except (AttributeError, OSError):
        return None
    return int(st.f_bavail * st.f_frsize // (1024 * 1024))


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
    """Everything a real turn needs that touches no network, done once; a failure is
    logged, fails only the real turns (the stub arms keep working) and fails /healthz.
    The schema is applied after listen, by ``start_schema_thread``."""
    global _AGENTS, _AGENTS_ERROR, _BLOCKED, _AUTONOMOUS_MAX_NUDGES
    try:
        ensure_cwd(WORKER_CWD)
    except OSError as exc:
        log(ev="prepare", step="cwd", error=f"{type(exc).__name__}: {exc}", cwd=WORKER_CWD)
    _AGENTS, _AGENTS_ERROR = load_plugin_agents(ENGINE_PLUGIN_DIR)
    _BLOCKED = parse_blocked_tools(os.environ.get("BLOCKED_TOOLS"))
    try:
        _AUTONOMOUS_MAX_NUDGES = parse_max_nudges(os.environ.get("AUTONOMOUS_MAX_NUDGES"))
    except ValueError as exc:
        _AUTONOMOUS_MAX_NUDGES = 0
        log(ev="prepare", step="nudges", error=f"{type(exc).__name__}: {exc}")
    try:
        from claude_agent_sdk._cli_version import __cli_version__ as cli_version
    except Exception:  # noqa: BLE001
        cli_version = None
    log(
        ev="prepare", step="agents", agents=sorted(_AGENTS or {}),
        skills_on_disk=count_skills(ENGINE_PLUGIN_DIR), skills_expected=EXPECTED_SKILLS,
        blocked_tools=sorted(_BLOCKED), autonomous_max_nudges=_AUTONOMOUS_MAX_NUDGES,
        error=_AGENTS_ERROR, plugin_dir=ENGINE_PLUGIN_DIR,
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


def pg_connect(*args: Any, **kwargs: Any) -> psycopg.Connection:
    """``psycopg.connect``, looked up per call: the ``connect=`` defaults below bind this,
    so replacing ``psycopg.connect`` (test_proto_shutdown's harness) reaches every one."""
    return psycopg.connect(*args, **kwargs)


# -- readiness (U10) -----------------------------------------------------------

# Process state /healthz reports; the tests' autouse fixture resets each to this value.
# The start schema apply: None once applied, "pending" until then, else the label of the
# error that stopped it.
_SCHEMA_ERROR: str | None = "pending"
# "no_entries" after a transcript_lost turn (D6), cleared by the next model turn that
# appends entries. Per instance, because the cause is this instance's configuration.
_TRANSCRIPT_ERROR: str | None = None
# Each check's last outcome, so a down store probed every 5 s writes one log line.
_READY_LAST: dict[str, bool] = {}
# The one Postgres probe in flight, shared by every /healthz thread until its probe thread
# exits: a caller arriving after the race was lost gets that TimeoutError, not a new
# connection.
_READY_LOCK = threading.Lock()
_READY_FLIGHT: dict[str, Any] | None = None

READY_SQL = (
    "SELECT t FROM unnest(%s::text[]) t WHERE to_regclass(t) IS NULL "
    "UNION ALL SELECT f FROM unnest(%s::text[]) f WHERE to_regprocedure(f) IS NULL"
)
_DSN_CREDENTIALS = re.compile(r"\b[\w.+-]+://[^\s@/]*@")


class ReadyCheckError(Exception):
    """A readiness failure whose label is not an error code or type name."""

    def __init__(self, label: str, message: str) -> None:
        super().__init__(message)
        self.label = label


def ready_label(exc: BaseException) -> str:
    """What a failed check reports: the SQLSTATE when there is one (``28P01``,
    ``42501``), else the type name. Never ``str(exc)``: /healthz is unauthenticated, and
    psycopg's message carries the host, the port and the user."""
    if isinstance(exc, ReadyCheckError):
        return exc.label
    sqlstate = getattr(exc, "sqlstate", None)
    return str(sqlstate) if sqlstate else type(exc).__name__


def redact(text: str) -> str:
    """A message for the log, with any ``scheme://user:password@`` taken out."""
    return _DSN_CREDENTIALS.sub("", text)


def note_check(name: str, check: dict[str, Any], detail: str = "") -> None:
    """One ``ev=health`` line on the first probe and on every ok/fail change."""
    with _READY_LOCK:
        changed = _READY_LAST.get(name) is not check["ok"]
        _READY_LAST[name] = check["ok"]
    if changed:
        log(ev="health", check=name, ok=check["ok"],
            error=None if check["ok"] else (detail or check.get("error")))


def _probe_postgres_once(dsn: str) -> None:
    """A fresh connection (never a turn's), and every worker table and function present."""
    with psycopg.connect(dsn, connect_timeout=READY_CONNECT_TIMEOUT_S,
                         options=f"-c statement_timeout={READY_STATEMENT_TIMEOUT_MS}",
                         **READY_TCP_OPTIONS) as conn:
        with conn.cursor() as cur:
            cur.execute(READY_SQL, (list(WORKER_TABLES), list(WORKER_FUNCTIONS)))
            missing = [str(row[0]) for row in cur.fetchall()]
    if missing:
        names = ",".join(missing)
        raise ReadyCheckError(f"schema: missing {names}", f"worker tables or functions missing: {names}")


def probe_postgres(dsn: str, timeout_s: float | None = None) -> dict[str, Any]:
    """The ``postgres`` check, raced against ``timeout_s`` (``READY_TIMEOUT_S``, read per
    call): the probe runs on a daemon thread and a loss reports ``TimeoutError``, the
    loser finishing in the background inside ``READY_TCP_OPTIONS`` and its connect and
    statement timeouts. Every caller shares the one probe until its thread exits, so a
    stalled host costs one connection however often /healthz is asked."""
    global _READY_FLIGHT
    timeout_s = READY_TIMEOUT_S if timeout_s is None else timeout_s
    with _READY_LOCK:
        flight = _READY_FLIGHT
        owner = flight is None
        if owner:
            flight = _READY_FLIGHT = {"raced": threading.Event(), "check": None,
                                      "returned": False, "exited": False}
    if not owner:
        flight["raced"].wait(timeout_s + 1)
        return dict(flight["check"] or {"ok": False, "error": "TimeoutError"})

    def release_if_finished() -> None:
        # Under _READY_LOCK. The slot goes when both the race is answered and the thread
        # has exited, whichever is last.
        global _READY_FLIGHT
        if flight["returned"] and flight["exited"] and _READY_FLIGHT is flight:
            _READY_FLIGHT = None

    try:
        done = threading.Event()
        box: dict[str, Any] = {}

        def target() -> None:
            try:
                _probe_postgres_once(dsn)
                box["check"] = {"ok": True}
            except Exception as exc:  # noqa: BLE001 - every failure is a label
                box["check"] = {"ok": False, "error": ready_label(exc)}
                box["detail"] = redact(f"{type(exc).__name__}: {exc}")
            finally:
                with _READY_LOCK:
                    flight["exited"] = True
                    release_if_finished()
                done.set()

        thread = threading.Thread(target=target, daemon=True, name="ready-postgres")
        try:
            thread.start()
        except BaseException:
            flight["exited"] = True
            raise
        if done.wait(timeout_s):
            check, detail = box["check"], box.get("detail", "")
        else:
            check, detail = {"ok": False, "error": "TimeoutError"}, f"no answer within {timeout_s}s"
        flight["check"] = check
        note_check("postgres", check, detail)
        return dict(check)
    finally:
        with _READY_LOCK:
            flight["returned"] = True
            release_if_finished()
        flight["raced"].set()


def _agents_label(error: str | None) -> str:
    if not error:
        return "not_loaded"
    return "mismatch" if error.startswith("plugin agents") else error.split(":", 1)[0]


def _dir_label(path: str) -> str | None:
    if os.path.isdir(path):
        return None
    return "ENOTDIR" if os.path.exists(path) else "ENOENT"


def readiness() -> dict[str, Any]:
    """``/healthz``'s report: ``{ok, checks}``, every ``error`` a label (D2). Not checked:
    the tools service (``proto-up-core`` runs without it), the model key, S3 (the worker
    has no S3 client)."""
    checks = {"postgres": probe_postgres(PG_DSN)}
    local = {
        "schema": (_SCHEMA_ERROR, ""),
        "agents": (None if _AGENTS is not None else _agents_label(_AGENTS_ERROR), _AGENTS_ERROR or ""),
        "cwd": (_dir_label(WORKER_CWD), WORKER_CWD),
        "tmpdir": (check_tmpdir(), os.environ.get("TMPDIR") or ""),
        "transcript": (_TRANSCRIPT_ERROR, ""),
    }
    for name, (label, detail) in local.items():
        check = {"ok": True} if label is None else {"ok": False, "error": label}
        note_check(name, check, f"{label}: {detail}" if label and detail else "")
        checks[name] = check
    return {"ok": all(c["ok"] for c in checks.values()), "checks": checks}


def schema_loop(dsn: str | None = None) -> None:
    """Apply the schema, retrying ``psycopg.OperationalError`` (a refused or silent
    Postgres) and the errors an apply racing another one raises (the web tier, or a second
    worker, applies the same files at boot: ``23505`` and ``42P07``/``42710`` on a fresh
    database, ``XX000`` "tuple concurrently updated" on an applied one; the next attempt
    finds the schema in place), with backoff ``SCHEMA_BACKOFF_FIRST_S`` doubling to
    ``SCHEMA_BACKOFF_MAX_S``, taken as ``SHUTDOWN.wait`` so a SIGTERM ends it at once. Any
    other error (bad SQL, ``42501`` under a DML-only role) is a misconfiguration: it stops
    the loop and leaves ``schema`` failing with its label. One log line per change."""
    global _SCHEMA_ERROR
    dsn = PG_DSN if dsn is None else dsn
    delay = SCHEMA_BACKOFF_FIRST_S
    logged: str | None = None
    while True:
        try:
            applied = _apply_schema_once(dsn, connect_timeout=SCHEMA_CONNECT_TIMEOUT_S)
        except (psycopg.OperationalError, psycopg.errors.UniqueViolation, psycopg.errors.InternalError_,
                psycopg.errors.DuplicateTable, psycopg.errors.DuplicateObject) as exc:
            label = ready_label(exc)
            if label != logged:
                logged = label
                log(ev="prepare", step="schema", error=redact(f"{type(exc).__name__}: {exc}"), retrying=True)
        except Exception as exc:  # noqa: BLE001 - reported, and /healthz answers 503
            _SCHEMA_ERROR = ready_label(exc)
            log(ev="prepare", step="schema", error=redact(f"{type(exc).__name__}: {exc}"), retrying=False)
            return
        else:
            _SCHEMA_ERROR = None
            log(ev="prepare", step="schema", applied=applied)
            return
        if SHUTDOWN.wait(delay):
            return
        delay = min(delay * 2, SCHEMA_BACKOFF_MAX_S)


def start_schema_thread() -> threading.Thread:
    """``schema_loop`` after listen, on a daemon that watches SHUTDOWN: a thread retrying
    against a down Postgres must not hold the interpreter open past main()'s return.
    An attempt already inside ``connect`` is bounded by ``SCHEMA_CONNECT_TIMEOUT_S``."""
    thread = threading.Thread(target=schema_loop, daemon=True, name="schema")
    thread.start()
    return thread


# -- shutdown (U5 D2) ----------------------------------------------------------

# Set once by SIGTERM / SIGINT. Read by every POST, by run_turn just inside its cancel
# scope, and by the sweep, which stops.
SHUTDOWN = threading.Event()


class Inflight:
    """One ``POST /turn`` this process is serving: what the shutdown thread wakes, cancels
    and waits for."""

    def __init__(self, turn_id: str) -> None:
        self.turn_id = turn_id
        self.replied = threading.Event()
        self.attempt_done = threading.Event()
        self.attempt_done.set()
        self.wake = threading.Event()
        self.cancel: tuple[asyncio.AbstractEventLoop, anyio.CancelScope] | None = None


_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT: set[Inflight] = set()
_ATTEMPT = threading.local()  # .entry: the Inflight whose attempt this thread runs
_ANSWERED: list[str] = []  # turn ids the shutdown answered 500 (redelivered), for ev=shutdown
# session id -> (turn id, the Inflight entries serving that turn when the release was
# deferred): the release runs only once every one of those attempts has finished.
_DEFERRED_RELEASES: dict[str, tuple[str, list[Inflight]]] = {}
_SHUTDOWN_THREAD: threading.Thread | None = None  # joined by main() before it returns


def _retire(entry: Inflight) -> None:
    with _INFLIGHT_LOCK:
        if entry.replied.is_set() and entry.attempt_done.is_set():
            _INFLIGHT.discard(entry)


@contextlib.contextmanager
def track(turn_id: str) -> Iterator[Inflight]:
    """Register a POST for the shutdown thread until its reply is written (the block
    exits) and its attempt, if one started, has finished."""
    entry = Inflight(turn_id)
    with _INFLIGHT_LOCK:
        _INFLIGHT.add(entry)
    try:
        yield entry
    finally:
        entry.replied.set()
        _retire(entry)


def inflight_turn_ids() -> list[str]:
    with _INFLIGHT_LOCK:
        return sorted({e.turn_id for e in _INFLIGHT})


@contextlib.contextmanager
def cancellable_attempt() -> Iterator[anyio.CancelScope]:
    """run_turn's body runs inside this anyio scope. The shutdown thread cancels it with
    ``loop.call_soon_threadsafe(scope.cancel)`` -- an anyio cancel, which the SDK's
    shielded ``close()`` defers until its SIGTERM-then-SIGKILL escalation has run; a bare
    ``task.cancel()`` would skip that. The scope is registered FIRST and SHUTDOWN checked
    after, so a SIGTERM landing between the two is seen by one side or the other and no
    CLI spawns after shutdown."""
    entry = getattr(_ATTEMPT, "entry", None)
    with anyio.CancelScope() as scope:
        if entry is not None:
            with _INFLIGHT_LOCK:
                entry.cancel = (asyncio.get_running_loop(), scope)
        if SHUTDOWN.is_set():
            raise WorkerShutdown("worker shutting down before the attempt started")
        yield scope
    if scope.cancelled_caught:
        raise WorkerShutdown("attempt cancelled by worker shutdown")


def await_attempt(entry: Inflight, fn: Callable[[], Any]) -> tuple[str, Any]:
    """Run ``fn`` on a DAEMON thread and wait for it or for SHUTDOWN, whichever is first:
    ``("done", result)``, ``("error", exc)`` or ``("shutdown", None)``. A daemon, so an
    attempt that cannot be cancelled cannot hold the interpreter open past the grace."""
    box: dict[str, Any] = {}

    def target() -> None:
        _ATTEMPT.entry = entry
        try:
            box["result"] = fn()
        except BaseException as exc:  # noqa: BLE001 - handed to the waiting handler
            box["error"] = exc
        finally:
            box["done"] = True
            entry.attempt_done.set()
            entry.wake.set()
            _retire(entry)

    entry.attempt_done.clear()
    threading.Thread(target=target, daemon=True, name=f"attempt-{entry.turn_id}").start()
    entry.wake.wait()
    if not box.get("done"):
        return "shutdown", None
    if "error" in box:
        return "error", box["error"]
    return "done", box.get("result")


def request_shutdown() -> list[Inflight]:
    """Set SHUTDOWN, wake every waiting handler (each answers at once) and cancel every
    registered attempt. Returns the entries it saw."""
    SHUTDOWN.set()
    with _INFLIGHT_LOCK:
        entries = list(_INFLIGHT)
    for entry in entries:
        entry.wake.set()
    for entry in entries:
        if entry.cancel is None:
            continue
        loop, scope = entry.cancel
        try:
            loop.call_soon_threadsafe(scope.cancel)
        except RuntimeError:  # the loop already closed: the attempt finished
            pass
    return entries


def _wait_for_inflight(deadline: float) -> bool:
    """Every tracked POST has written its reply and every attempt's ``finally`` has run,
    or the deadline passed. Re-read each round, so a POST that arrived mid-shutdown is
    waited for too."""
    while True:
        with _INFLIGHT_LOCK:
            pending = [e for e in _INFLIGHT if not (e.replied.is_set() and e.attempt_done.is_set())]
        if not pending:
            return True
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        first = pending[0]
        (first.attempt_done if first.replied.is_set() else first.replied).wait(min(remaining, 0.1))


def defer_release(session_id: str, turn_id: str) -> None:
    """Hand a last-receive close's release to the shutdown thread, which runs it only once
    every attempt this process is running for ``turn_id`` has finished."""
    with _INFLIGHT_LOCK:
        waits = [e for e in _INFLIGHT if e.turn_id == turn_id]
        if session_id in _DEFERRED_RELEASES:
            _DEFERRED_RELEASES[session_id][1].extend(waits)
        else:
            _DEFERRED_RELEASES[session_id] = (turn_id, waits)


def deferred_sessions() -> list[str]:
    with _INFLIGHT_LOCK:
        return list(_DEFERRED_RELEASES)


def run_deferred_releases(*, connect=pg_connect, deadline: float | None = None) -> None:
    """Release every deferred session whose attempts have finished; one whose attempt is
    still running stays registered for a later round. A release starts only if its capped
    connect and send can finish by ``deadline``; past it the session is logged
    ``deferred_release_skipped`` and left held for the web tier's rescue."""
    with _INFLIGHT_LOCK:
        ready = [(sid, turn_id) for sid, (turn_id, waits) in _DEFERRED_RELEASES.items()
                 if all(e.attempt_done.is_set() for e in waits)]
        for sid, _ in ready:
            del _DEFERRED_RELEASES[sid]
    for session_id, turn_id in ready:
        if deadline is not None and (time.monotonic() + RELEASE_CONNECT_TIMEOUT_S
                                     + RELEASE_CREDENTIALS_TIMEOUT_S + RELEASE_SQS_TIMEOUT_S > deadline):
            log(ev="deferred_release_skipped", session_id=session_id, turn_id=turn_id, reason="deadline")
            continue
        try:
            with connect(PG_DSN, connect_timeout=RELEASE_CONNECT_TIMEOUT_S) as conn:
                release_next_held(conn, session_id, sqs_timeout=RELEASE_SQS_TIMEOUT_S,
                                  credentials_timeout=RELEASE_CREDENTIALS_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 - the web tier's rescue is the fallback
            log(ev="deferred_release_failed", session_id=session_id, turn_id=turn_id,
                error=f"{type(exc).__name__}: {exc}")


def shutdown(server: Any, *, grace: float | None = None, connect=pg_connect) -> None:
    """The shutdown thread: answer, cancel, wait (bounded by SHUTDOWN_GRACE_S), run the
    releases a last-receive close deferred, stop the server -- then, since a POST accepted
    before ``serve_forever`` exited can still be running, wait and release once more,
    and log ``ev=shutdown``. A deferred release whose attempt never finished is logged
    ``deferred_release_skipped`` and left held: the held turn must not start beside the
    old CLI. ``server.shutdown()`` cannot be called from the ``serve_forever`` thread,
    which is why this is a thread and not the signal handler; main() joins it."""
    grace = SHUTDOWN_GRACE_S if grace is None else grace
    started = time.monotonic()
    release_deadline = started + grace + RELEASE_BUDGET_S
    request_shutdown()
    _wait_for_inflight(started + grace)
    run_deferred_releases(connect=connect, deadline=release_deadline)
    server.shutdown()
    drained = _wait_for_inflight(started + grace)
    run_deferred_releases(connect=connect, deadline=release_deadline)
    with _INFLIGHT_LOCK:
        answered = list(_ANSWERED)
        stranded = list(_DEFERRED_RELEASES.items())
        _DEFERRED_RELEASES.clear()
    for session_id, (turn_id, _) in stranded:
        log(ev="deferred_release_skipped", session_id=session_id, turn_id=turn_id, reason="attempt_running")
    log(ev="shutdown", answered=answered, drained=drained, still_running=inflight_turn_ids(),
        wait_ms=int((time.monotonic() - started) * 1000))


def install_signal_handlers(server: Any) -> None:
    """SIGTERM / SIGINT set SHUTDOWN and start the shutdown thread, once."""

    def on_signal(signum: int, frame: Any) -> None:
        global _SHUTDOWN_THREAD
        if SHUTDOWN.is_set():
            return
        SHUTDOWN.set()
        _SHUTDOWN_THREAD = threading.Thread(target=shutdown, args=(server,), daemon=True, name="shutdown")
        _SHUTDOWN_THREAD.start()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)


# -- the real turn -------------------------------------------------------------


def attempt_prompts(text: str, resume: str | None) -> tuple[str, ...]:
    """Every prompt this attempt MAY send, in order: the turn's own text, and -- on a
    resumed session -- one continue prompt. WHETHER the second is sent is
    ``resume_produced_no_turn``'s decision, checked between the two; this is the ceiling,
    not the trigger, and the two are deliberately not both arming conditions.

    The bound on re-queries is the LENGTH OF THIS TUPLE. run_turn iterates it and
    breaks early; there is no loop whose condition a second zero-turn result could
    extend, so the pathological case (a turn that genuinely has nothing to add, which
    answers every continue prompt with another zero-turn result) logs
    ``resume_synthetic_result`` twice and completes. A worker that bills money
    unattended must not be able to spin.
    """
    return (text, RESUME_CONTINUE_TEXT) if resume else (text,)


def resume_produced_no_turn(result: Any, resume: str | None, receive_count: int) -> bool:
    """A REDELIVERED attempt (``receive_count`` > 1) that resumed an existing SDK session
    and whose ResultMessage carries no model turn: the CLI answered its own meta prompt
    about the interrupted work with a synthetic no-response reply and returned (D17, and
    the D18 autonomous run), so the work the kill interrupted was never redone. On a
    FIRST delivery -- of any turn, including one whose session already holds entries --
    and on a fresh session, a zero-turn result is not this shape and completes as it
    stands."""
    return (
        bool(resume)
        and receive_count > 1
        and int(getattr(result, "num_turns", 0) or 0) == 0
    )


def turn_max_nudges(message: Any, fallback: int) -> int:
    """The Stop hook's veto cap for THIS turn (1a): the queue body's ``max_nudges`` when
    the web tier stamped one, else the worker's own ``AUTONOMOUS_MAX_NUDGES``.

    The body wins because ONE worker serves the browser and ``make proto-demo``, and it
    has no way to tell them apart -- there is no browser path it can see. Each recipe
    recreates the WEB container with its own export instead, and the value rides the
    message.

    The fallback covers a message enqueued before this field existed (``proto/drive.py``'s
    rows, and anything already on the queue at upgrade), which must not start behaving
    differently just because the worker was restarted. A negative or unparsable value
    takes the fallback too: silently disabling the Stop hook is the invisible failure this
    whole item exists to remove."""
    raw = message.get("max_nudges") if isinstance(message, dict) else None
    if raw is None or isinstance(raw, bool):
        return fallback
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return fallback
    return n if n >= 0 else fallback


def attempt_did_work(result: Any, tool_calls: int) -> bool:
    """Whether THIS attempt moved the turn forward (0a). Both signals must be positive.

    The plan states the negation: a redelivered attempt did no work when
    ``num_turns == 0``, *or* it added no ``tool_calls`` rows. The first is the D17
    synthetic result -- the CLI answered its own meta prompt about the orphaned agents and
    returned, so the interrupted work was never redone. The second is the attempt that
    billed model turns and wrote nothing: every change to the project goes through a
    writer TOOL, so a pass with no tool call changed nothing, and under continuous work
    that is a stall rather than a short answer.

    A caller applies this on a REDELIVERY only. On a first delivery a short, tool-free
    answer is an ordinary turn and completes as it stands."""
    return int(getattr(result, "num_turns", 0) or 0) > 0 and tool_calls > 0


async def run_turn(
    turn: dict,
    receive_count: int,
    sdk_session_id: str,
    *,
    agents: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One attempt, inside the cancel scope SIGTERM's shutdown thread cancels (U5 D2)."""
    with cancellable_attempt():
        return await _run_turn(turn, receive_count, sdk_session_id, agents=agents)


async def _run_turn(
    turn: dict,
    receive_count: int,
    sdk_session_id: str,
    *,
    agents: dict[str, Any] | None = None,
) -> dict[str, Any]:
    global _TRANSCRIPT_ERROR
    from claude_agent_sdk import ClaudeSDKClient, MirrorErrorMessage, ResultMessage

    from app.agent.real_agent import TRANSIENT_KINDS, map_message

    agents = require_agents() if agents is None else agents
    message = turn["message"]
    turn_id, session_id, project_id = turn["turn_id"], turn["session_id"], turn["project_id"]
    text = str(message["text"])
    ensure_cwd(WORKER_CWD)

    started = time.monotonic()
    counters = {"events": 0, "activity": 0, "tool_calls": 0, "nudges": 0}
    # Set by the Stop hook when it ALLOWS a stop (1b/1c); None means the turn just ended.
    terminal: dict[str, Any] = {"reason": None}
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
            if counters["tool_calls"] == 1 and receive_count > 1:
                # 0a: this attempt has done work. Clear the zero-progress count HERE
                # rather than at completion -- an attempt killed at the step ceiling, or
                # by a crash, a deploy or SIGTERM, after real work never reaches
                # completion, and the stale count would then terminate a healthy turn
                # two redeliveries later.
                reset_zero_progress(conn, turn_id)

        # 1c: the halt predicate, checked before EVERY tool call. The Stop hook fires at
        # a voluntary yield -- a median of once per run -- so a Stop wired to it would
        # answer after 53 minutes. This one answers in a median of 2.6 s.
        def halt() -> str | None:
            if stop_requested(conn, session_id):
                terminal["reason"] = TERMINAL_STOPPED
                terminal["halted"] = True
                return STOP_REASON
            # 1b: a message the patron typed mid-turn.
            #
            # DEVIATION from the plan, stated here because it is one: the plan wires
            # `pending_user_message()` into the STOP hook only. But its own measurement
            # says the model yields a median of ONCE per run and 31% of runs never yield
            # at all -- the same figure it uses to rule out a yield-gated Stop -- so a
            # message that waited for a yield would sit unanswered for the rest of a
            # 53-minute job while the UI said "picked up at the next step". The Stop-hook
            # clause stays; this is a second carrier on the path that fires every few
            # seconds. Both read the same row.
            #
            # `counters["tool_calls"]` guards the degenerate case: two messages typed in
            # quick succession are held together, so without it the turn released for the
            # first one would halt at its own first tool call and do no work on it at all.
            # One call is enough to break that chain, and costs at most one step of
            # latency on the handover.
            if counters["tool_calls"] >= 1 and pending_user_message(conn, session_id):
                terminal["reason"] = TERMINAL_QUEUED
                terminal["halted"] = True
                log(ev="handover", turn_id=turn_id, session_id=session_id)
                return HANDOVER_REASON
            # U10 D6: the transcript is not reaching the store (eager flush appends after
            # every frame, and the prompt's own frame is sent before the first model
            # response), so stop now rather than pay for a whole run the post-loop check
            # will close transcript_lost anyway. Keyed on ``append`` (counted on entry,
            # before any I/O), not ``entries_appended`` (counted after the commit): a
            # dropped frame never calls append, a failed one is MirrorError, and a slow
            # one must not halt a healthy turn. Before the spend clause: a hook that
            # raises allows the call, so nothing after a raising clause runs.
            if (counters["tool_calls"] >= TRANSCRIPT_LOST_AFTER_TOOL_CALLS
                    and store.calls["append"] == 0):
                terminal["reason"] = TRANSCRIPT_LOST_OUTCOME
                terminal["halted"] = True
                log(ev="transcript_lost_halt", turn_id=turn_id, session_id=session_id,
                    tool_calls=counters["tool_calls"])
                return TRANSCRIPT_LOST_REASON
            # 1e: the spend bound, enforced HERE for the same reason Stop is -- this hook
            # fires every few seconds, where a yield-gated check fires about once a run.
            if SPEND_CAP_USD > 0:
                spent = session_spend_usd(conn, sdk_session_id)
                if spent >= SPEND_CAP_USD:
                    terminal["reason"] = TERMINAL_BUDGET
                    terminal["halted"] = True
                    terminal["limit"] = "spend"
                    terminal["spent_usd"] = round(spent, 4)
                    log(ev="spend_cap", turn_id=turn_id, session_id=session_id,
                        spent_usd=round(spent, 4), cap_usd=SPEND_CAP_USD)
                    return SPEND_CAP_REASON.format(cap=SPEND_CAP_USD)
            return None

        hook = make_pretool_hook(
            turn_id=turn_id, session_id=session_id, cwd=WORKER_CWD,
            config_root=lambda: config_root["path"], record=record, log=log, blocked=_BLOCKED,
            halt=halt,
        )

        def finish(tool_use_id: str) -> None:
            finish_tool_call(conn, turn_id, tool_use_id)

        posttool = make_posttool_hook(turn_id=turn_id, finish=finish, log=log)

        stop_hook = None
        max_nudges = turn_max_nudges(message, _AUTONOMOUS_MAX_NUDGES)
        if max_nudges > 0:

            def on_nudge(n: int) -> None:
                # `n` is the hook's CUMULATIVE count -- seeded from the row on a
                # redelivery -- not this attempt's tally, so the column spans the turn.
                counters["nudges"] = n
                record_nudge(conn, turn_id, n)
                log(ev="nudge", turn_id=turn_id, n=n, max=max_nudges)

            def on_allow(reason: str) -> None:
                # The Stop hook let the turn end; this is WHY, and it is what complete()
                # writes. Without it every ending is 'ok' and a budget-capped run is
                # indistinguishable from a finished one.
                #
                # It must not CLOBBER a reason the halt path already set. A turn halted by
                # the spend cap that then sees a Stop dispatch would otherwise be recorded
                # as whatever the Stop hook made of it -- most likely `no_progress`, which
                # tells the patron the opposite of what happened.
                if terminal["reason"] is None:
                    terminal["reason"] = reason
                log(ev="terminal", turn_id=turn_id, session_id=session_id, reason=reason,
                    recorded=terminal["reason"])

            stop_hook = make_stop_hook(
                turn_id=turn_id, max_nudges=max_nudges,
                research=lambda: read_research(conn, project_id),
                tool_count=lambda: count_tool_calls(conn, turn_id),
                on_nudge=on_nudge, log=log,
                # `halted` is the load-bearing half, and it is NOT the same question as
                # `stop_requested`. The PreToolUse hook halts on the patron's Stop AND on
                # 1e's spend cap; only the first raises a row. If a halt then dispatches a
                # Stop -- which the plan lists as unmeasured -- this hook would find an
                # unfinished project with budget left and VETO the halt, and the run would
                # carry straight on past the spend bound. Reading the turn's own decision
                # makes that impossible either way the measurement lands.
                stopped=lambda: bool(terminal.get("halted")) or stop_requested(conn, session_id),
                pending_user_message=lambda: pending_user_message(conn, session_id),
                # Phase 3 writes the row this will read; until then the agent has no way
                # to ask, so the clause exists and never fires. Built now so the shape is
                # settled and phase 3 is a query, not a redesign.
                pending_decision=lambda: False,
                on_allow=on_allow,
                # 1c: seed from the row, or the cap is per ATTEMPT and 0b made resume the
                # normal path -- median two attempts, longest six.
                nudges_used=nudges_so_far(conn, turn_id) if receive_count > 1 else 0,
            )
        options = build_worker_options(
            project_id=project_id,
            cwd=WORKER_CWD,
            plugin_dir=ENGINE_PLUGIN_DIR,
            agents=agents,
            store=store,
            config_dir=config_dir,
            pretool_hook=hook,
            posttool_hook=posttool,
            resume=resume,
            session_id=None if resume else sdk_session_id,
            fs_access_token=message.get("fs_access_token"),
            stderr=lambda line: log(ev="cli_stderr", turn_id=turn_id, line=line[:500]),
            stop_hook=stop_hook,
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

            tool_names: dict[str, str] = {}
            tasks: dict[str, str] = {}
            live: set[str] = set()

            async def receive(*, require_init: bool) -> Any:
                """One query's message stream: every event written as it arrives, every
                guard applied, the ResultMessage returned. ``require_init`` holds on the
                attempt's FIRST query only -- a connected client declares no session
                again, so requiring it on a re-query would fail every one of them."""
                saw_init = False
                pass_result: Any = None
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
                        pass_result = msg
                if require_init and not saw_init:
                    # Without this the session-id assertion above fails open: a CLI whose init
                    # message stopped matching would run unverified and pass.
                    raise RuntimeError("the CLI never declared its session (no system/init message)")
                if pass_result is None:
                    raise RuntimeError("message stream ended without a ResultMessage")
                if pass_result.is_error:
                    raise RuntimeError(
                        f"ResultMessage is_error ({pass_result.subtype}"
                        f"{', api ' + str(pass_result.api_error_status) if pass_result.api_error_status else ''}): "
                        f"{'; '.join(pass_result.errors or []) or pass_result.result or 'no detail'}"
                    )
                return pass_result

            for index, prompt in enumerate(attempt_prompts(text, resume)):
                await client.query(prompt)
                result = await receive(require_init=index == 0)
                if not resume_produced_no_turn(result, resume, receive_count):
                    break
                log(ev="resume_synthetic_result", turn_id=turn_id, session_id=session_id,
                    receive_count=receive_count, query=index + 1,
                    result=str(result.result or "")[:200])

            # U10 D6: a model turn that appended nothing. The SDK flushes every pending
            # frame before it yields each ResultMessage, so the count is final here. The
            # halt clause's reason is read too: a frame can still land after the halt,
            # before the result, and keyed on the count alone that cut-off turn would
            # answer 200 unflagged.
            # num_turns == 0 with no halt is D17's synthetic result, left to 0a.
            transcript_lost = (
                terminal["reason"] == TRANSCRIPT_LOST_OUTCOME
                or (int(result.num_turns or 0) > 0 and store.calls["entries_appended"] == 0)
            )

            # 0a. A REDELIVERED attempt that did no work has not redone the work the kill
            # interrupted, so completing it records a half-finished run as finished --
            # exactly what PR #2695's acceptance run did on 2026-09-20, in 10 ms, leaving
            # project.status active. Count it and FAIL the attempt so the shim redelivers.
            #
            # The cap is what makes that safe to do. The cause is a property of the stored
            # transcript, re-fed on every resume, so if it is deterministic a bare retry is
            # an unbounded PAID loop: serve_real_turn answers any raise 500, decide.py
            # requeues every non-2xx, and elasticmq deliberately has no redrive policy.
            # At the cap the worker therefore stops raising and closes the turn itself,
            # 200, with an outcome that says what happened -- because a terminal failure
            # surfaced as an error is redelivered and re-runs the model forever.
            # 1b/1c: what the browser renders for this ending. The Stop hook's verdict
            # wins when it fired; a turn halted by the PreToolUse hook may never reach a
            # Stop dispatch at all, so the flag is re-read here rather than assumed.
            outcome = TRANSCRIPT_LOST_OUTCOME if transcript_lost else (
                terminal["reason"]
                or (TERMINAL_STOPPED if stop_requested(conn, session_id) else OK_OUTCOME)
            )
            # A stopped turn is NOT a zero-progress attempt, and the order matters twice
            # over. A turn killed at the ceiling (or by a crash, a deploy or SIGTERM)
            # after Stop comes back as exactly the synthetic zero-turn result 0a keys on
            # -- no tool call, so halt() never runs -- and without this it raises
            # ResumeFailure, answers 500, and decide.py requeues it: the model is re-run
            # and BILLED after the patron pressed Stop.
            # At the cap it would also be recorded `no_progress` and rendered "the agent
            # stopped making progress", to the person who stopped it. That is the same
            # "says the opposite of what happened" failure the on_allow clobber guard
            # exists for, arriving by the other door.
            stopped_here = outcome == TERMINAL_STOPPED
            if (not stopped_here
                    and not transcript_lost
                    and receive_count > 1
                    and not attempt_did_work(result, counters["tool_calls"])):
                zero_progress = bump_zero_progress(conn, turn_id)
                log(ev="zero_progress_attempt", turn_id=turn_id, session_id=session_id,
                    receive_count=receive_count, attempts=zero_progress, cap=ZERO_PROGRESS_CAP,
                    num_turns=result.num_turns, tool_calls=counters["tool_calls"])
                if zero_progress < ZERO_PROGRESS_CAP:
                    raise ResumeFailure(
                        f"redelivered attempt (receive_count {receive_count}) did no work: "
                        f"num_turns={result.num_turns}, tool_calls={counters['tool_calls']}; "
                        f"zero-progress attempt {zero_progress} of {ZERO_PROGRESS_CAP}"
                    )
                outcome = NO_PROGRESS_OUTCOME
            # 1e: `limit` separates the two budgets that both end as `budget` -- the
            # nudge cap, where another message continues the same session, and the spend
            # cap, where it does not. `spend_estimate_usd` sits beside the
            # ResultMessage's own cost_usd on every turn, which is what calibrates the
            # price vector on the first real runs.
            detail = {k: terminal[k] for k in ("limit", "spent_usd") if k in terminal}
            try:
                detail["spend_estimate_usd"] = round(session_spend_usd(conn, sdk_session_id), 4)
            except Exception as exc:  # noqa: BLE001 - a calibration figure never fails a turn
                log(ev="spend_estimate_failed", turn_id=turn_id, error=f"{type(exc).__name__}: {exc}")
            seq = complete(
                conn, turn, receive_count, outcome=outcome, detail=detail,
                cost_usd=result.total_cost_usd, num_turns=result.num_turns, duration_ms=result.duration_ms,
                sdk_session_id=sdk_session_id,
                # `or None` so COALESCE keeps what record_nudge already wrote. The counter
                # is 0 whenever THIS attempt vetoed nothing, and 31% of runs never yield
                # at all -- so a plain assignment walks a cumulative count of 5 back to 0
                # on the attempt that happens to finish, destroying the figure the column
                # was added for. Zero is not a measurement here; it is "nothing to add" --
                # complete()'s trailing 0 is what a turn no attempt vetoed ends up with.
                nudges=counters["nudges"] or None,
                # U5 D3: SIGTERM's last-receive close may have closed the row first; then
                # this writes nothing, returns None, and releases nothing.
                only_if_open=True,
            )
        finally:
            await client.disconnect()
    finally:
        conn.close()
        shutil.rmtree(config_dir, ignore_errors=True)

    # 1b: the turn is closed, so a message held while it ran goes on the queue now --
    # whatever the outcome, because a held message is the patron's words and is never
    # dropped. On its own connection, after the one above closed: a handover that fails
    # must not undo a turn that completed. Only if THIS attempt closed the row (U5 D3),
    # or a racing close and this one could each release one.
    released = None
    if seq is not None:
        with psycopg.connect(PG_DSN, autocommit=True) as release_conn:
            released = release_next_held(release_conn, session_id)

    summary = {
        "seq": seq,
        "outcome": outcome,
        **detail,
        "released_turn": released,
        "max_nudges": max_nudges,
        "resumed": resume is not None,
        "sdk_session_id": sdk_session_id,
        "num_turns": result.num_turns,
        "cost_usd": result.total_cost_usd,
        "duration_ms": result.duration_ms,
        "wall_ms": int((time.monotonic() - started) * 1000),
        "events": counters["events"],
        "activity": counters["activity"],
        "entries_appended": store.calls["entries_appended"],
        # D17 criterion: a resumed turn that saw a delegation must show the SDK asking the
        # store for the subagent transcripts and the store answering with at least one.
        # Collected since D9-10 and surfaced nowhere until this line, so the run could not
        # assert it.
        "list_subkeys": store.calls["list_subkeys"],
        "subkeys_returned": store.calls["subkeys_returned"],
        "tool_calls": counters["tool_calls"],
        "nudges": counters["nudges"],
    }
    # U10 D6: closed (above) and released before it fails, so the redelivery answers 200
    # without re-running a paid turn that would lose its transcript the same way.
    if transcript_lost:
        _TRANSCRIPT_ERROR = "no_entries"
        raise TranscriptLost(summary)
    if store.calls["entries_appended"] > 0:
        _TRANSCRIPT_ERROR = None
    return summary


def run_turn_sync(turn: dict, receive_count: int, sdk_session_id: str) -> dict[str, Any]:
    return asyncio.run(run_turn(turn, receive_count, sdk_session_id))


def is_real_turn(message: dict) -> bool:
    text = message.get("text")
    return isinstance(text, str) and bool(text.strip())


def is_last_receive(receive_count: int) -> bool:
    """No further delivery will come (U5 D3): sqsd delivers receives 1..MaxRetries and
    moves the message to the DLQ on the next. Off when SQSD_MAX_RETRIES is 0."""
    return SQSD_MAX_RETRIES > 0 and receive_count >= SQSD_MAX_RETRIES


def _shutdown_body(turn_id: str) -> dict:
    return {"ok": False, "turn_id": turn_id, "error": "worker shutting down", "shutdown": True}


def close_on_last_receive(
    turn: dict, receive_count: int, *, connect, cause: str, sdk_session_id: str | None,
    defer: bool = False, error: str | None = None,
) -> tuple[int, dict] | None:
    """The last receive's close: ``close_turn`` and 200, so the message is deleted rather
    than dead-lettered. ``defer`` hands the release to the shutdown thread. None when the
    close itself failed, and the caller answers what it was going to.

    When the row was already closed -- this attempt completed it and then failed its
    release, say -- no redelivery will come to release a held message it stranded, so
    this receive releases (or defers) it and answers ``already_completed`` with the
    row's own outcome."""
    turn_id = turn["turn_id"]
    try:
        with connect(PG_DSN) as conn:
            seq = close_turn(conn, turn, receive_count, cause=cause, sdk_session_id=sdk_session_id,
                             release=not defer)
            prior = turn_outcome(conn, turn_id) if seq is None else None
    except Exception as exc:  # noqa: BLE001 - a failed close must not swallow the reply
        log(ev="close_failed", turn_id=turn_id, receive_count=receive_count, cause=cause,
            error=f"{type(exc).__name__}: {exc}")
        return None
    if seq is None:
        if defer:
            defer_release(turn["session_id"], turn_id)
        else:
            release_guarded(connect, turn["session_id"], turn_id)
        log(ev="turn", turn_id=turn_id, session_id=turn["session_id"], receive_count=receive_count,
            status=200, already_completed=True, outcome=prior, cause=cause, error=error)
        return 200, {"ok": True, "turn_id": turn_id, "receive_count": receive_count,
                     "already_completed": True, "outcome": prior}
    if defer:
        defer_release(turn["session_id"], turn_id)
    log(ev="turn", turn_id=turn_id, session_id=turn["session_id"], receive_count=receive_count,
        status=200, outcome=RETRIES_EXHAUSTED_OUTCOME, cause=cause, seq=seq, error=error)
    return 200, {"ok": True, "turn_id": turn_id, "receive_count": receive_count, "seq": seq,
                 "outcome": RETRIES_EXHAUSTED_OUTCOME, "cause": cause}


def shutdown_reply(turn: dict, receive_count: int, *, connect, sdk_session_id: str | None) -> tuple[int, dict]:
    """What an in-flight POST answers once SHUTDOWN is set: 500 at once, so sqsd
    redelivers after ErrorVisibilityTimeout -- or, on the last receive, the close, whose
    release runs only once the attempt's cleanup has run (and is skipped, the row left
    held, if it has not by the end of the shutdown). Only a 500 goes in ``_ANSWERED``."""
    turn_id = turn["turn_id"]
    if is_last_receive(receive_count):
        closed = close_on_last_receive(turn, receive_count, connect=connect, cause="shutdown",
                                       sdk_session_id=sdk_session_id, defer=True)
        if closed is not None:
            return closed
    with _INFLIGHT_LOCK:
        _ANSWERED.append(turn_id)
    log(ev="turn", turn_id=turn_id, session_id=turn["session_id"], receive_count=receive_count,
        status=500, shutdown=True)
    return 500, _shutdown_body(turn_id)


def serve_after_shutdown(turn: dict, receive_count: int, *, connect) -> tuple[int, dict]:
    """A POST that arrives after SHUTDOWN: 503 without claiming, except on the last
    receive, where it claims and closes -- otherwise that receive is spent with no row
    recording it, and only the retention backstop would see the dead letter."""
    turn_id = turn["turn_id"]
    if not is_last_receive(receive_count):
        log(ev="turn", turn_id=turn_id, receive_count=receive_count, status=503, shutdown=True)
        return 503, _shutdown_body(turn_id)
    try:
        with connect(PG_DSN) as conn:
            claim(conn, turn, receive_count)
            done = turn_completed(conn, turn_id)
            sdk_session_id = None if done else session_sdk_id(conn, turn["session_id"])
    except psycopg.Error as exc:
        log(ev="turn", turn_id=turn_id, receive_count=receive_count, status=503, shutdown=True,
            error=f"{type(exc).__name__}: {exc}")
        return 503, _shutdown_body(turn_id)
    if done:
        # The last receive: no redelivery will come to release what this turn stranded.
        defer_release(turn["session_id"], turn_id)
        log(ev="turn", turn_id=turn_id, receive_count=receive_count, status=200, already_completed=True)
        return 200, {"ok": True, "turn_id": turn_id, "receive_count": receive_count, "already_completed": True}
    closed = close_on_last_receive(turn, receive_count, connect=connect, cause="shutdown",
                                   sdk_session_id=sdk_session_id, defer=True)
    return closed if closed is not None else (503, _shutdown_body(turn_id))


def serve_real_turn(
    turn: dict, receive_count: int, *, connect=pg_connect, run=run_turn_sync,
    entry: Inflight | None = None,
) -> tuple[int, dict]:
    """Claim, skip a turn that already completed (releasing a held message it stranded),
    else choose the SDK session id and run it on an attempt thread. ``(status, body)``.
    A failure on the last receive closes the turn instead of answering 500 (U5 D3)."""
    if entry is None:
        with track(turn["turn_id"]) as entry:
            return serve_real_turn(turn, receive_count, connect=connect, run=run, entry=entry)
    turn_id = turn["turn_id"]
    if SHUTDOWN.is_set():
        return serve_after_shutdown(turn, receive_count, connect=connect)
    try:
        with connect(PG_DSN) as conn:
            claim(conn, turn, receive_count)
            done = turn_completed(conn, turn_id)
            sdk_session_id = None if done else choose_sdk_session_id(conn, turn["session_id"], str(uuid.uuid4()))
            if done:
                # U5: the attempt that closed this turn may have failed its release and
                # answered 500. The guard keeps this from enqueuing a sibling beside a
                # held turn that was already released and is running.
                release_next_held(conn, turn["session_id"])
    except psycopg.Error as exc:
        error = f"{type(exc).__name__}: {exc}"
        log(ev="turn", turn_id=turn_id, receive_count=receive_count, status=500, error=error)
        return 500, {"ok": False, "turn_id": turn_id, "error": error}
    if done:
        log(ev="turn", turn_id=turn_id, receive_count=receive_count, status=200, already_completed=True)
        return 200, {"ok": True, "turn_id": turn_id, "receive_count": receive_count, "already_completed": True}
    if SHUTDOWN.is_set():
        return shutdown_reply(turn, receive_count, connect=connect, sdk_session_id=sdk_session_id)
    kind, value = await_attempt(entry, lambda: run(turn, receive_count, sdk_session_id))
    if kind == "shutdown" or isinstance(value, WorkerShutdown):
        return shutdown_reply(turn, receive_count, connect=connect, sdk_session_id=sdk_session_id)
    if kind == "error" and isinstance(value, TranscriptLost):
        # U10 D6: the turn is already closed transcript_lost. 500 so sqsd redelivers and
        # the redelivery answers 200 already_completed; on the last receive the close
        # finds the row closed and answers that 200 now.
        summary = value.summary
        log(ev="turn", turn_id=turn_id, session_id=turn["session_id"], receive_count=receive_count,
            **{**summary, "status": 500, "error": TRANSCRIPT_LOST_OUTCOME})
        if is_last_receive(receive_count):
            closed = close_on_last_receive(turn, receive_count, connect=connect, cause="error",
                                           sdk_session_id=sdk_session_id, error=TRANSCRIPT_LOST_OUTCOME)
            if closed is not None:
                return closed
        return 500, {**summary, "ok": False, "turn_id": turn_id, "error": TRANSCRIPT_LOST_OUTCOME,
                     "outcome": TRANSCRIPT_LOST_OUTCOME}
    if kind == "error":
        error = f"{type(value).__name__}: {value}"
        log(ev="turn", turn_id=turn_id, session_id=turn["session_id"], receive_count=receive_count,
            status=500, error=error)
        if is_last_receive(receive_count):
            closed = close_on_last_receive(turn, receive_count, connect=connect, cause="error",
                                           sdk_session_id=sdk_session_id, error=error)
            if closed is not None:
                return closed
        return 500, {"ok": False, "turn_id": turn_id, "error": error}
    summary = value
    log(ev="turn", turn_id=turn_id, session_id=turn["session_id"], receive_count=receive_count,
        status=200, **summary)
    return 200, {"ok": True, "turn_id": turn_id, "receive_count": receive_count, **summary}


STUB_BEHAVIOURS = ("ok", "sleep", "fail", "crash")


def serve_stub_turn(
    turn: dict, receive_count: int, behaviour: str, seconds: float, *, connect=pg_connect,
    entry: Inflight | None = None,
) -> tuple[int, dict]:
    """The D3 stub arms, under the same shutdown and last-receive rules as a real turn --
    ``make proto-smoke``'s ``sigterm`` and ``dead_letter`` cases drive them."""
    if entry is None:
        with track(turn["turn_id"]) as entry:
            return serve_stub_turn(turn, receive_count, behaviour, seconds, connect=connect, entry=entry)
    turn_id = turn["turn_id"]
    if SHUTDOWN.is_set():
        return serve_after_shutdown(turn, receive_count, connect=connect)
    try:
        with connect(PG_DSN) as conn:
            claim(conn, turn, receive_count)
    except psycopg.Error as exc:
        error = f"{type(exc).__name__}: {exc}"
        log(ev="turn", turn_id=turn_id, behaviour=behaviour, receive_count=receive_count, status=500, error=error)
        return 500, {"ok": False, "turn_id": turn_id, "error": error}

    if behaviour == "fail":
        log(ev="turn", turn_id=turn_id, behaviour=behaviour, receive_count=receive_count, status=500)
        if is_last_receive(receive_count):
            closed = close_on_last_receive(turn, receive_count, connect=connect, cause="error",
                                           sdk_session_id=None, error="behaviour=fail")
            if closed is not None:
                return closed
        return 500, {"ok": False, "turn_id": turn_id, "error": "behaviour=fail"}
    if behaviour == "crash" and receive_count == 1:
        log(ev="turn", turn_id=turn_id, behaviour=behaviour, receive_count=receive_count, status="crash")
        os._exit(1)
    if SHUTDOWN.is_set():
        return shutdown_reply(turn, receive_count, connect=connect, sdk_session_id=None)

    def attempt() -> int | None:
        if behaviour == "sleep" and receive_count == 1 and SHUTDOWN.wait(seconds):
            raise WorkerShutdown("sleep interrupted by worker shutdown")
        if SHUTDOWN.is_set():
            raise WorkerShutdown("worker shutting down before the stub completed")
        with connect(PG_DSN) as conn:
            return complete(conn, turn, receive_count, only_if_open=True)

    kind, value = await_attempt(entry, attempt)
    if kind == "shutdown" or isinstance(value, WorkerShutdown):
        return shutdown_reply(turn, receive_count, connect=connect, sdk_session_id=None)
    if kind == "error":
        error = f"{type(value).__name__}: {value}"
        log(ev="turn", turn_id=turn_id, behaviour=behaviour, receive_count=receive_count, status=500, error=error)
        return 500, {"ok": False, "turn_id": turn_id, "error": error}
    log(ev="turn", turn_id=turn_id, behaviour=behaviour, receive_count=receive_count, status=200, seq=value)
    return 200, {"ok": True, "turn_id": turn_id, "receive_count": receive_count, "seq": value}


# -- the dead-letter sweep (U5 D3) ---------------------------------------------

SWEEP_SELECT = (
    "SELECT t.turn_id, t.session_id, t.project_id, t.receive_count, s.sdk_session_id, "
    "t.entries_seq_before "
    "FROM turns t LEFT JOIN sessions s ON s.session_id = t.session_id "
    "WHERE t.completed_at IS NULL AND t.outcome IS DISTINCT FROM %s "
    "AND NOT (t.turn_id = ANY(%s::text[]))"
)


def sweep_query(
    max_retries: int, visibility_s: int, retention_s: int, skip: list[str],
) -> tuple[str, tuple] | None:
    """The next turn no delivery can reach any more, locked ``SKIP LOCKED`` so a second
    instance cannot close it twice; None when neither path is configured.

    - fast, on when ``max_retries`` > 0: the last receive's visibility has lapsed, so the
      message is in the DLQ or goes there on its next receive;
    - backstop, on when ``retention_s`` > 0: SQS has deleted the message whatever the
      configuration -- a mis-set max_retries, or a turn never claimed at all.

    A held row (``outcome = 'queued'``) is never a candidate; its turn has not run."""
    clauses: list[str] = []
    params: list[Any] = [QUEUED_OUTCOME, skip]
    if max_retries > 0:
        clauses.append("(t.receive_count >= %s AND t.claimed_at < now() - make_interval(secs => %s))")
        params += [max_retries, visibility_s + SWEEP_VISIBILITY_MARGIN_S]
    if retention_s > 0:
        clauses.append("COALESCE(t.claimed_at, t.enqueued_at) < now() - make_interval(secs => %s)")
        params.append(retention_s)
    if not clauses:
        return None
    sql = (SWEEP_SELECT + " AND (" + " OR ".join(clauses) + ") "
           "ORDER BY t.enqueued_at LIMIT 1 FOR UPDATE OF t SKIP LOCKED")
    return sql, tuple(params)


def sweep_once(
    *, connect=pg_connect, max_retries: int | None = None, visibility_s: int | None = None,
    retention_s: int | None = None,
) -> list[str]:
    """Close every sweepable turn, one row per transaction: the row stays locked from the
    SELECT to ``close_turn``'s commit. Turns this process is serving are skipped.
    Returns the closed turn ids and logs ``ev=sweep`` when there are any."""
    max_retries = SQSD_MAX_RETRIES if max_retries is None else max_retries
    visibility_s = SQSD_VISIBILITY_TIMEOUT_S if visibility_s is None else visibility_s
    retention_s = SQSD_RETENTION_PERIOD_S if retention_s is None else retention_s
    closed: list[str] = []
    with connect(PG_DSN) as conn:
        for _ in range(SWEEP_BATCH):
            if SHUTDOWN.is_set():
                break
            query = sweep_query(max_retries, visibility_s, retention_s, inflight_turn_ids())
            if query is None:
                break
            with conn.cursor() as cur:
                cur.execute(*query)
                row = cur.fetchone()
            if row is None:
                conn.commit()
                break
            turn_id, session_id, project_id, receive_count, sdk_session_id, seq_before = row
            turn = {"turn_id": turn_id, "session_id": session_id, "project_id": project_id}
            # A turn never claimed has no high-water mark, and TURN_USAGE_SQL would then sum
            # the whole session's history onto it: close it with no token sum instead.
            seq = close_turn(conn, turn, int(receive_count or 0), cause="sweep",
                             sdk_session_id=sdk_session_id if seq_before is not None else None)
            conn.commit()
            if seq is None:
                break
            closed.append(turn_id)
    if closed:
        log(ev="sweep", closed=closed)
    return closed


def start_sweep(
    *, interval: float | None = None, max_retries: int | None = None, retention_s: int | None = None,
) -> threading.Thread | None:
    """The sweep thread, started only when ``SWEEP_INTERVAL_S`` > 0 and at least one path
    is on -- so base compose, which sets neither, never closes the dev database's old
    smoke leftovers or releases their held messages into paid turns."""
    interval = SWEEP_INTERVAL_S if interval is None else interval
    max_retries = SQSD_MAX_RETRIES if max_retries is None else max_retries
    retention_s = SQSD_RETENTION_PERIOD_S if retention_s is None else retention_s
    if interval <= 0 or (max_retries <= 0 and retention_s <= 0):
        return None

    def loop() -> None:
        while not SHUTDOWN.wait(interval):
            try:
                sweep_once(max_retries=max_retries, retention_s=retention_s)
            except Exception as exc:  # noqa: BLE001 - the next pass tries again
                log(ev="sweep_failed", error=f"{type(exc).__name__}: {exc}")

    thread = threading.Thread(target=loop, daemon=True, name="sweep")
    thread.start()
    return thread


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
            # U10: readiness, never a 500 -- a report that raises is a 503 without checks.
            try:
                report = readiness()
            except Exception as exc:  # noqa: BLE001 - the image HEALTHCHECK reads the status
                log(ev="health", error=redact(f"{type(exc).__name__}: {exc}"))
                self._reply(503, {"ok": False})
                return
            self._reply(200 if report["ok"] else 503, report)
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

        with track(turn["turn_id"]) as entry:
            if is_real_turn(message):
                status, payload = serve_real_turn(turn, receive_count, entry=entry)
            else:
                behaviour = message.get("behaviour", "ok")
                seconds = float(message.get("seconds") or 0)
                if behaviour in STUB_BEHAVIOURS:
                    status, payload = serve_stub_turn(turn, receive_count, behaviour, seconds, entry=entry)
                else:
                    log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status=400)
                    status, payload = 400, {"ok": False, "error": f"unknown behaviour {behaviour!r}"}
            # Inside the block: the shutdown thread waits for `replied`, which is set
            # only once this reply is written, so a 500 is never lost to the exit.
            self._reply(status, payload)


def queue_startup_fields(env: Mapping[str, str]) -> dict[str, str]:
    """U7: settle the SQS credentials and region the held-message release signs with, at
    start. ``{}`` without a QUEUE_URL (nothing is read, so a stray key is inert); a half
    ``GENEALOGY_SQS_*`` pair or a contradictory region prints ``worker: <reason>`` and
    exits 2 before anything else starts. Otherwise the ``ev=start`` fields."""
    if not QUEUE_URL:
        return {}
    from proto import enqueue

    try:
        auth = enqueue.configure(env, QUEUE_URL)
    except enqueue.SqsConfigError as exc:
        print(f"worker: {exc}", file=sys.stderr)
        raise SystemExit(2) from None
    return {"sqs_credentials": auth.mode, "sqs_region": enqueue.region_for(QUEUE_URL, auth.region)}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    # U10 D5: static instance configuration that does not heal, so it blocks start --
    # first, before anything that could wait on Postgres.
    bad_tmpdir = check_tmpdir()
    if bad_tmpdir is not None:
        log(ev="prepare", step="tmpdir", error=bad_tmpdir, tmpdir=os.environ.get("TMPDIR"))
        sys.exit(2)
    hook_python = require_hook_python()
    sqs = queue_startup_fields(os.environ)
    if sqs:
        from proto import enqueue

        enqueue.prewarm()
    prepare()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    install_signal_handlers(server)
    # U10 D4: after listen, so a down Postgres never stalls the bind; /healthz says
    # `schema` pending until it lands.
    start_schema_thread()
    sweeper = start_sweep()
    log(ev="start", port=server.server_address[1], pg_dsn=PG_DSN.split("@")[-1], cwd=WORKER_CWD,
        provider=os.environ.get("MODEL_PROVIDER") or "anthropic",
        sqsd_max_retries=SQSD_MAX_RETRIES, sqsd_visibility_timeout_s=SQSD_VISIBILITY_TIMEOUT_S,
        sqsd_retention_period_s=SQSD_RETENTION_PERIOD_S, sweep_interval_s=SWEEP_INTERVAL_S,
        sweep=sweeper is not None, shutdown_grace_s=SHUTDOWN_GRACE_S,
        tmpdir=tempfile.gettempdir(), tmpdir_free_mb=tmpdir_free_mb(), hook_python=hook_python, **sqs)
    server.serve_forever()
    if _SHUTDOWN_THREAD is not None:
        # A daemon: its second wait, the releases and ev=shutdown run after
        # serve_forever returns, and must finish before the interpreter exits.
        _SHUTDOWN_THREAD.join(SHUTDOWN_GRACE_S + RELEASE_BUDGET_S + 2)
    server.server_close()
    # Returning exits 0; the SDK's atexit reaper then SIGTERMs any CLI child still alive.


if __name__ == "__main__":
    main()
