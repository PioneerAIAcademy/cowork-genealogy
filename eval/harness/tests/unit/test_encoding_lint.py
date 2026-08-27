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
    Binary mode (a ``"b"`` in the 2nd positional arg or a ``mode=`` kwarg) is skipped;
    the rest are flagged when they have no ``encoding=`` keyword.
  - ``Path(...).open(...)`` / ``PurePath(...).open(...)`` / ``io.open(...)`` /
    ``builtins.open(...)`` -- the closed allow-list of dotted opens whose receiver is
    statically unambiguous. (``PurePath`` has no ``.open()`` at runtime -- only
    concrete ``Path`` does -- but the allow-list entry is defensive: it prevents a
    false negative if someone writes it, since the call would fail at runtime anyway.)
    Only inline ``Path()``/``PurePath()`` constructor calls and
    ``io``/``builtins`` module names are matched; a bare variable's ``.open()``
    (``p.open("w")`` where ``p`` came from somewhere else) is statically undecidable
    and stays uncaught. ``Path(...).open()`` takes mode as the 1st positional (no file
    arg), so binary-mode detection uses index 0 there and index 1 elsewhere.
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


def _is_binary_open(call: ast.Call, mode_arg_index: int = 1) -> bool:
    """True if this open(...) is binary mode -- positional or mode= kwarg has a 'b'.

    ``mode_arg_index`` is the 0-based position of the mode argument: 1 for
    ``open(file, mode)`` / ``io.open(file, mode)`` / ``builtins.open(file, mode)``
    where the file path comes first, and 0 for ``Path(...).open(mode)`` where the
    path is the receiver and mode is the first positional.
    """
    mode = None
    if len(call.args) > mode_arg_index and isinstance(call.args[mode_arg_index], ast.Constant):
        mode = call.args[mode_arg_index].value
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


DOTTED_OPEN_MODULES = frozenset({"io", "builtins"})
DOTTED_OPEN_CONSTRUCTORS = frozenset({"Path", "PurePath"})


def _is_dotted_text_open(call: ast.Call) -> str | None:
    """The display name if this is a known dotted text-mode open(), else None.

    Matches only forms whose receiver is statically unambiguous:
      - Path(...).open() / PurePath(...).open()  (inline constructor)
      - io.open() / builtins.open()              (module-qualified)
    A bare variable's .open() (p.open()) is statically undecidable and stays
    uncaught -- documented in the module docstring.
    """
    func = call.func
    if not (isinstance(func, ast.Attribute) and func.attr == "open"):
        return None
    receiver = func.value
    if isinstance(receiver, ast.Name) and receiver.id in DOTTED_OPEN_MODULES:
        return f"{receiver.id}.open"
    if (
        isinstance(receiver, ast.Call)
        and isinstance(receiver.func, ast.Name)
        and receiver.func.id in DOTTED_OPEN_CONSTRUCTORS
    ):
        return f"{receiver.func.id}(...).open"
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
        elif (dotted_name := _is_dotted_text_open(node)) is not None:
            mode_idx = 0 if dotted_name.endswith(").open") else 1
            if not _is_binary_open(node, mode_idx) and not _has_encoding(node):
                offenders.append((node.lineno, f"{dotted_name}()"))
        elif (
            (subprocess_method := _is_subprocess_call(node))
            and _is_text_mode(node)
            and not _has_encoding(node)
        ):
            offenders.append((node.lineno, f"subprocess.{subprocess_method}"))
    return offenders


def _scan_tree(root: Path) -> tuple[list[str], list[str]]:
    """Scan all .py files under *root*, returning (offenders, unparseable)."""
    offenders: list[str] = []
    unparseable: list[str] = []
    for path in _iter_python_files(root):
        rel = path.relative_to(root).as_posix()
        try:
            hits = _offenders_in(path.read_text(encoding="utf-8"))
        except (SyntaxError, ValueError, UnicodeDecodeError) as exc:
            unparseable.append(f"{rel}: {type(exc).__name__}: {exc}")
            continue
        for lineno, name in hits:
            offenders.append(f'{rel}:{lineno}: {name}() has no encoding= (add encoding="utf-8")')
    return offenders, unparseable


def test_no_bare_text_mode_file_io():
    assert REPO_ROOT.joinpath("CLAUDE.md").is_file(), (
        f"repo-root detection is wrong: {REPO_ROOT} has no CLAUDE.md; "
        "the lint would scan the wrong tree (a false green)."
    )

    offenders, unparseable = _scan_tree(REPO_ROOT)

    if unparseable:
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
                offenders += [
                    f"{rel}:{node.lineno}: from subprocess import {a.name}"
                    for a in node.names
                    if a.name in SUBPROCESS_METHODS or a.name == "*"
                ]
    assert not offenders, (
        "the encoding lint only matches subprocess.<name>(...) -- widen "
        "_is_subprocess_call before introducing:\n  " + "\n  ".join(sorted(offenders))
    )


def test_dotted_text_open_without_encoding_is_flagged():
    assert _offenders_in("Path(tmp).open('w')") == [(1, "Path(...).open()")]
    assert _offenders_in("PurePath(tmp).open('r')") == [(1, "PurePath(...).open()")]
    assert _offenders_in("io.open(p)") == [(1, "io.open()")]
    assert _offenders_in("builtins.open(p)") == [(1, "builtins.open()")]
    # encoding= present -- passes.
    assert _offenders_in("Path(tmp).open('w', encoding='utf-8')") == []
    assert _offenders_in("PurePath(tmp).open('w', encoding='utf-8')") == []
    assert _offenders_in("io.open(p, encoding='utf-8')") == []
    assert _offenders_in("builtins.open(p, encoding='utf-8')") == []
    # encoding=None is the platform default -- still flagged.
    assert _offenders_in("Path(tmp).open('w', encoding=None)") == [
        (1, "Path(...).open()")
    ]
    assert _offenders_in("io.open(p, encoding=None)") == [(1, "io.open()")]
    # Binary mode -- out of scope, not an offender.
    assert _offenders_in("Path(tmp).open('rb')") == []
    assert _offenders_in("PurePath(tmp).open('rb')") == []
    assert _offenders_in("io.open(p, 'rb')") == []
    assert _offenders_in("builtins.open(p, 'rb')") == []
    # Module-qualified constructor -- NOT flagged (receiver.func is
    # ast.Attribute, not ast.Name, so it falls outside the allow-list).
    assert _offenders_in("pathlib.Path(tmp).open('w')") == []
    # Ambiguous dotted .open() on other receivers -- NOT flagged (issue scope).
    assert _offenders_in("zipfile.ZipFile(z).open(name)") == []
    assert _offenders_in("Image.open(f)") == []
    assert _offenders_in("webbrowser.open(url)") == []
    assert _offenders_in("p.open('w')") == []


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


def test_pep695_file_is_parsed_and_scanned(tmp_path):
    """A file using PEP 695 type-alias syntax (Python 3.12+) with a bare open()
    must be parsed and caught, not silently skipped. This proves the CI
    interpreter can handle 3.12 syntax -- a 3.11 ast.parse would raise
    SyntaxError and the file would land in the unparseable list instead."""
    fixture = tmp_path / "pep695_example.py"
    fixture.write_text(
        "type Vector[T] = list[T]\n"
        "\n"
        "def load(p):\n"
        "    return open(p).read()\n",
        encoding="utf-8",
    )
    offenders, unparseable = _scan_tree(tmp_path)
    assert not unparseable, f"PEP 695 file was not parsed: {unparseable}"
    assert len(offenders) == 1
    assert "open()" in offenders[0]
