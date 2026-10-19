#!/usr/bin/env python3
"""P1 cross-process resume harness: kill a turn in one process, resume it in another.

Contract: `PLAN.md` at the repo root ("apps/server/dev/p1/kill_resume.py"), which
implements "P1. Cross-process resume" of `docs/plan/search-agent-prototype.md`.

Launches `dev.p1.driver --mode turn` in its OWN process group (the SDK spawns the
CLI, and the CLI its stdio MCP server, inside the driver's group), reads the
driver's JSONL stdout live, SIGKILLs the whole group at the variant's marker,
deletes the turn's `CLAUDE_CONFIG_DIR` so no warm transcript survives on disk,
then launches `dev.p1.driver --mode resume` against the same Postgres namespace
and measures the nine criteria from the two evidence files.

    uv run python -m dev.p1.kill_resume --variant clean|mid-delegation|mid-model-call|forced

Variants (what the kill is keyed on):
    clean           never kill; the resume asks a follow-up question
    mid-delegation  kill on `delegation_started`
    mid-model-call  kill on `subagent_first_delta`
    forced          kill `KILL_SETTLE_S` after the `pretool` line for
                    `extraction_append` — the PreToolUse hook has returned, so
                    the CLI is dispatching the call into the engine's
                    `--hold-ms` window (default 180000) and the tool_use frame
                    has had time to reach Postgres. The stream's
                    `extraction_append_tool_use` marker arrives BEFORE the hook
                    round-trip and before dispatch, which is why it is not the key.

A missed window (the turn finished before its marker) is reported, not failed:
the resume still runs and the criteria are measured against what did happen.

Two billed turns per run. Needs the docker Postgres from PLAN.md, a compiled
engine, and a key in $ANTHROPIC_API_KEY or eval/.env (the driver reads both).
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# /repo/apps/server/dev/p1/kill_resume.py -> parents[2] = apps/server, parents[4] = repo
SERVER_DIR = Path(__file__).resolve().parents[2]
REPO = Path(__file__).resolve().parents[4]
FIXTURE_DIR = REPO / "eval" / "fixtures" / "scenarios" / "empty-project-just-created"
FIXTURE_FILES = ("research.json", "tree.gedcomx.json")

DEFAULT_DSN = "postgresql://postgres:p1@127.0.0.1:5433/p1"
DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_HOLD_MS = 180_000
CLEAN_RESUME_MESSAGE = "In one sentence: what did you just extract, and for whom?"

VARIANTS = ("clean", "mid-delegation", "mid-model-call", "forced", "forced-after-commit")

# Forced variant: how long after the extraction_append `pretool` line to fire.
# Long enough for the CLI to dispatch the call into the held engine and for the
# eager mirror flush (a background task) to land the tool_use frame in
# Postgres; far inside the 180 s hold.
KILL_SETTLE_S = 2.0

# forced-after-commit: arm on the same pretool line, fire the instant the
# committed write shows up in research.json (polled), or after this bound.
COMMIT_WAIT_S = 90.0


@dataclass(frozen=True)
class KillTrigger:
    name: str
    matches: Callable[[dict[str, Any]], bool]
    settle_s: float = 0.0
    fire_when: Callable[[], bool] | None = None  # polled while armed; fires early when true


def _ev_is(kind: str) -> Callable[[dict[str, Any]], bool]:
    return lambda ev: ev.get("ev") == kind


def _is_extraction_pretool(ev: dict[str, Any]) -> bool:
    return ev.get("ev") == "pretool" and str(ev.get("tool_name", "")).endswith("extraction_append")


def _first_stream_after_delegation() -> Callable[[dict[str, Any]], bool]:
    """Subagent partial deltas carry no parent_tool_use_id (SDK 0.2.128 / CLI 2.1.220,
    measured 2026-09-10: 545 StreamEvents, 0 tagged), so 'mid-model-call' keys on the
    first StreamEvent after delegation_started — the main thread is blocked on the
    Task by then, so that delta is the subagent's generation."""
    delegated = False

    def matches(ev: dict[str, Any]) -> bool:
        nonlocal delegated
        if ev.get("ev") == "delegation_started":
            delegated = True
            return False
        return delegated and ev.get("ev") == "msg" and ev.get("cls") == "StreamEvent"

    return matches


