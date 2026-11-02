"""What the hosted planes still share with the e2e harness (PR #2870 items 1b/1c/1d).

The Stop veto was deleted from the hosted planes in step mode's phase 2, so
``should_continue_run``, ``terminal_reason`` and ``CONTINUE_REASON`` now live only in
``eval/harness/e2e/stop_checker.py``, which the e2e half of phase 2 retires. What the two
packages still share is ``project_completed``:

    apps/server/app/agent/continue_policy.py      hosted alpha AND the prototype worker
    eval/harness/e2e/stop_checker.py              the e2e harness

**Extracted with `ast`, not imported**, the pattern
``eval/harness/tests/unit/test_write_lockdown_parity.py`` already uses: the two live in
packages with separate virtualenvs, and importing either pulls in dependencies the other
does not have. Extraction failing is a hard error, never a skip -- a renamed predicate must
break this test, not silently empty it.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]

SHARED = REPO / "apps/server/app/agent/continue_policy.py"
HARNESS = REPO / "eval/harness/e2e/stop_checker.py"

# The names each copy must expose.
LIFTED = ("project_completed",)


def _is_literal(value: ast.expr) -> bool:
    """A value `ast.literal_eval` accepts. The shape test it replaces took any tuple, so a
    tuple of `re.compile(...)` calls was lifted and raised NameError on its own import."""
    try:
        ast.literal_eval(value)
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        return False
    return True


def _lift(path: Path) -> dict:
    """The named functions, plus the literal constants they close over, lifted out of
    `path` into a clean namespace.

    Only function definitions and module-level assignments of LITERALS are taken, so
    neither module's imports can drag anything in -- an assignment whose value is a call
    or an attribute lookup is left behind, and the function that needed it then raises
    here rather than passing. That is the failure mode this wants: the shared copy's
    `terminal_reason` returns TERMINAL_* constants, and lifting the functions alone made
    it raise NameError on the first call, which is a true report that the seam is wider
    than the functions.
    """
    assert path.is_file(), f"{path} is gone: the parity seam moved and this test must move with it"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    consts = [
        node for node in tree.body
        if isinstance(node, ast.Assign) and _is_literal(node.value)
    ]
    wanted = {
        node.name: node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in LIFTED
    }
    missing = [n for n in LIFTED if n not in wanted]
    assert not missing, f"{path.name} no longer defines {missing} -- renamed, or moved out"
    body = consts + [wanted[n] for n in LIFTED]
    ns: dict = {}
    exec(compile(ast.Module(body=body, type_ignores=[]), str(path), "exec"), ns)
    return ns


@pytest.fixture(scope="module")
def copies() -> tuple[dict, dict]:
    return _lift(SHARED), _lift(HARNESS)


_RESEARCH = (None, {}, {"project": {}}, {"project": {"status": "active"}},
             {"project": {"status": "completed"}})






def test_project_completed_agrees_including_the_shapes_that_are_not_dicts(copies):
    shared, harness = copies
    for research in (*_RESEARCH, {"project": None}, {"project": {"status": "COMPLETED"}},
                     {"project": {"status": ""}}, {"status": "completed"}):
        assert shared["project_completed"](research) is harness["project_completed"](research), research










def test_the_worker_imports_the_shared_copy_rather_than_redefining_it():
    options = (REPO / "apps/server/proto/worker/options.py").read_text(encoding="utf-8")
    assert "from app.agent.continue_policy import" in options
    real_agent = (REPO / "apps/server/app/agent/real_agent.py").read_text(encoding="utf-8")
    assert "from .continue_policy import" in real_agent, "and so must the alpha"




def test_the_env_guard_is_shared_where_it_can_be_and_only_where_it_can_be():
    """A bare `int()`/`float()` on a typo'd environment variable raises at module scope,
    before anything binds, and the orchestrator restarts the container forever. That
    shipped three times as three separate hand-written guards, which is what says it
    belongs in one place -- and it bit once already (#F, the unguarded `int()`).

    The web tier is the exception and it is a REAL one, not laziness: `proto/web/Dockerfile`
    copies only `enqueue.py`, `sql/`, `web/` and the engine's client config, so `app` is not
    importable there. An import would pass every test -- the suite runs from the repo root,
    where the whole tree is on the path -- and fail only in the deployed container. So it
    keeps its own copy, and this test pins the reason by reading the Dockerfile.

    The build context is the repo root (U2), so every COPY source starts with `apps/`; the
    question is whether one of them is the `apps/server/app` package or inside it."""
    dockerfile = (REPO / "apps/server/proto/web/Dockerfile").read_text(encoding="utf-8")
    copied = [ln.split()[1].rstrip("/") for ln in dockerfile.splitlines() if ln.startswith("COPY ")]
    assert copied, "the web Dockerfile copies nothing; this check would pass vacuously"
    assert not any(c in ("apps/server/app", "apps/server") or c.startswith("apps/server/app/")
                   for c in copied), (
        f"the web image now copies {copied}; if `app` is in it, proto/web/app.py should "
        f"import the shared env guard instead of keeping its own copy"
    )

    # Everything that CAN share, does.
    for rel in ("apps/server/proto/worker/worker.py",):
        body = (REPO / rel).read_text(encoding="utf-8")
        assert "env_int(" in body or "env_float(" in body, f"{rel} must use the shared guard"

    # The precise rule, and the only one worth asserting: an environment value may not be
    # converted without a guard. Deliberately NOT "no bare int(raw) anywhere" -- an
    # earlier draft of this test said that and flagged `parse_max_nudges`, which is
    # correctly guarded by its caller and reads the QUEUE BODY rather than the
    # environment. A check that fails legitimate code gets skipped within a month.
    out = subprocess.run(
        ["git", "grep", "--untracked", "-n", "-E",
         r"(int|float)\(os\.environ(\.get)?"],
        cwd=REPO / "apps/server", capture_output=True, text=True, encoding="utf-8",
    )
    assert out.returncode in (0, 1), out.stderr
    offenders = [ln for ln in out.stdout.splitlines() if "tests/" not in ln.split(":")[0]]
    assert not offenders, (
        "an environment variable is parsed without a guard, so a typo crash-loops the "
        "process that reads it:\n  " + "\n  ".join(offenders)
    )
