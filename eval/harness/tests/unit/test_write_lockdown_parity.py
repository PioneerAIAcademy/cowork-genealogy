"""The write-lockdown copies must agree (issue #1228).

The raw-write lockdown — deny `Write`/`Edit`/`NotebookEdit` on `research.json`
and `tree.gedcomx.json` — exists in three implementations, in three packages,
that cannot import each other:

    packages/engine/plugin/hooks/guard_project_files.py   ships into the VM
    apps/server/app/agent/real_agent.py                   hosted control plane
    eval/harness/e2e/orchestrator.py                      e2e harness

Each is tested on its own. Nothing compared them, so a change to
`PROTECTED_PROJECT_FILES`, to the tool tuple, or to path normalisation could
land in one and not the others.

That is not hypothetical. A POSIX-only path split made the **e2e** copy a silent
no-op on Windows — the platform the genealogist team runs — between #914 and
#984. The plugin copy shipped after the fix and never carried the bug, but it
shipped as a copy of a rule that had.

**Vector-driven, not a string diff.** The three are behaviourally identical
today but textually different: the predicate is `protected_target` in one and
`direct_project_file_write` in the other two, and `real_agent` factors the tool
tuple out into `_FILE_WRITE_TOOLS`. Comparing source would fail on cosmetics and
pass on a real divergence.

**Extracted with `ast`, not imported.** The three live in packages with separate
virtualenvs (`apps/server` is its own uv project) and their modules pull in
`claude_agent_sdk` at import time. Every predicate is pure stdlib, so lifting
just the constants and the function into a clean namespace exercises the real
code without needing any of that. Extraction failing is a hard error, never a
skip — a renamed predicate must break this test, not silently empty it.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[4]

# (label, path, predicate name). Adding a copy means adding it here — and the
# `no unregistered copy` test below fails if you forget.
IMPLEMENTATIONS: list[tuple[str, Path, str]] = [
    (
        "plugin-hook",
        REPO / "packages/engine/plugin/hooks/guard_project_files.py",
        "protected_target",
    ),
    (
        "hosted-sdk-hook",
        REPO / "apps/server/app/agent/real_agent.py",
        "direct_project_file_write",
    ),
    (
        "e2e-harness",
        REPO / "eval/harness/e2e/orchestrator.py",
        "direct_project_file_write",
    ),
]

WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")


def _load(path: Path, func_name: str):
    """`(predicate, PROTECTED_PROJECT_FILES)` lifted out of `path`.

    Pulls the module-level assignments the predicate closes over plus the
    function itself, and execs only those in an empty namespace.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))

    def is_literal(node: ast.expr) -> bool:
        """Only pure literals get lifted. A module-level `Path(__file__)…`
        would need imports we deliberately are not executing."""
        try:
            ast.literal_eval(node)
        except (ValueError, TypeError, SyntaxError, MemoryError):
            return False
        return True

    wanted: list[ast.stmt] = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and is_literal(node.value):
            wanted.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name == func_name:
            wanted.append(node)

    ns: dict = {}
    exec(  # noqa: S102 - executing repo source under test, by design
        compile(ast.Module(body=wanted, type_ignores=[]), str(path), "exec"), ns
    )
    if func_name not in ns:
        raise AssertionError(
            f"{path.relative_to(REPO)} has no top-level `{func_name}`. If the "
            f"predicate was renamed or moved, update IMPLEMENTATIONS — do not "
            f"delete this test."
        )
    if "PROTECTED_PROJECT_FILES" not in ns:
        raise AssertionError(
            f"{path.relative_to(REPO)} has no PROTECTED_PROJECT_FILES."
        )
    return ns[func_name], tuple(ns["PROTECTED_PROJECT_FILES"])


LOADED = [(label, *_load(path, name)) for label, path, name in IMPLEMENTATIONS]