KILL_TRIGGER: dict[str, KillTrigger | None] = {
    "clean": None,
    "mid-delegation": KillTrigger("delegation_started", _ev_is("delegation_started")),
    "mid-model-call": KillTrigger("stream_after_delegation", _first_stream_after_delegation()),
    "forced": KillTrigger("pretool:extraction_append", _is_extraction_pretool, KILL_SETTLE_S),
    "forced-after-commit": None,  # built in main(): its fire_when polls the project dir
}

# A stuck driver (CLI hang, engine hang) would otherwise block the harness
# forever — and a Ctrl-C on the harness alone would not reach the driver's
# separate process group. Both paths kill the group.
DRIVER_WATCHDOG_S = 30 * 60

_live_children: list[subprocess.Popen[str]] = []
_live_lock = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def say(msg: str) -> None:
    print(f"[p1] {msg}", flush=True)


def killpg(p: subprocess.Popen[str]) -> bool:
    """SIGKILL the driver's whole process group. True if a signal was sent."""
    try:
        os.killpg(os.getpgid(p.pid), signal.SIGKILL)
        return True
    except (ProcessLookupError, PermissionError, OSError):
        return False


def _on_signal(signum: int, _frame: Any) -> None:
    with _live_lock:
        children = list(_live_children)
    for p in children:
        killpg(p)
    sys.exit(128 + signum)


