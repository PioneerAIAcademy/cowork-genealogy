"""Repo-wide lint: text-mode file I/O and subprocess capture must pass ``encoding=``.

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
  - ``subprocess.run(...)`` / ``.check_output(...)`` / ``.Popen(...)`` / ``.call(...)`` /
    ``.check_call(...)`` -- the same failure class, one call shape over: CPython's own
    gate is ``self.text_mode = encoding or errors or text or universal_newlines``
    (``subprocess.Popen.__init__``), pure truthiness on any of the three flag keywords,
    decoded with the platform default unless ``encoding=`` is also truthy. Matched only
    on the ``subprocess.<name>`` attribute form (this repo's sole convention -- no
    ``from subprocess import run`` and no ``import subprocess as ...`` alias exists
    today; widening past a bare ``subprocess`` name, like widening ``open()`` past a
    bare `Name`, is unaudited if either shows up) so it needs no ``x.open``-style
    disambiguation for now. A call in binary mode (none of the three flags set) does no
    decoding and is out of scope, same as ``open()``'s binary-mode carve-out above --
    found live 2026-08-18 (issue #1399 follow-on): six ``mock_mcp.py`` sites hit exactly
    this decoding a live tool's UTF-8 stdout as cp1252, in a background reader thread
    whose crash the caller only saw as a swallowed ``None`` and a wasted retry. Keyword
    matches only (both `text=`/`universal_newlines=` and `**kwargs`-forwarded flags are
    real AST-analysis limits, not tracked here) -- same class of gap as `encoding=<expr>`
    below, which this lint already accepts as unprovable statically.

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

# Matched only as subprocess.<name>(...) -- see module docstring.
SUBPROCESS_METHODS = frozenset({"run", "check_output", "Popen", "call", "check_call"})


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


def _is_subprocess_call(call: ast.Call) -> str | None:
    """The method name if this is subprocess.<name>(...), else None."""
    func = call.func
    if (
        isinstance(func, ast.Attribute)
        and func.attr in SUBPROCESS_METHODS
        and isinstance(func.value, ast.Name)
        and func.value.id == "subprocess"
    ):
        return func.attr
    return None


TEXT_MODE_KEYWORDS = frozenset({"text", "universal_newlines", "errors"})


def _is_text_mode(call: ast.Call) -> bool:
    """True if text=, universal_newlines=, or errors= is passed as a keyword
    with a truthy constant value.

    Mirrors CPython's actual gate (``subprocess.Popen.__init__``):
    ``self.text_mode = encoding or errors or text or universal_newlines`` --
    plain truthiness, not an identity check against the ``True`` singleton, so
    ``text=1`` genuinely puts the pipe in text mode and this must catch it too.
    ``encoding`` is deliberately left out of this set: a truthy ``encoding=``
    already satisfies ``_has_encoding`` below, so it can never itself be an
    offender; including it here would only ever be a no-op.

    Only keywords are checked. ``text``/``encoding``/``errors`` are
    keyword-only in the real signature, but ``universal_newlines`` is not --
    it sits before the ``*`` in ``Popen.__init__`` and could in principle be
    passed positionally through `run`/`Popen`/`call`/`check_call`. No call
    site in this repo does that today (verified), and matching positional
    args generically would require tracking each wrapper's own parameter
    order, which this lint does not attempt.
    """
    return any(
        kw.arg in TEXT_MODE_KEYWORDS
        and isinstance(kw.value, ast.Constant)
        and bool(kw.value.value)
        for kw in call.keywords
    )


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
        elif (
            (subprocess_method := _is_subprocess_call(node))
            and _is_text_mode(node)
            and not _has_encoding(node)
        ):
            offenders.append((node.lineno, f"subprocess.{subprocess_method}"))
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
        'bare text-mode I/O found -- CLAUDE.md requires encoding="utf-8" on every '
        "read_text/write_text/open and every text-mode subprocess call:\n  "
        + "\n  ".join(sorted(offenders))
    )


def test_no_aliased_subprocess_import():
    """`subprocess.<name>(...)` is the only form `_is_subprocess_call` matches, so an
    alias or a direct import hides a real offender while the lint still goes green.
    Nothing else detects that: widen `_is_subprocess_call`, do not skip this."""
    offenders: list[str] = []
    for path in _iter_python_files(REPO_ROOT):
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, ValueError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                offenders += [
                    f"{rel}:{node.lineno}: import subprocess as {a.asname}"
                    for a in node.names
                    if a.name == "subprocess" and a.asname
                ]
            elif isinstance(node, ast.ImportFrom) and node.module == "subprocess":
                offenders.append(f"{rel}:{node.lineno}: from subprocess import ...")
    assert not offenders, (
        "the encoding lint only matches subprocess.<name>(...) -- widen "
        "_is_subprocess_call before introducing:\n  " + "\n  ".join(sorted(offenders))
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


def test_subprocess_text_mode_without_encoding_is_flagged():
    # text=True (or its older spelling) puts the pipe in text mode, decoded
    # with the platform default unless encoding= is also given -- the exact
    # shape that crashed mock_mcp.py on Windows (module docstring).
    assert _offenders_in("subprocess.run(cmd, text=True)") == [(1, "subprocess.run")]
    assert _offenders_in("subprocess.run(cmd, universal_newlines=True)") == [
        (1, "subprocess.run")
    ]
    assert _offenders_in("subprocess.check_output(cmd, text=True)") == [
        (1, "subprocess.check_output")
    ]
    assert _offenders_in("subprocess.Popen(cmd, text=True)") == [(1, "subprocess.Popen")]
    # encoding= present -- passes, same as the file-I/O rule above.
    assert _offenders_in('subprocess.run(cmd, text=True, encoding="utf-8")') == []
    assert _offenders_in("subprocess.run(cmd, text=True, encoding=None)") == [
        (1, "subprocess.run")
    ]
    # Binary mode (neither flag set) does no decoding -- out of scope, not an offender.
    assert _offenders_in("subprocess.run(cmd, capture_output=True)") == []
    # Only the subprocess.<name> attribute form is matched (this repo's sole
    # convention) -- an unrelated .run(...) on some other object is not subprocess's.
    assert _offenders_in("session.run(cmd, text=True)") == []
