"""A COMMAND hook must spell the stop key `continue`, not `continue_`.

Both spellings look right and only one works, per context, and getting it wrong
fails SILENTLY: the CLI sees an unrecognised key, drops the stop, and the hook
reads as one with no opinion. There is no error and no log line.

  * An SDK **callback** returns a dict that `claude_agent_sdk`'s
    `_convert_hook_output_for_cli` rewrites (`_internal/query.py:62-74`,
    `continue_` -> `continue`). So the prototype's `_halt`
    (`proto/worker/options.py:392`) spelling it `continue_` is CORRECT.
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

import ast
import json
import shlex
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1]
REPO = SERVER.parent.parent
PLUGIN_HOOKS = REPO / "packages" / "engine" / "plugin" / "hooks"

# Every command hook in the repo: a script a `hooks.json` shells, whose stdout
# the CLI parses. Discovered from the hooks.json files rather than hardcoded, so
# a new command hook is covered without editing this list.
HOOK_MANIFESTS = (PLUGIN_HOOKS / "hooks.json",)


unresolved: list[str] = []


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
                    # `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/x.py" --flag` -> x.py.
                    # Take the first .py token, not the last path segment: a
                    # trailing argument made `rsplit("/")` yield `x.py" --flag`,
                    # which resolves to nothing and was skipped IN SILENCE.
                    cmd = h.get("command", "")
                    name = ""
                    for tok in shlex.split(cmd, posix=True):
                        if tok.endswith(".py"):
                            name = tok.rsplit("/", 1)[-1]
                            break
                    resolved = manifest.parent / name if name else None
                    if resolved is not None and resolved.exists():
                        out.append(resolved)
                    else:
                        # Never skip quietly. An unresolvable command is a hook
                        # this guard would otherwise not check at all.
                        unresolved.append(cmd)
    return out


def test_every_command_hook_resolves_to_a_file():
    """A command whose script cannot be resolved is a hook nobody checks."""
    unresolved.clear()
    _command_hook_scripts()
    assert not unresolved, (
        "these hooks.json commands did not resolve to a file on disk, so the "
        f"spelling guard below never ran on them: {unresolved}"
    )


def test_there_are_command_hooks_to_check():
    """Premise. If the discovery breaks, every test below passes vacuously."""
    found = _command_hook_scripts()
    assert found, f"no command hooks discovered from {[str(m) for m in HOOK_MANIFESTS]}"


@pytest.mark.parametrize("script", _command_hook_scripts(), ids=lambda p: p.name)
def test_no_command_hook_emits_the_callback_spelling(script: Path):
    """`continue_` in a command hook is a stop the CLI will never see.

    Parsed, not grepped. The substring check this replaced matched only the
    double-quoted key: `{'continue_': False}` and `dict(continue_=False)` both
    sailed past it, which is two of the three ways to write the bug. An
    `ast.Constant` equal to `"continue_"` catches every quoting style, and a
    keyword named `continue_` catches the `dict(...)` form. Equality is what
    keeps a comment or docstring EXPLAINING the trap legal: prose mentioning
    the spelling contains it, and is never equal to it.
    """
    src = script.read_text(encoding="utf-8")
    offenders: list[str] = []
    for node in ast.walk(ast.parse(src, filename=str(script))):
        if isinstance(node, ast.Constant) and node.value == "continue_":
            offenders.append(f"string literal at line {node.lineno}")
        elif isinstance(node, ast.keyword) and node.arg == "continue_":
            offenders.append(f"keyword argument at line {getattr(node, 'lineno', '?')}")
    assert not offenders, (
        f"{script.name} emits the key `continue_` ({'; '.join(offenders)}). A "
        "command hook's stdout reaches the CLI unrenamed, so the stop is "
        'silently dropped. Use "continue". The SDK-callback spelling is '
        "correct only in a callback (see proto/worker/options.py:392)."
    )


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