class DriverObs:
    """What the harness learns from one driver's JSONL stream."""

    def __init__(self, kill_on: KillTrigger | None) -> None:
        self.kill_on = kill_on
        self.session_id: str | None = None
        self.frames_before_kill = 0
        # Store appends carrying a non-null subpath (subagent transcript frames)
        # seen before the kill: what makes `subkeys_returned >= 1` judgeable.
        self.subagent_frames_before_kill = 0
        self.killed = False
        self.armed_at: str | None = None
        self.killed_at: str | None = None
        self.kill_trigger: str | None = None
        self.interrupted_call: dict[str, Any] | None = None
        self.delegation_seen = False
        self.seen: Counter[str] = Counter()
        self.lines = 0
        self.exit_code: int | None = None
        self.launched_at: str | None = None
        self.exited_at: str | None = None
        self.pid: int | None = None
        # extraction_append bookkeeping: id -> {input_sha256, input_preview}
        self._previews: dict[str, str] = {}
        self._open: dict[str, dict[str, Any]] = {}
        # The same calls as seen by the PreToolUse hook (carries the hook's
        # own input_sha256 and agent attribution): id -> record. The hook's
        # line can land before OR after the stream's tool_use line.
        self._pretool_open: dict[str, dict[str, Any]] = {}
        self.extraction_uses: list[dict[str, Any]] = []
        self.extraction_pretools: list[dict[str, Any]] = []

    def observe(self, ev: dict[str, Any]) -> None:
        kind = ev.get("ev")
        if not isinstance(kind, str):
            return
        self.seen[kind] += 1
        sid = ev.get("session_id")
        if kind in ("init", "msg") and isinstance(sid, str) and sid and not self.session_id:
            self.session_id = sid
        if kind == "msg":
            for b in ev.get("blocks") or []:
                if (isinstance(b, dict) and b.get("type") == "tool_use"
                        and str(b.get("name", "")).endswith("extraction_append")):
                    self._previews[str(b.get("id"))] = str(b.get("input_preview", ""))
        elif kind == "store":
            if ev.get("store") == "append" and not self.killed:
                try:
                    n = int(ev.get("n") or 0)
                except (TypeError, ValueError):
                    n = 0
                self.frames_before_kill += n
                if ev.get("subpath"):
                    self.subagent_frames_before_kill += n
        elif kind == "delegation_started":
            self.delegation_seen = True
        elif kind == "extraction_append_tool_use":
            call = {"id": ev.get("id"), "input_sha256": ev.get("input_sha256"),
                    "input_preview": self._previews.get(str(ev.get("id")), ""),
                    "ts": now_iso()}
            self._open[str(ev.get("id"))] = call
            self.extraction_uses.append(call)
        elif kind == "pretool" and _is_extraction_pretool(ev):
            rec = {"id": ev.get("tool_use_id"), "input_sha256": ev.get("input_sha256"),
                   "agent_id": ev.get("agent_id"), "agent_type": ev.get("agent_type"),
                   "ts": ev.get("ts") or now_iso()}
            self._pretool_open[str(ev.get("tool_use_id"))] = rec
            self.extraction_pretools.append(rec)
        elif kind == "extraction_append_tool_result":
            self._open.pop(str(ev.get("tool_use_id")), None)
            self._pretool_open.pop(str(ev.get("tool_use_id")), None)

    def mark_armed(self, trigger: str) -> None:
        if self.armed_at is None:
            self.armed_at = now_iso()
            self.kill_trigger = trigger

    def mark_killed(self, trigger: str) -> None:
        if self.killed:
            return
        self.killed = True
        self.killed_at = now_iso()
        self.kill_trigger = trigger
        # Prefer the stream's record (it has the preview); fall back to the
        # hook's when the stream line has not landed yet.
        call: dict[str, Any] | None = None
        if self._open:
            call = dict(next(reversed(self._open.values())))
        elif self._pretool_open:
            call = dict(next(reversed(self._pretool_open.values())))
        if call is not None:
            call["input_preview"] = self._previews.get(str(call.get("id")),
                                                       call.get("input_preview", ""))
            pt = self._pretool_open.get(str(call.get("id")))
            call["dispatched"] = pt is not None
            if pt is not None:
                call["hook_input_sha256"] = pt.get("input_sha256")
                call["agent_id"] = pt.get("agent_id")
        self.interrupted_call = call

    def summary(self) -> dict[str, Any]:
        return {
            "pid": self.pid,
            "launched_at": self.launched_at,
            "exited_at": self.exited_at,
            "exit_code": self.exit_code,
            "lines": self.lines,
            "events": dict(self.seen),
            "session_id": self.session_id,
            "kill_on": self.kill_on.name if self.kill_on else None,
            "kill_settle_s": self.kill_on.settle_s if self.kill_on else None,
            "killed": self.killed,
            "armed_at": self.armed_at,
            "killed_at": self.killed_at,
            "kill_trigger": self.kill_trigger,
            "frames_before_kill": self.frames_before_kill,
            "subagent_frames_before_kill": self.subagent_frames_before_kill,
            "delegation_seen": self.delegation_seen,
            "interrupted_call": self.interrupted_call,
            "extraction_uses": self.extraction_uses,
            "extraction_pretools": self.extraction_pretools,
        }


def killpg_id(pgid: int) -> bool:
    """SIGKILL a process group by id — usable after the leader has been reaped,
    as long as any member (a straggler) keeps the group alive."""
    try:
        os.killpg(pgid, signal.SIGKILL)
        return True
    except (ProcessLookupError, PermissionError, OSError):
        return False


# After the driver is reaped, how long to keep draining stdout before giving up
# on EOF. A process spawned inside the group in the same instant as the killpg
# (the CLI forking its MCP child, say) can outlive the kill AND hold the write
# end of our pipe, in which case EOF never comes; the second killpg below takes
# such a straggler out, and this bound keeps the read loop honest regardless.
POST_EXIT_DRAIN_S = 2.0
KILL_DOUBLE_TAP_S = 0.25


