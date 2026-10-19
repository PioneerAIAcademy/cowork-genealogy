#!/usr/bin/env python3
"""Assemble the phase-0 probe as a plugin directory Cowork can load.

    python3 setup.py [DEST]        # default: ./step-probe-plugin

`hooks.json` resolves its command through `${CLAUDE_PLUGIN_ROOT}/hooks/`, so the
two files have to sit at `<plugin>/hooks/`. Doing that by hand is the step most
likely to go wrong, and a probe installed wrong looks exactly like a probe whose
answers are all negative -- which is the failure `read_probe.py`'s VOID gate
exists to catch, and which is cheaper to prevent here.

Cross-platform on purpose: the probe runs on whichever machine has Cowork, which
is macOS or Windows, not the Linux box this was written on.

Verifies rather than assumes:
  * `python3` launches a real Python 3 (on stock Windows the name resolves to a
    Microsoft Store alias, and `hooks.json` shells that exact name -- the same
    check `probe_hook_binding.py` makes, for the same reason);
  * the assembled script actually runs and prints valid JSON;
  * the halt sentinel really produces the turn-ending pair, so item 9 is live
    before the session rather than after it.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES = ("hooks.json", "probe_step_hooks.py")
# Cowork will not install a plugin without it: `package-plugin.mjs` throws
# on a missing `.claude-plugin/plugin.json` for the shipped plugin, and the
# hand-install of this probe needed one too (2026-10-19).
MANIFEST = Path(".claude-plugin") / "plugin.json"


def fail(msg: str) -> None:
    print(f"\n  FAILED: {msg}")
    raise SystemExit(1)


def check_python3() -> None:
    try:
        out = subprocess.run(
            ["python3", "--version"], capture_output=True, text=True,
            encoding="utf-8", timeout=20, check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        fail(f"no `python3` on PATH: {type(exc).__name__}. hooks.json shells that "
             "exact name, so the hook could not run.")
    if out.returncode != 0 or not (out.stdout or "").startswith("Python 3"):
        fail("`python3` does not launch Python 3 here. On stock Windows that name "
             "resolves to a Microsoft Store alias. Install Python 3 and make "
             "`python3 --version` work before running the probe.")
    print(f"  ok   python3 -> {out.stdout.strip()}")


def check_script(script: Path) -> None:
    """Run the assembled hook on both sentinels. A probe that cannot halt cannot
    answer item 9, and finding that out now costs nothing."""
    import os

    env = dict(os.environ)
    env["STEP_PROBE_LOG"] = str(script.parent / "_setup-check.jsonl")
    env["STEP_PROBE_STATE"] = str(script.parent / "_setup-check-state.json")

    def run(payload: dict) -> dict:
        p = subprocess.run(
            ["python3", str(script)], input=json.dumps(payload),
            capture_output=True, text=True, encoding="utf-8", timeout=30,
            check=False, env=env,
        )
        if p.returncode != 0:
            fail(f"the hook exited {p.returncode}: {p.stderr.strip()[:300]}")
        try:
            return json.loads(p.stdout or "{}")
        except json.JSONDecodeError:
            fail(f"the hook printed non-JSON: {p.stdout.strip()[:300]}")
        return {}

    ordinary = run({"hook_event_name": "PreToolUse", "tool_name": "Read",
                    "tool_input": {"file_path": "x.txt"}})
    if ordinary != {}:
        fail(f"an ordinary call was not passed through: {ordinary}")
    print("  ok   an ordinary tool call gets no opinion")

    halted = run({"hook_event_name": "PreToolUse", "tool_name": "Agent",
                  "tool_input": {"p": "STEP_PROBE_HALT"}})
    # `continue`, not `continue_`: a command hook's stdout reaches the CLI
    # unrenamed. See tests/test_command_hook_output_shape.py.
    if "continue_" in halted:
        fail(f"the halt arm emits the SDK-callback spelling `continue_`, which the "
             f"CLI never sees. Item 9 would measure a plain deny: {halted}")
    if halted.get("continue") is not False or not halted.get("stopReason"):
        fail(f"the halt sentinel did not produce the turn-ending pair: {halted}")
    print("  ok   the halt sentinel returns continue=false + stopReason (item 9 is live)")

    denied = run({"hook_event_name": "PreToolUse", "tool_name": "Write",
                  "tool_input": {"file_path": "STEP_PROBE_CANARY.txt"}})
    hso = denied.get("hookSpecificOutput") or {}
    if hso.get("permissionDecision") != "deny":
        fail(f"the deny sentinel did not deny: {denied}")
    if "continue_" in denied:
        fail("the deny sentinel carried turn-ending fields; it must not, or items "
             "5 and 9 cannot be told apart")
    print("  ok   the deny sentinel denies WITHOUT ending the turn (item 5 stays distinct)")

    for leftover in ("_setup-check.jsonl", "_setup-check-state.json"):
        (script.parent / leftover).unlink(missing_ok=True)


def main() -> int:
    dest = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (Path.cwd() / "step-probe-plugin")
    hooks = dest / "hooks"
    print(f"\nassembling the phase-0 probe plugin at:\n  {dest}\n")

    check_python3()

    hooks.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        src = HERE / name
        if not src.exists():
            fail(f"missing {name} beside setup.py")
        shutil.copy2(src, hooks / name)
    print(f"  ok   copied {', '.join(FILES)} -> {hooks}")

    src_manifest = HERE / MANIFEST
    if not src_manifest.exists():
        fail(f"missing {MANIFEST} beside setup.py; Cowork will refuse the plugin")
    (dest / MANIFEST.parent).mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_manifest, dest / MANIFEST)
    print(f"  ok   copied {MANIFEST} -> {dest / MANIFEST}")

    check_script(hooks / "probe_step_hooks.py")

    print(f"""
  READY. Point Cowork at:
      {dest}

  Then drive ONE session in a folder that holds a real project:

    1. A message that starts research, so a Skill/Agent/Task call happens on the
       main thread. This is item 1, and it is the control: no PreToolUse lines
       means the probe is not installed, not that the answers are negative.
    2. A SECOND message, so item 3 can see whether prompt_id changes per turn.
    3. "write a file named STEP_PROBE_CANARY.txt"  (item 5)
    4. TWO things where the first mentions STEP_PROBE_HALT, e.g.
         "read STEP_PROBE_HALT.txt, then write notes.txt saying done"
       This is ITEM 9, the headline. Watch whether the SECOND task happens.
       If it does, the halt did not end the turn.
       Two tasks and not one: with a single task the turn ends either way and
       the result proves nothing. That is what made run 1 of the alpha probe
       worthless and forced a second run.

  Then read it:
      python3 {HERE / "read_probe.py"} <the step-probe.jsonl you copied OUT of the VM>
""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
