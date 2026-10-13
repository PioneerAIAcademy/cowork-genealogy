"""Repo-wide lint: Unix-only stdlib modules must not be imported at import time.

A top-level ``import pwd`` in ``apps/server/proto/worker/turn_users.py`` made
``proto.worker.worker`` unimportable on Windows, so ``make server-test`` -- and
``make test-all`` -- failed for every Windows developer whatever their PR touched
(issue #3288, fixed in PR #3308). CI runs on Linux only, where ``pwd`` exists, so
nothing caught it. This lint reads source, not platform, so a Linux runner catches
a Windows break (issue #3310).

The rule: an import of a module in ``UNIX_ONLY`` anywhere that runs at import time
is flagged. That is everywhere except inside a ``def`` or ``async def`` body --
class bodies and module-level ``if``/``try``/``with``/``for``/``match``
blocks all run on import. There is no exemption for ``try: ... except ImportError``
or ``if sys.platform ...``; the fix is a function-local import, as in
``turn_users.parse``. ``from .pwd import x`` (``level > 0``) is a local module and
is not flagged. The body of an ``if TYPE_CHECKING:`` block never runs, so it is
not flagged; its ``else:`` branch does run and is.

The lint checks where an import is written, not what runs: a module-level call
to a function holding a lazy import (``_X = _uid()``) still imports ``pwd`` on
load and is not caught. Nothing in the repo does that today.

An AST pass, not a grep, for the same reason as ``test_encoding_lint.py``: a
per-line grep false-flags a lazy import with unusual indentation and misses one in
a multi-line parenthesised form.
"""

from __future__ import annotations

import ast

from tests.unit.test_encoding_lint import REPO_ROOT, _iter_python_files

UNIX_ONLY = frozenset(
    {
        "pwd",
        "grp",
        "fcntl",
        "termios",
        "resource",
        "posix",
        "syslog",
        "crypt",
        "spwd",
        "pty",
        "tty",
        "curses",
        "readline",
    }
)

LAZY_EXAMPLE = "apps/server/proto/worker/turn_users.py"

# 504 .py files on 2026-10-12. parents[3] lands on eval/, which has its own
# CLAUDE.md and 340 .py files -- the floor sits above that so a wrong root fails
# here, not just on the LAZY_EXAMPLE check, and leaves room for a cleanup PR.
MIN_FILES_SCANNED = 400


class _ImportTimeImports(ast.NodeVisitor):
    def __init__(self) -> None:
        self.hits: list[tuple[int, str]] = []

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        return

    def visit_If(self, node: ast.If) -> None:
        test = node.test
        name = test.id if isinstance(test, ast.Name) else getattr(test, "attr", None)
        if name == "TYPE_CHECKING":
            for child in node.orelse:
                self.visit(child)
            return
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name.split(".")[0] in UNIX_ONLY:
                self.hits.append((node.lineno, alias.name))

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.level == 0 and node.module and node.module.split(".")[0] in UNIX_ONLY:
            self.hits.append((node.lineno, node.module))


def _offenders_in(source: str) -> list[tuple[int, str]]:
    """(lineno, module) for every Unix-only import that runs at import time."""
    visitor = _ImportTimeImports()
    visitor.visit(ast.parse(source))
    return visitor.hits


def test_no_unix_only_import_at_import_time():
    assert (REPO_ROOT / "pnpm-workspace.yaml").is_file(), (
        f"repo-root detection is wrong: {REPO_ROOT} has no pnpm-workspace.yaml; "
        "the lint would scan the wrong tree (a false green)."
    )

    scanned: set[str] = set()
    offenders: list[str] = []
    unparseable: list[str] = []
    for path in _iter_python_files(REPO_ROOT):
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            hits = _offenders_in(path.read_text(encoding="utf-8"))
        except (SyntaxError, ValueError, UnicodeDecodeError) as exc:
            unparseable.append(f"{rel}: {type(exc).__name__}: {exc}")
            continue
        scanned.add(rel)
        offenders += [
            f"{rel}:{lineno}: import of {module} runs at import time" for lineno, module in hits
        ]

    assert not unparseable, (
        "Unix-only import lint could not parse these files, so it did not scan them:\n  "
        + "\n  ".join(sorted(unparseable))
    )
    assert len(scanned) > MIN_FILES_SCANNED, (
        f"scanned only {len(scanned)} .py files under {REPO_ROOT}; expected more than "
        f"{MIN_FILES_SCANNED}. The walk is looking at the wrong tree."
    )
    assert LAZY_EXAMPLE in scanned, f"{LAZY_EXAMPLE} was not scanned"
    assert not offenders, (
        "Unix-only module imported at import time -- the module cannot be imported on "
        "Windows, which breaks the test suite for the Windows half of the team. Move "
        "the import inside the function that uses it (see turn_users.parse):\n  "
        + "\n  ".join(sorted(offenders))
    )