def run_driver(cmd: list[str], *, jsonl: Path, stderr: Path,
               kill_on: KillTrigger | None) -> DriverObs:
    """Popen the driver in its own session/group, tee its JSONL, kill at the marker.

    A trigger with ``settle_s > 0`` ARMS the kill on its matching line and fires
    it ``settle_s`` later; lines read during the settle still count toward
    ``frames_before_kill``. A driver that exits while armed has missed its window.
    """
    obs = DriverObs(kill_on)
    with stderr.open("wb") as err, jsonl.open("w", encoding="utf-8") as log:
        p = subprocess.Popen(
            cmd,
            cwd=str(SERVER_DIR),
            stdout=subprocess.PIPE,
            stderr=err,
            start_new_session=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        pgid = os.getpgid(p.pid)  # == p.pid under start_new_session; captured before any reap
        obs.pid = p.pid
        obs.launched_at = now_iso()
        with _live_lock:
            _live_children.append(p)

        lines: queue.Queue[str | None] = queue.Queue()

        def pump() -> None:
            assert p.stdout is not None
            try:
                for line in p.stdout:
                    lines.put(line)
            finally:
                lines.put(None)

        threading.Thread(target=pump, name="p1-stdout-pump", daemon=True).start()

        def kill(trigger: str) -> None:
            sent = killpg_id(pgid)
            obs.mark_killed(trigger)
            say(f"kill on {trigger}: SIGKILL group {pgid} "
                f"({'sent' if sent else 'already gone'}) at {obs.killed_at}; "
                f"frames_before_kill={obs.frames_before_kill} "
                f"subagent_frames_before_kill={obs.subagent_frames_before_kill}")

        deadline = time.monotonic() + DRIVER_WATCHDOG_S
        fire_at: float | None = None  # monotonic time an armed kill fires
        idle_after_exit = 0.0
        try:
            while True:
                if fire_at is not None and not obs.killed and (
                    time.monotonic() >= fire_at
                    or (kill_on is not None and kill_on.fire_when is not None and kill_on.fire_when())
                ):
                    kill(kill_on.name if kill_on else "armed")
                wait = 0.5
                if fire_at is not None and not obs.killed:
                    wait = max(0.01, min(wait, fire_at - time.monotonic()))
                    if kill_on is not None and kill_on.fire_when is not None:
                        wait = min(wait, 0.1)
                try:
                    line = lines.get(timeout=wait)
                except queue.Empty:
                    if p.poll() is not None:
                        idle_after_exit += wait
                        if idle_after_exit >= POST_EXIT_DRAIN_S:
                            break  # driver is gone; a straggler holds the pipe
                    elif time.monotonic() > deadline and not obs.killed:
                        kill("watchdog")
                    continue
                if line is None:
                    break  # EOF
                log.write(line)
                log.flush()
                obs.lines += 1
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(ev, dict):
                    continue
                obs.observe(ev)
                if kill_on and not obs.killed and fire_at is None and kill_on.matches(ev):
                    if kill_on.settle_s > 0:
                        fire_at = time.monotonic() + kill_on.settle_s
                        obs.mark_armed(kill_on.name)
                        say(f"armed on {kill_on.name}: firing in {kill_on.settle_s:.1f}s")
                    else:
                        fire_at = time.monotonic()
                        kill(kill_on.name)
        finally:
            p.wait()
            obs.exit_code = p.returncode
            obs.exited_at = now_iso()
            if obs.killed:
                # Double tap: anything the group spawned in the same instant as
                # the first killpg is a member now and dies here.
                time.sleep(KILL_DOUBLE_TAP_S)
                killpg_id(pgid)
            with _live_lock:
                if p in _live_children:
                    _live_children.remove(p)
    return obs


def driver_cmd(mode: str, *, project: Path, evidence: Path, namespace: str, dsn: str,
               config_dir: Path, model: str, message: str | None,
               session_id: str | None = None, hold_ms: int | None = None,
               hold_after_ms: int | None = None) -> list[str]:
    cmd = [sys.executable, "-m", "dev.p1.driver", "--mode", mode,
           "--project", str(project), "--evidence", str(evidence),
           "--namespace", namespace, "--dsn", dsn,
           "--config-dir", str(config_dir), "--model", model]
    if session_id:
        cmd += ["--session-id", session_id]
    if message is not None:
        cmd += ["--message", message]
    if hold_ms is not None:
        cmd += ["--hold-ms", str(hold_ms)]
    if hold_after_ms is not None:
        cmd += ["--hold-after-ms", str(hold_after_ms)]
    return cmd


def load_json(*candidates: Path) -> tuple[dict[str, Any] | None, str | None]:
    """First readable JSON document among candidates, and which path it came from."""
    for path in candidates:
        try:
            return json.loads(path.read_text(encoding="utf-8")), str(path)
        except (OSError, json.JSONDecodeError):
            continue
    return None, None


def read_assertions(project: Path) -> list[dict[str, Any]]:
    try:
        doc = json.loads((project / "research.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return [a for a in (doc.get("assertions") or []) if isinstance(a, dict)]


def duplicated_values(assertions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Assertion values present twice: same record_role + fact_type + value."""
    counts = Counter(
        (a.get("record_role"), a.get("fact_type"), a.get("value")) for a in assertions
    )
    return [
        {"record_role": k[0], "fact_type": k[1], "value": k[2], "count": n}
        for k, n in counts.items() if n > 1
    ]


def _int(d: dict[str, Any] | None, *keys: str) -> int:
    cur: Any = d or {}
    for k in keys:
        cur = cur.get(k) if isinstance(cur, dict) else None
    try:
        return int(cur or 0)
    except (TypeError, ValueError):
        return 0


def assess(*, variant: str, sid: str | None, turn_obs: DriverObs, resume_obs: DriverObs | None,
           turn_ev: dict[str, Any] | None, resume_ev: dict[str, Any] | None,
           turn_cfg: Path, project: Path,
           pre_resume_assertions: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def add(name: str, ok: bool | str, detail: str, **extra: Any) -> None:
        out.append({"name": name, "pass": ok, "detail": detail, **extra})

    r_calls = (resume_ev or {}).get("store_calls") or {}
    t_calls = (turn_ev or {}).get("store_calls") or {}
    r_result = (resume_ev or {}).get("result") or {}
    r_loaded = _int(r_calls, "entries_loaded")
    t_appended = _int(t_calls, "entries_appended")
    resumed = resume_ev is not None

    # continues_not_restarts
    same_sid = bool(sid) and r_result.get("session_id") == sid
    final_text = (resume_ev or {}).get("final_text") or ""
    ok = same_sid and r_loaded > 0
    detail = (f"resume result.session_id={r_result.get('session_id')!r} vs sid={sid!r}; "
              f"resume entries_loaded={r_loaded}")
    if variant == "clean":
        mentions = "flynn" in final_text.lower()
        ok = ok and mentions
        detail += f"; final_text mentions Flynn={mentions}"
    add("continues_not_restarts", ok if resumed else False,
        detail if resumed else "no resume evidence")

    # loaded_entries_before_spawn
    r_load = _int(r_calls, "load")
    add("loaded_entries_before_spawn", r_load >= 1 and r_loaded > 0,
        f"resume store_calls.load={r_load}, entries_loaded={r_loaded}")

    # no_warm_disk — the dir the resumed CLI actually ran under is the SDK's
    # materialized one (mkdtemp("claude-resume-")), not the driver's --config-dir.
    turn_cfg_recorded = (turn_ev or {}).get("config_dir") or str(turn_cfg)
    resume_cfg_recorded = (resume_ev or {}).get("config_dir")
    materialized = (resume_ev or {}).get("materialized_config_dir")
    gone = not Path(turn_cfg_recorded).exists()
    differs = bool(resume_cfg_recorded) and resume_cfg_recorded != turn_cfg_recorded
    mat_ok = bool(materialized) and materialized not in (turn_cfg_recorded, resume_cfg_recorded)
    add("no_warm_disk", gone and differs and mat_ok,
        f"turn config_dir {turn_cfg_recorded} exists={not gone}; "
        f"resume --config-dir={resume_cfg_recorded}; "
        f"resume materialized_config_dir={materialized}"
        + ("" if mat_ok else " (unset or not distinct — the SDK did not materialize from the store)"))

    # frames_appended_turn
    add("frames_appended_turn", t_appended > 0,
        f"turn store_calls.entries_appended={t_appended} "
        f"(source: {'evidence' if turn_ev else 'missing'})")

    # frames_before_kill
    fbk = turn_obs.frames_before_kill
    if variant == "clean":
        ok = t_appended > 0 and r_loaded >= t_appended
        detail = f"turn entries_appended={t_appended}; resume entries_loaded={r_loaded}"
    else:
        ok = fbk > 0 and r_loaded >= fbk
        detail = (f"frames_before_kill={fbk} (store append n summed before the kill"
                  f"{'' if turn_obs.killed else ' — never killed, so all appends'}); "
                  f"resume entries_loaded={r_loaded}")
    add("frames_before_kill", ok, detail)

    # list_subkeys_when_delegated — `list_subkeys >= 1` whenever delegation was
    # seen (the SDK calls it on every materialized resume); `subkeys_returned
    # >= 1` only when a subagent frame was mirrored before the kill, otherwise
    # there is nothing for the store to return and the half is not judgeable.
    if turn_obs.delegation_seen:
        ls = _int(r_calls, "list_subkeys")
        sk = _int(r_calls, "subkeys_returned")
        sub = turn_obs.subagent_frames_before_kill
        base = f"turn saw delegation_started; resume list_subkeys={ls}, subkeys_returned={sk}"
        if sub > 0:
            add("list_subkeys_when_delegated", ls >= 1 and sk >= 1,
                f"{base}; subagent_frames_before_kill={sub}")
        elif ls >= 1:
            add("list_subkeys_when_delegated", "n/a",
                f"{base}; subkeys_returned not judged: no subagent frame was mirrored "
                "before the kill")
        else:
            add("list_subkeys_when_delegated", False,
                f"{base}; list_subkeys was never called (no subagent frame before the "
                "kill either)")
    else:
        add("list_subkeys_when_delegated", "n/a", "turn never emitted delegation_started")

    # resume_accepted
    r_exit = resume_obs.exit_code if resume_obs else None
    is_err = r_result.get("is_error")
    add("resume_accepted", r_exit == 0 and is_err is False,
        f"resume exit={r_exit}, result.is_error={is_err}, result.subtype={r_result.get('subtype')!r}")

    # reissue_vs_redecide (forced only) — a REPORT, per the plan: the hash
    # comparison and both previews are recorded in the extra keys; the only
    # pass condition is that the resumed research.json carries no duplicated
    # assertion value (a double commit). A resume that re-decides and issues no
    # extraction_append is reported as such, not failed; `no_duplicate_ids`
    # below is the correctness gate.
    assertions = read_assertions(project)
    if variant not in ("forced", "forced-after-commit"):
        add("reissue_vs_redecide", "n/a", f"variant {variant}: not a forced-kill run")
    else:
        ic = turn_obs.interrupted_call
        if not ic:
            add("reissue_vs_redecide", "n/a",
                "precondition failed: no extraction_append call was open at the kill "
                f"(killed={turn_obs.killed}, trigger={turn_obs.kill_trigger})")
        else:
            first = next(
                (u for u in ((resume_ev or {}).get("tool_uses") or [])
                 if str(u.get("name", "")).endswith("extraction_append")),
                None,
            )
            dups = duplicated_values(assertions)
            reissued = bool(first) and first.get("input_sha256") == ic.get("input_sha256")
            # after-commit: duplicates are the MEASUREMENT, not a failure
            add("reissue_vs_redecide", True if variant == "forced-after-commit" else not dups,
                (f"reissued_identically={reissued}; resume "
                 f"{'issued' if first else 'issued NO'} extraction_append"
                 f"{' (sha ' + str(first.get('input_sha256'))[:12] + ')' if first else ''}"
                 f" vs interrupted sha {str(ic.get('input_sha256'))[:12]}"
                 f" (dispatched={ic.get('dispatched')}); "
                 f"duplicated assertion values={len(dups)}"),
                reissued_identically=reissued,
                resume_issued_extraction_append=bool(first),
                interrupted_dispatched=ic.get("dispatched"),
                interrupted_preview=ic.get("input_preview"),
                resumed_preview=(first or {}).get("input_preview"),
                interrupted_sha256=ic.get("input_sha256"),
                interrupted_hook_sha256=ic.get("hook_input_sha256"),
                resumed_sha256=(first or {}).get("input_sha256"),
                duplicates=dups)
            if variant == "forced-after-commit":
                pre = pre_resume_assertions or []
                pre_keys = {(a.get("record_role"), a.get("fact_type"), a.get("value")) for a in pre}
                added = assertions[len(pre):]
                hits = sum(1 for a in added
                           if (a.get("record_role"), a.get("fact_type"), a.get("value")) in pre_keys)
                add("after_commit_duplication", True,
                    (f"assertions committed before the kill={len(pre)}, after resume={len(assertions)}, "
                     f"added by the resume={len(added)}; of those, content-key matches "
                     f"(record_role+fact_type+value)={hits}, unmatched={len(added) - hits}"),
                    before=len(pre), after=len(assertions), added=len(added),
                    content_key_hits=hits, content_key_misses=len(added) - hits)

    # no_duplicate_ids
    ids = [a.get("id") for a in assertions]
    dup_ids = sorted({i for i, n in Counter(ids).items() if n > 1})
    add("no_duplicate_ids", not dup_ids,
        f"{len(ids)} assertions, {len(set(ids))} unique ids"
        + (f"; duplicates: {dup_ids}" if dup_ids else ""))
    return out


def print_table(rows: list[dict[str, Any]]) -> None:
    width = max(len(r["name"]) for r in rows) + 2
    print()
    print(f"{'CRITERION':<{width}}{'RESULT':<8}detail")
    print("-" * 100)
    for r in rows:
        verdict = "n/a" if r["pass"] == "n/a" else ("PASS" if r["pass"] else "FAIL")
        print(f"{r['name']:<{width}}{verdict:<8}{r['detail']}")
    print("-" * 100)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.kill_resume",
        description="P1 harness: run a turn, SIGKILL its process group at a marker, "
                    "delete its config dir, resume it in a fresh process, measure.",
    )
    p.add_argument("--variant", choices=VARIANTS, required=True)
    p.add_argument("--dsn", default=os.environ.get("P1_PG_DSN") or DEFAULT_DSN)
    p.add_argument("--out", default=None,
                   help="output dir (default ~/.cache/cowork-genealogy/p1/<variant>-<YYYYmmdd-HHMMSS>)")
    p.add_argument("--hold-ms", type=int, default=DEFAULT_HOLD_MS,
                   help="forced / forced-after-commit only: how long the engine holds "
                        "extraction_append before / after its commit (default 180000)")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--message", default=None,
                   help="override the turn's user message (and, except for clean, the resume's)")
    return p


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    variant: str = args.variant
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = (Path(args.out).expanduser().resolve() if args.out
           else Path.home() / ".cache" / "cowork-genealogy" / "p1" / f"{variant}-{stamp}")
    out.mkdir(parents=True, exist_ok=True)
    namespace = f"{variant}-{stamp}"

    # 1. seed the project from the fixture
    project = out / "project"
    project.mkdir(exist_ok=True)
    for name in FIXTURE_FILES:
        shutil.copyfile(FIXTURE_DIR / name, project / name)
    say(f"variant={variant} namespace={namespace} out={out}")

    # 2. the turn
    turn_cfg = Path(tempfile.mkdtemp(prefix="p1-cfg-turn-"))
    trigger = KILL_TRIGGER[variant]
    if variant == "forced-after-commit":
        trigger = KillTrigger("committed:extraction_append", _is_extraction_pretool,
                              COMMIT_WAIT_S, fire_when=lambda: bool(read_assertions(project)))
    turn_cmd = driver_cmd(
        "turn", project=project, evidence=out / "turn.json", namespace=namespace,
        dsn=args.dsn, config_dir=turn_cfg, model=args.model, message=args.message,
        hold_ms=args.hold_ms if variant == "forced" else None,
        hold_after_ms=args.hold_ms if variant == "forced-after-commit" else None,
    )
    say(f"turn: launching (kill on {trigger.name if trigger else 'nothing'}); "
        f"config_dir={turn_cfg}")
    turn_obs = run_driver(turn_cmd, jsonl=out / "turn.jsonl", stderr=out / "turn.stderr",
                          kill_on=trigger)
    kill_missed = trigger is not None and not turn_obs.killed
    pre_resume_assertions = read_assertions(project)  # what the killed turn committed
    say(f"turn: exit={turn_obs.exit_code} lines={turn_obs.lines} session_id={turn_obs.session_id} "
        f"killed={turn_obs.killed} frames_before_kill={turn_obs.frames_before_kill} "
        f"subagent_frames_before_kill={turn_obs.subagent_frames_before_kill}"
        + (" — WINDOW MISSED (turn finished before its marker"
           + (" fired" if turn_obs.armed_at else "") + ")" if kill_missed else ""))

    # 3. no warm transcript on disk for the resume
    shutil.rmtree(turn_cfg, ignore_errors=True)
    say(f"deleted turn config_dir {turn_cfg}: exists={turn_cfg.exists()}")

    # 4. the resume
    sid = turn_obs.session_id
    resume_obs: DriverObs | None = None
    resume_cfg = Path(tempfile.mkdtemp(prefix="p1-cfg-resume-"))
    if sid:
        resume_message = CLEAN_RESUME_MESSAGE if variant == "clean" else args.message
        resume_cmd = driver_cmd(
            "resume", project=project, evidence=out / "resume.json", namespace=namespace,
            dsn=args.dsn, config_dir=resume_cfg, model=args.model, message=resume_message,
            session_id=sid,
        )
        say(f"resume: launching session {sid}; config_dir={resume_cfg}")
        resume_obs = run_driver(resume_cmd, jsonl=out / "resume.jsonl",
                                stderr=out / "resume.stderr", kill_on=None)
        say(f"resume: exit={resume_obs.exit_code} lines={resume_obs.lines}")
    else:
        say("resume: SKIPPED — the turn never reported a session_id before it ended")

    # 5. evidence and assertions
    if variant == "clean":
        turn_ev, turn_src = load_json(out / "turn.json", out / "turn.json.partial")
    else:
        turn_ev, turn_src = load_json(out / "turn.json.partial", out / "turn.json")
    resume_ev, resume_src = load_json(out / "resume.json", out / "resume.json.partial")
    rows = assess(variant=variant, sid=sid, turn_obs=turn_obs, resume_obs=resume_obs,
                  turn_ev=turn_ev, resume_ev=resume_ev, turn_cfg=turn_cfg, project=project,
                  pre_resume_assertions=pre_resume_assertions)
    passed = all(r["pass"] is True for r in rows if r["pass"] != "n/a")

    report = {
        "variant": variant,
        "namespace": namespace,
        "out": str(out),
        "dsn": args.dsn,
        "model": args.model,
        "hold_ms": args.hold_ms if variant in ("forced", "forced-after-commit") else None,
        "session_id": sid,
        "kill_trigger": trigger.name if trigger else None,
        "kill_settle_s": trigger.settle_s if trigger else None,
        "armed_at": turn_obs.armed_at,
        "killed_at": turn_obs.killed_at,
        "kill_missed": kill_missed,
        "frames_before_kill": turn_obs.frames_before_kill,
        "subagent_frames_before_kill": turn_obs.subagent_frames_before_kill,
        "interrupted_call": turn_obs.interrupted_call,
        "turn": turn_obs.summary(),
        "resume": resume_obs.summary() if resume_obs else None,
        "turn_config_dir": str(turn_cfg),
        "resume_config_dir": str(resume_cfg),
        "turn_evidence": turn_src,
        "resume_evidence": resume_src,
        "assertions": rows,
        "pass": passed,
        "finished": now_iso(),
    }
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False),
                                     encoding="utf-8")
    print_table(rows)
    say(f"{'PASS' if passed else 'FAIL'}"
        + (" (kill window missed — reported, not failed)" if kill_missed else "")
        + f"; report: {out / 'report.json'}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
