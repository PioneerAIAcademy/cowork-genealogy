"""A function annotated `-> X` must actually return something.

Written after an edit turned `return grade(...)` into `out = grade(...)` and the
follow-up meant to add `return out` never landed, leaving `_run_judge` with
**zero return statements**. Every real judge call would have returned `None` and
crashed on `judge_output.dimensions`, outside the `except JudgeError` handler —
so a whole paid suite would have aborted rather than degrading.

**The full suite passed.** Two things hide this class of defect here, and both
are permanent: every orchestrator test monkeypatches `_run_judge`, so no unit
test ever calls the real one; and ruff is pinned to `select = ["F821"]`, which
excludes the rule that would flag it. Nothing in the repo could catch it, and
the first symptom would have been a suite dying mid-run.

This is that check: static, fixture-free, and it runs in milliseconds.

Scope is deliberately narrow — a non-`None` return annotation is the author
stating the function produces a value, so falling off the end is a defect rather
than a style choice. Generators, abstract stubs, `-> None` and the
never-returning annotations (`-> NoReturn` / `-> Never`) are all exempt.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[2]
MODULE_DIRS = [
    HARNESS / "harness",
    HARNESS / "scripts",
    HARNESS / "e2e",
    # `validators/` is harness production code, not tests. A validator helper
    # that falls off the end raises inside validator_runner._run_module's broad
    # `except Exception`, which records passed=False against the SKILL — so the
    # defect reads as a skill regression on a paid run.
    HARNESS / "validators",
]


def _python_files() -> list[Path]:
    out: list[Path] = []
    for d in MODULE_DIRS:
        assert d.is_dir(), f"{d} is missing — MODULE_DIRS is stale and the scan is silently smaller"
        out.extend(sorted(p for p in d.rglob("*.py") if "__pycache__" not in p.parts))
    # `eval/harness/` itself, non-recursively: run_tests.py, skill_gate.py and
    # skill_latency_report.py are production modules full of value-returning
    # functions, and scanning only the subdirectories leaves all three out —
    # while run_tests.py is where this class of defect does the most damage.
    out.extend(sorted(p for p in HARNESS.glob("*.py") if "__pycache__" not in p.parts))
    return out


_NEVER_RETURNS = frozenset({"NoReturn", "Never"})


def _returns_a_value(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    """True if any `return <expr>` or `yield` belongs to THIS function.

    Walks into nested statements but not into nested function or class bodies —
    a `return` inside an inner helper says nothing about the outer function.
    """
    stack: list[ast.AST] = list(ast.iter_child_nodes(fn))
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue  # a different scope
        if isinstance(node, ast.Return) and node.value is not None:
            return True
        if isinstance(node, (ast.Yield, ast.YieldFrom)):
            return True  # a generator's annotation describes what it yields
        stack.extend(ast.iter_child_nodes(node))
    return False


def _annotates_a_value(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    ann = fn.returns
    if ann is None:
        return False
    if isinstance(ann, ast.Constant) and ann.value is None:  # -> None
        return False
    # `-> NoReturn` / `-> Never` promise the opposite: the function always
    # raises. `_is_stub` only exempts a body that is ENTIRELY raise/pass/...,
    # so one statement before the raise would otherwise be flagged.
    if isinstance(ann, ast.Name) and ann.id in _NEVER_RETURNS:
        return False
    if isinstance(ann, ast.Attribute) and ann.attr in _NEVER_RETURNS:
        return False
    return True


def _is_stub(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    """A body of only a docstring and/or `...` / `pass` / `raise` — a protocol
    stub or an abstract method, which is not expected to return."""
    body = [
        n for n in fn.body
        if not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
                and isinstance(n.value.value, str))
    ]
    if not body:
        return True
    return all(
        isinstance(n, ast.Pass)
        or (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and n.value.value is Ellipsis)
        or isinstance(n, ast.Raise)
        for n in body
    )


def test_every_value_returning_function_returns_a_value():
    offenders: list[str] = []
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not _annotates_a_value(node) or _is_stub(node):
                continue
            if not _returns_a_value(node):
                offenders.append(
                    f"{path.relative_to(HARNESS)}:{node.lineno} {node.name}"
                )
    assert not offenders, (
        "function(s) annotated to return a value never return one:\n  "
        + "\n  ".join(offenders)
    )


def test_the_check_actually_scans_something():
    """A scan that silently matches nothing passes vacuously. Assert a floor,
    never an exact count — the module set grows."""
    n = 0
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        n += sum(
            1 for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and _annotates_a_value(node)
            and not _is_stub(node)
        )
    assert n > 50, f"only {n} value-returning functions found — check the paths"


def test_it_scans_the_harness_root_not_only_subdirectories():
    """`run_tests.py` and its siblings sit directly in `eval/harness/`, and a
    dirs-only scan silently skips them — the check would look like coverage
    while missing the largest module in the tree."""
    scanned = {p.name for p in _python_files()}
    assert "run_tests.py" in scanned


@pytest.mark.parametrize(
    "src, expected",
    [
        ("def f() -> int:\n    x = 1\n", False),          # the real defect
        ("def f() -> int:\n    return 1\n", True),
        ("def f() -> int:\n    if x:\n        return 1\n", True),
        ("def f():\n    x = 1\n", False),
        ("def f() -> int:\n    def g():\n        return 2\n    x = 1\n", False),
    ],
)
def test_detector_semantics(src, expected):
    """Pins the walker itself, including the nested-scope case: a `return` in an
    inner helper must not satisfy the outer function."""
    fn = ast.parse(src).body[0]
    assert _returns_a_value(fn) is expected


@pytest.mark.parametrize(
    "src, expected",
    [
        ("def f() -> int: ...", True),
        ("def f() -> None: ...", False),
        ("def f(): ...", False),
        ("def f() -> NoReturn: ...", False),
        ("def f() -> Never: ...", False),
        ("def f() -> typing.NoReturn: ...", False),
        ("def f() -> t.Never: ...", False),
    ],
)
def test_never_returning_annotations_are_exempt(src, expected):
    """`-> NoReturn` states the function always raises, so falling off the end
    is the contract, not a defect. Bare and dotted spellings both."""
    fn = ast.parse(src).body[0]
    assert _annotates_a_value(fn) is expected


def test_a_noreturn_helper_that_does_work_first_is_not_flagged():
    """The shape the exemption exists for: `_is_stub` only exempts a body that
    is entirely raise/pass/..., so one statement before the raise would flag."""
    fn = ast.parse(
        "def _die(msg: str) -> NoReturn:\n"
        "    print(msg)\n"
        "    raise SystemExit(1)\n"
    ).body[0]
    assert not (_annotates_a_value(fn) and not _is_stub(fn) and not _returns_a_value(fn))
