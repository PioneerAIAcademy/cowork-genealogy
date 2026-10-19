"""A COMMAND hook must spell the stop key `continue`, not `continue_`.

Both spellings look right and only one works, per context, and getting it wrong
fails SILENTLY: the CLI sees an unrecognised key, drops the stop, and the hook
reads as one with no opinion. There is no error and no log line.

  * An SDK **callback** returns a dict that `claude_agent_sdk`'s
    `_convert_hook_output_for_cli` rewrites (`_internal/query.py:62-74`,
    `continue_` -> `continue`). So the prototype's `_halt`
    (`proto/worker/options.py:442`) spelling it `continue_` is CORRECT.
  * A **command** hook prints JSON to stdout and the CLI reads it directly.
    No SDK is in that path, so `continue_` is never renamed and the stop is
    silently lost.

Caught on a hand-install of the phase-0 Cowork probe (2026-10-19), which had the
callback spelling in a command hook. Had it run, item 9 would have measured a
plain deny, found the turn did not end, and recorded "a halt cannot end a Cowork
turn" -- a false negative about the one question the probe exists to answer, and
the exact shape its own VOID gate was built to prevent.

Pins the rule in both directions, since a guard that only checks one is half a
guard: no command hook may emit `continue_`, and the callback that legitimately
uses it must keep it.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1]
REPO = SERVER.parent.parent
PLUGIN_HOOKS = REPO / "packages" / "engine" / "plugin" / "hooks"
PROBE = SERVER / "dev" / "step-probe"

# Every command hook in the repo: a script a `hooks.json` shells, whose stdout
# the CLI parses. Discovered from the hooks.json files rather than hardcoded, so
# a new command hook is covered without editing this list.
HOOK_MANIFESTS = (PLUGIN_HOOKS / "hooks.json", PROBE / "hooks.json")


def _command_hook_scripts() -> list[Path]:
    out: list[Path] = []
    for manifest in HOOK_MANIFESTS:
        if not manifest.exists():
            continue
        spec = json.loads(manifest.read_text(encoding="utf-8"))
        for matchers in (spec.get("hooks") or {}).values():
            for m in matchers:
                for h in m.get("hooks") or []:
                    if h.get("type") != "command":
                        continue
                    # `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/x.py"` -> x.py
                    cmd = h.get("command", "")
                    name = cmd.rsplit("/", 1)[-1].strip('"').strip("'")
                    p = manifest.parent / name
                    if p.exists():
                        out.append(p)
    return out


def test_there_are_command_hooks_to_check():
    """Premise. If the discovery breaks, every test below passes vacuously."""
    found = _command_hook_scripts()
    assert found, f"no command hooks discovered from {[str(m) for m in HOOK_MANIFESTS]}"


@pytest.mark.parametrize("script", _command_hook_scripts(), ids=lambda p: p.name)
def test_no_command_hook_emits_the_callback_spelling(script: Path):
    """`continue_` in a command hook is a stop the CLI will never see."""
    src = script.read_text(encoding="utf-8")
    # The string as it would be EMITTED, i.e. a JSON key. A mention in a comment
    # explaining the trap is fine and must stay allowed, or the explanation
    # cannot be written down.
    assert '"continue_"' not in src, (
        f"{script.name} emits the key \"continue_\". A command hook's stdout "
        "reaches the CLI unrenamed, so the stop is silently dropped. Use "
        '"continue". The SDK-callback spelling is correct only in a callback '
        "(see proto/worker/options.py:442)."
    )


def test_the_probe_halt_arm_emits_a_stop_the_cli_can_read():
    """End to end: run the real script and read its stdout, not its source.

    A source scan alone would pass if the key were built dynamically. This
    executes the hook the way the CLI does.
    """
    script = PROBE / "probe_step_hooks.py"
    if not script.exists():
        pytest.skip("step-probe not present")
    proc = subprocess.run(
        [sys.executable, str(script)],
        input=json.dumps({
            "hook_event_name": "PreToolUse",
            "tool_name": "Agent",
            "tool_input": {"p": "STEP_PROBE_HALT"},
        }),
        capture_output=True, text=True, encoding="utf-8", timeout=30, check=False,
        env={"STEP_PROBE_LOG": "/dev/null", "STEP_PROBE_STATE": "/dev/null",
             "PATH": "/usr/bin:/bin"},
    )
    assert proc.returncode == 0, f"hook exited {proc.returncode}: {proc.stderr[:300]}"
    out = json.loads(proc.stdout or "{}")
    assert out.get("continue") is False, f"no CLI-readable stop in {out}"
    assert "continue_" not in out, f"callback spelling leaked into stdout: {out}"
    # The halt must ALSO deny, or the call it fires on still runs.
    assert (out.get("hookSpecificOutput") or {}).get("permissionDecision") == "deny"


def test_the_prototype_callback_keeps_the_callback_spelling():
    """The other direction. `_halt` is a CALLBACK and `continue_` is right there;
    'fixing' it to `continue` would break the prototype's only turn-ender."""
    src = (SERVER / "proto" / "worker" / "options.py").read_text(encoding="utf-8")
    assert '"continue_": False' in src, (
        "proto/worker/options.py no longer emits `continue_`. That spelling is "
        "CORRECT in an SDK callback, which _halt is: the SDK renames it to "
        "`continue` for the CLI. Changing it to `continue` would send a key the "
        "SDK does not rename and the CLI does not expect."
    )