# (tool_name, tool_input, expected basename or None)
VECTORS: list[tuple[str, dict | None, str | None]] = [
    # --- the deny set, every write tool x every protected file ---
    *[
        (tool, {"file_path": f"/project/{name}"}, name)
        for tool in WRITE_TOOLS
        for name in ("research.json", "tree.gedcomx.json")
    ],
    # --- Windows separators: the #984 regression, on the team's own platform ---
    ("Write", {"file_path": r"C:\Users\gen\proj\research.json"}, "research.json"),
    ("Edit", {"file_path": r"C:\Users\gen\proj\tree.gedcomx.json"}, "tree.gedcomx.json"),
    ("Write", {"file_path": "research.json"}, "research.json"),  # bare, no dir
    # --- no opinion: not a write tool ---
    # MultiEdit stands in for a copy quietly WIDENING its tool tuple. The
    # protected-file set has its own equality test below; the tool set has only
    # these vectors, so without a negative here an addition to one copy's tuple
    # passes every other assertion in the module.
    ("MultiEdit", {"file_path": "/project/research.json"}, None),
    ("Read", {"file_path": "/project/research.json"}, None),
    ("Bash", {"command": "cat research.json"}, None),
    ("Glob", {"pattern": "**/research.json"}, None),
    ("mcp__genealogy__research_append", {"file_path": "/p/research.json"}, None),
    ("mcp__genealogy__tree_edit", {"file_path": "/p/tree.gedcomx.json"}, None),
    # --- no opinion: basename match, not substring ---
    ("Write", {"file_path": "/project/results/log_001.json"}, None),
    ("Write", {"file_path": "/project/research.json.bak"}, None),
    ("Write", {"file_path": "/project/my-research.json"}, None),
    ("Write", {"file_path": "/project/notes/tree.gedcomx.json.tmp"}, None),
    # --- degenerate input: must return None, never raise ---
    ("Write", {}, None),
    ("Write", None, None),
    ("Write", {"file_path": ""}, None),
    ("Write", {"file_path": None}, None),
    ("", {"file_path": "/project/research.json"}, None),
]


# A list of ids, not a callable: pytest applies an `ids=` callable to each
# argument separately, so it would be handed the function object and put its
# memory address in the test id (different every run).
@pytest.mark.parametrize(
    "label,predicate,protected", LOADED, ids=[label for label, _, _ in LOADED]
)
def test_each_implementation_was_actually_loaded(label, predicate, protected):
    """Guards the loader: an empty namespace would make every test below pass."""
    assert callable(predicate), f"{label}: predicate did not load"
    assert protected, f"{label}: PROTECTED_PROJECT_FILES is empty"


def test_all_implementations_protect_the_same_files():
    sets = {label: protected for label, _, protected in LOADED}
    # frozenset, not the tuple: membership is what the predicates test, so
    # reordering the two names is behaviour-neutral and must not fail here.
    distinct = {frozenset(v) for v in sets.values()}
    assert len(distinct) == 1, (
        "PROTECTED_PROJECT_FILES has diverged across the lockdown copies — a "
        f"file protected in one place and not another: {sets}"
    )


@pytest.mark.parametrize("tool_name,tool_input,expected", VECTORS)
def test_every_implementation_agrees_on_this_vector(tool_name, tool_input, expected):
    """The point of the whole module: one vector, all copies, same answer."""
    answers = {}
    for label, predicate, _ in LOADED:
        try:
            answers[label] = predicate(tool_name, tool_input)
        except Exception as exc:  # noqa: BLE001 - a raise here IS the failure
            pytest.fail(
                f"{label} raised on ({tool_name!r}, {tool_input!r}): {exc!r}. "
                "These predicates run in front of every tool call and must "
                "never raise — a failure here fails a call the user was "
                "entitled to make."
            )
    disagreeing = {k: v for k, v in answers.items() if v != expected}
    assert not disagreeing, (
        f"({tool_name!r}, {tool_input!r}) should give {expected!r}; "
        f"these disagree: {disagreeing}"
    )


def test_no_unregistered_copy_of_the_lockdown_exists():
    """A fourth copy that skips IMPLEMENTATIONS is exactly the drift this
    module exists to prevent, so finding one is a failure, not a warning."""
    # `--untracked` matters: without it a copy added but not yet staged is
    # invisible, so this test would pass on exactly the commit that introduces
    # the drift. (It did, once, while being written.)
    #
    # Matched on an ASSIGNMENT, not a mention: a plain-string search also hits
    # any test, comment, or doc script that merely names the constant, and that
    # file would then fail here as a phantom "unregistered copy". `[[:space:]]`,
    # not `\s` — `git grep -E` is POSIX ERE, where `\s` matches nothing and every
    # registered copy reads as missing.
    found = subprocess.run(
        [
            "git",
            "grep",
            "-lE",
            "--untracked",
            r"PROTECTED_PROJECT_FILES[[:space:]]*[:=]",
            "--",
            "*.py",
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    files = {
        (REPO / line).resolve()
        for line in found.stdout.splitlines()
        if line and not line.endswith(Path(__file__).name)
    }
    registered = {path.resolve() for _, path, _ in IMPLEMENTATIONS}
    unregistered = sorted(str(p.relative_to(REPO)) for p in files - registered)
    assert not unregistered, (
        "these files define PROTECTED_PROJECT_FILES but are not in "
        f"IMPLEMENTATIONS, so nothing checks them against the others: "
        f"{unregistered}"
    )
    missing = sorted(str(p.relative_to(REPO)) for p in registered - files)
    assert not missing, (
        f"IMPLEMENTATIONS names files that no longer define the constant: {missing}"
    )
