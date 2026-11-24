"""The step gate on the connector (Claude's chat) and in Cowork: one step per turn.

`UserPromptSubmit` starts a turn and `PreToolUse` on `Agent|Task|Skill` asks
`step_boundary.StepGate` whether the spawn may run. Only this plugin's research steps
are gated; any other agent or skill is left alone (`is_research_step`). Every out-of-group spawn is
DENIED with `deny_reason`, never halted: a deny makes the model report and end
its turn, while a halt ends a Cowork turn with nothing on screen.

Each hook call is a fresh `python3` process, so the turn lives in a per-session
state file, `{prompt_id, mode, steps, denials}`, under the temp directory,
updated under an `O_CREAT|O_EXCL` lockfile because parallel spawns arrive as
concurrent processes. A hand-back (`<agent-message` prompt, or the stored
`prompt_id`) changes nothing, so it neither reopens the gate nor ends a wrap-up.

Silent under `GENEALOGY_HOSTED_PLANE`: the web app and the prototype gate in
process. Stdlib only, no network, and it never raises: every failure allows the
call.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

HOSTED_PLANE_ENV = "GENEALOGY_HOSTED_PLANE"
STATE_DIR_ENV = "GENEALOGY_STEP_GATE_DIR"
HAND_BACK_PREFIX = "<agent-message"
PLUGIN_NAME = "genealogy-research"
LOCK_WAIT_SECONDS = 2.0
STALE_LOCK_SECONDS = 20.0

_SAFE = re.compile(r"[^A-Za-z0-9_.-]")


def _boundary():
    path = Path(__file__).resolve().parent / "step_boundary.py"
    spec = importlib.util.spec_from_file_location("_genealogy_step_boundary_hook", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _state_dir() -> Path:
    return Path(os.environ.get(STATE_DIR_ENV) or Path(tempfile.gettempdir()) / "genealogy-step-gate")


def _paths(session_id: str) -> tuple[Path, Path]:
    name = _SAFE.sub("_", session_id)[:128]
    base = _state_dir()
    return base / f"{name}.json", base / f"{name}.lock"


def _acquire(lock: Path) -> bool:
    lock.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + LOCK_WAIT_SECONDS
    while True:
        try:
            os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
            return True
        except FileExistsError:
            try:
                if time.time() - lock.stat().st_mtime > STALE_LOCK_SECONDS:
                    lock.unlink()
                    continue
            except FileNotFoundError:
                continue
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.02)


def _read(state: Path) -> dict | None:
    try:
        text = state.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    data = json.loads(text)
    return data if isinstance(data, dict) else None


def _write(state: Path, data: dict) -> None:
    tmp = state.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    os.replace(tmp, state)


def _fresh(boundary, prompt_id, text: str) -> dict:
    return {"prompt_id": prompt_id, "mode": boundary.step_mode(text), "steps": [], "denials": 0}


def on_prompt(payload: dict, boundary) -> dict:
    """`UserPromptSubmit`: a researcher's message starts a turn; a hand-back does not."""
    session = payload.get("session_id")
    prompt = str(payload.get("prompt") or "")
    if not isinstance(session, str) or not session or prompt.lstrip().startswith(HAND_BACK_PREFIX):
        return {}
    state_path, lock = _paths(session)
    if not _acquire(lock):
        return {}
    try:
        current = _read(state_path) or {}
        prompt_id = payload.get("prompt_id")
        if prompt_id is None or prompt_id != current.get("prompt_id"):
            _write(state_path, _fresh(boundary, prompt_id, prompt))
    finally:
        lock.unlink(missing_ok=True)
    return {}


def is_research_step(candidate, boundary) -> bool:
    """Whether a spawn or skill call is one of this plugin's research steps.

    The plugin's hooks load wherever the plugin does, Claude Code included, so a
    spawn or skill from anywhere else (a built-in agent, another plugin, another
    skill) is left alone: only this plugin's steps are gated.
    """
    if not candidate:
        return False
    prefix, _, _ = str(candidate).rpartition(":")
    if prefix and prefix.strip() != PLUGIN_NAME:
        return False
    name = boundary.bare_name(candidate)
    return name == boundary.ROUTER or boundary.home_group(name) is not None


def _deny(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }


def on_tool(payload: dict, boundary) -> dict:
    """`PreToolUse` on a main-thread spawn: allow it, or deny it with `deny_reason`."""
    tool_name = str(payload.get("tool_name") or "")
    tool_input = payload.get("tool_input")
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    if "agent_id" in payload:
        return {}
    candidate = boundary.step_candidate(tool_name, tool_input)
    if not is_research_step(candidate, boundary):
        return {}
    session = payload.get("session_id")
    if not isinstance(session, str) or not session:
        return {}
    state_path, lock = _paths(session)
    if not _acquire(lock):
        return {}
    try:
        state = _read(state_path)
        if state is None:
            return {}
        prompt_id = payload.get("prompt_id")
        if not state or (prompt_id is not None and prompt_id != state.get("prompt_id")):
            state = _fresh(boundary, prompt_id, "")
        mode = state.get("mode") if state.get("mode") in ("step", "wrapup") else "step"
        steps = [s for s in state.get("steps") or [] if isinstance(s, str)]
        gate = boundary.StepGate(
            boundary=boundary,
            mode=mode,
            ctx={"open_items": True} if mode == "wrapup" else None,
            steps=steps,
        )
        denials = state.get("denials")
        gate.denials = denials if isinstance(denials, int) and denials > 0 else 0
        verdict = gate.check(tool_name, tool_input, subagent=False)
        state.update({"mode": mode, "steps": gate.steps, "denials": gate.denials})
        _write(state_path, state)
    finally:
        lock.unlink(missing_ok=True)
    return {} if verdict is None else _deny(verdict[1])


def decision(payload: dict, env: dict | None = None) -> dict:
    env = os.environ if env is None else env
    if env.get(HOSTED_PLANE_ENV):
        return {}
    boundary = _boundary()
    event = payload.get("hook_event_name")
    if event == "UserPromptSubmit":
        return on_prompt(payload, boundary)
    if event == "PreToolUse":
        return on_tool(payload, boundary)
    return {}


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        out = decision(payload if isinstance(payload, dict) else {})
    except Exception:  # noqa: BLE001 - a hook that raises fails a call the researcher was entitled to make
        out = {}
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