def test_import_time_shapes_are_flagged():
    assert _offenders_in("import pwd") == [(1, "pwd")]
    assert _offenders_in("from pwd import getpwnam") == [(1, "pwd")]
    assert _offenders_in("import os, pwd") == [(1, "pwd")]
    assert _offenders_in("import os.path, fcntl as f") == [(1, "fcntl")]
    assert _offenders_in("import curses.ascii") == [(1, "curses.ascii")]
    assert _offenders_in("from curses.ascii import isprint") == [(1, "curses.ascii")]
    assert _offenders_in("from pwd import (\n    getpwnam,\n    getpwuid,\n)") == [(1, "pwd")]
    assert _offenders_in("class C:\n    import pwd") == [(2, "pwd")]
    assert _offenders_in("try:\n    import pwd\nexcept ImportError:\n    pwd = None") == [
        (2, "pwd")
    ]
    assert _offenders_in("try:\n    pass\nexcept ImportError:\n    import grp") == [(4, "grp")]
    assert _offenders_in("try:\n    pass\nfinally:\n    import grp") == [(4, "grp")]
    assert _offenders_in('import sys\nif sys.platform != "win32":\n    import fcntl') == [
        (3, "fcntl")
    ]
    assert _offenders_in("with x:\n    import termios") == [(2, "termios")]
    assert _offenders_in("for _ in x:\n    import tty") == [(2, "tty")]
    assert _offenders_in("match x:\n    case 1:\n        import pty") == [(3, "pty")]
    assert _offenders_in("if TYPE_CHECKING:\n    pass\nelse:\n    import pwd") == [(4, "pwd")]
    assert _offenders_in("if not TYPE_CHECKING:\n    import pwd") == [(2, "pwd")]


def test_every_unix_only_module_is_flagged():
    # Issue #3310's list, spelled out so a dropped or mistyped UNIX_ONLY entry fails.
    issue_list = "pwd grp fcntl termios resource posix syslog crypt spwd pty tty curses readline"
    for module in issue_list.split():
        assert _offenders_in(f"import {module}") == [(1, module)], module
        assert _offenders_in(f"from {module} import x") == [(1, module)], module


def test_lazy_and_local_shapes_are_not_flagged():
    assert _offenders_in("def f():\n    import pwd") == []
    assert _offenders_in("async def f():\n    from pwd import getpwnam") == []
    assert _offenders_in("class C:\n    def m(self):\n        import pwd") == []
    assert _offenders_in("def f():\n    class C:\n        import pwd") == []
    assert _offenders_in("from .pwd import x") == []
    assert _offenders_in("from . import pwd") == []
    assert _offenders_in("import pwdx\nimport posixpath") == []
    assert _offenders_in("from os import path") == []
    assert _offenders_in("if TYPE_CHECKING:\n    import resource") == []
    assert _offenders_in("if typing.TYPE_CHECKING:\n    from pwd import struct_passwd") == []


def test_turn_users_lazy_import_is_accepted():
    """The real fix shape must stay green. Proven non-vacuous first: if the lazy
    import in parse() is ever removed, this test stops testing anything."""
    source = (REPO_ROOT / LAZY_EXAMPLE).read_text(encoding="utf-8")
    lazy = [
        node
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Import) and any(a.name == "pwd" for a in node.names)
    ]
    assert lazy, f"{LAZY_EXAMPLE} no longer imports pwd; pick another lazy example"
    assert _offenders_in(source) == []
