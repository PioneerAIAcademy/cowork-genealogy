"""Repo-wide lint: text-mode file I/O must pass an ``encoding=`` keyword.

CLAUDE.md section "Python file I/O" requires ``encoding="utf-8"`` on every Python
``read_text`` / ``write_text`` / ``open`` on a text file, with no exceptions. A bare
call uses the platform default (cp1252 on Windows) and raises ``UnicodeDecodeError``
on the em-dashes and smart quotes our JSON, SKILL.md, and research.json routinely
contain -- green on macOS/Linux, broken for the Windows genealogist team.

This is an AST pass, not a line grep (issues #1233, #1285): dozens of correct call
sites in this repo put ``encoding=`` on a *later physical line* than the call, which
a per-line grep false-flags and a file-level grep false-misses. Parsing the tree
sidesteps both, and lets this lint scan its own source safely -- the method names
below appear only as string literals, never as bare calls.

Matching rules:
  - ``path.read_text(...)`` / ``path.write_text(...)`` -- an attribute call; flagged
    when it has no ``encoding=`` keyword.
  - bare ``open(...)`` -- a Name call only, so ``Image.open`` / ``webbrowser.open`` /
    ``gzip.open`` (attribute calls) are excluded structurally, no lookbehind needed.
    This is the issue's chosen scope, and it also drops attribute opens that ARE real
    text offenders (``Path(...).open()``, ``io.open``, ``builtins.open``) because
    ``x.open`` is ambiguous; widening it safely is #1355. Binary mode (a ``"b"`` in the
    2nd positional arg or a ``mode=`` kwarg) is skipped; the rest are flagged when they
    have no ``encoding=`` keyword.

Generated / vendored trees we neither own nor can fix are skipped.
"""

from __future__ import annotations

import ast
import warnings
from pathlib import Path

# <repo>/eval/harness/tests/unit/test_encoding_lint.py -> parents[4] == <repo>.
REPO_ROOT = Path(__file__).resolve().parents[4]

# Requirement (a): generated / vendored trees. eval/harness/.venv alone holds
# ~2277 .py files created by `uv sync` before pytest runs, none fixable by us.
#
# `worktrees` is here for a different reason: it is another *commit* of this
# same repo, not code anyone is editing. `.claude/skills/review` tells reviewers
# to run `git worktree add .claude/worktrees/pr<N> <branch>`, so following the
# documented review workflow plants a full second copy of the tree inside the
# repo — and every pre-fix .py in that branch is reported as an offender here.
# Observed 2026-08-12: one stale `pr1373` worktree produced 100 findings, none
# of them in a file on this branch. CI never saw it (fresh checkout, no
# worktrees), so this only ever fires locally, which is the worst shape for a
# lint: red on the developer's machine, green in the pipeline, and nothing in
# the output hinting that the paths are not theirs to fix.
SKIP_DIR_NAMES = frozenset(
    {".venv", "node_modules", "__pycache__", "build", "worktrees"}
)

# Always called on a Path receiver; both take an encoding= keyword.
TEXT_METHODS = frozenset({"read_text", "write_text"})


def _iter_python_files(root: Path):
    for path in root.rglob("*.py"):
        if SKIP_DIR_NAMES.intersection(path.relative_to(root).parts):
            continue
        yield path


def _is_binary_open(call: ast.Call) -> bool:
    """True if this open(...) is binary mode -- 2nd positional or mode= kwarg has a 'b'."""
    mode = None
    if len(call.args) >= 2 and isinstance(call.args[1], ast.Constant):
        mode = call.args[1].value
    for kw in call.keywords:
        if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
            mode = kw.value.value
    return isinstance(mode, str) and "b" in mode


def _has_encoding(call: ast.Call) -> bool:
    # A present encoding= satisfies the rule -- UNLESS it is a literal
    # encoding=None. None is the platform default (cp1252 on Windows) this lint
    # exists to catch, so it must not pass (issue #1285 review). Any non-None
    # expression (encoding=enc, encoding="utf-8") is left alone; only a constant
    # None is rejected.
    return any(
        kw.arg == "encoding"
        and not (isinstance(kw.value, ast.Constant) and kw.value.value is None)
        for kw in call.keywords
    )


def _offenders_in(source: str) -> list[tuple[int, str]]:
    """(lineno, call_name) for every bare text-mode read_text/write_text/open."""
    offenders: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr in TEXT_METHODS:
            if not _has_encoding(node):
                offenders.append((node.lineno, func.attr))
        elif isinstance(func, ast.Name) and func.id == "open":
            if not _is_binary_open(node) and not _has_encoding(node):
                offenders.append((node.lineno, "open"))
    return offenders


def test_no_bare_text_mode_file_io():
    assert REPO_ROOT.joinpath("CLAUDE.md").is_file(), (
        f"repo-root detection is wrong: {REPO_ROOT} has no CLAUDE.md; "
        "the lint would scan the wrong tree (a false green)."
    )

    offenders: list[str] = []
    unparseable: list[str] = []
    for path in _iter_python_files(REPO_ROOT):
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            hits = _offenders_in(path.read_text(encoding="utf-8"))
        except (SyntaxError, ValueError, UnicodeDecodeError) as exc:
            # Defensive skip for a file the harness parser (Python 3.11) genuinely
            # cannot parse -- e.g. a future apps/server file using 3.12-only syntax
            # (apps/server targets >=3.12). Today every apps/server file parses
            # under 3.11, so apps/server IS scanned; this branch guards against a
            # parser-version mismatch false-redding the lint, it does not mean any
            # tree is unscanned. Skipped files are surfaced as a warning (below),
            # never silent.
            unparseable.append(f"{rel}: {type(exc).__name__}: {exc}")
            continue
        for lineno, name in hits:
            offenders.append(f'{rel}:{lineno}: {name}() has no encoding= (add encoding="utf-8")')

    if unparseable:
        # warnings.warn, not print: pytest captures stdout and shows it only on
        # failure, so a print would hide a skipped file on the green runs where it
        # matters most. A warning lands in pytest's warnings summary on pass too.
        warnings.warn(
            "encoding lint could not parse and skipped these files (not scanned):\n  "
            + "\n  ".join(sorted(unparseable)),
            stacklevel=2,
        )

    assert not offenders, (
        'bare text-mode file I/O found -- CLAUDE.md requires encoding="utf-8" on every '
        "read_text/write_text/open:\n  " + "\n  ".join(sorted(offenders))
    )


def test_encoding_none_is_flagged():
    # A literal encoding=None is the platform default (cp1252 on Windows) this
    # lint exists to catch, so it must be flagged, not waved through by the mere
    # presence of an encoding= keyword (issue #1285 review).
    assert _offenders_in("p.read_text(encoding=None)") == [(1, "read_text")]
    assert _offenders_in("open(f, encoding=None)") == [(1, "open")]
    # A real encoding -- and any non-None expression -- still passes.
    assert _offenders_in('p.read_text(encoding="utf-8")') == []
    assert _offenders_in("open(f, encoding=enc)") == []
