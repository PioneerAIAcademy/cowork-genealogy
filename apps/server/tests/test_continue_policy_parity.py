"""The continue-policy copies must agree (research-as-a-job 1b/1c/1d).

"Whether to veto the model's voluntary stop" exists in **two** implementations, in two
packages that cannot import each other:

    apps/server/app/agent/continue_policy.py      hosted alpha AND the prototype worker
    eval/harness/e2e/stop_checker.py              the e2e harness

Two, not three, and that is the point of 1d. The worker already imports from
``apps/server/app`` -- ``options.py`` takes ``direct_project_file_write`` and ``worker.py``
takes ``map_message`` -- so the alpha and the prototype SHARE one copy rather than each
carrying its own. What stays genuinely separate is ``eval/harness``: the worker image does
not copy ``eval/``, and a test asserts those two trees never import each other.

So this file pins the one remaining seam. The harness's version is the original; the
shared copy is a port that has since grown three clauses (``stopped``,
``pending_user_message``, ``pending_decision``) the harness does not have. Those default
False, which is exactly what makes the comparison meaningful: **with the new flags off,
the two must be the same function**, case for case. A change to the harness's rule that
does not land here -- or the reverse -- is the drift this catches.

**Extracted with `ast`, not imported**, the pattern
``eval/harness/tests/unit/test_write_lockdown_parity.py`` already uses: the two live in
packages with separate virtualenvs, and importing either pulls in dependencies the other
does not have. Both predicates are pure stdlib, so lifting the functions they need into a
clean namespace exercises the real code with none of that. Extraction failing is a hard
error, never a skip -- a renamed predicate must break this test, not silently empty it.
"""

from __future__ import annotations

import ast
import itertools
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]

SHARED = REPO / "apps/server/app/agent/continue_policy.py"
HARNESS = REPO / "eval/harness/e2e/stop_checker.py"

# The names each copy must expose. `terminal_reason` is in both: the harness wrote it
# first, and 1c ported it so `turns.outcome` can say WHY a run ended.
LIFTED = ("project_completed", "should_continue_run", "terminal_reason")


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
        if isinstance(node, ast.Assign) and isinstance(node.value, (ast.Constant, ast.Tuple,
                                                                    ast.List, ast.Set, ast.Dict))
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


# The harness's five-parameter signature -- the shared copy's extra flags default False,
# so this is the surface on which the two must be identical.
_RESEARCH = (None, {}, {"project": {}}, {"project": {"status": "active"}},
             {"project": {"status": "completed"}})
_NUDGES = ((0, 0), (0, 5), (1, 5), (5, 5), (6, 5))
_TOOLS = ((0, -1), (12, 8), (15, 15), (3, 3))
_MCP = (False, True)


def _cases():
    for research, (used, cap), (count, at_last), mcp in itertools.product(
        _RESEARCH, _NUDGES, _TOOLS, _MCP
    ):
        yield dict(research=research, nudges_used=used, max_nudges=cap,
                   tool_count=count, tool_count_at_last_nudge=at_last, mcp_unavailable=mcp)


def test_should_continue_run_agrees_case_for_case(copies):
    shared, harness = copies
    cases = list(_cases())
    assert len(cases) >= 100, "the sweep collapsed; it is meant to cover the whole table"
    for kw in cases:
        assert shared["should_continue_run"](**kw) is harness["should_continue_run"](**kw), kw


def test_project_completed_agrees_including_the_shapes_that_are_not_dicts(copies):
    shared, harness = copies
    for research in (*_RESEARCH, {"project": None}, {"project": {"status": "COMPLETED"}},
                     {"project": {"status": ""}}, {"status": "completed"}):
        assert shared["project_completed"](research) is harness["project_completed"](research), research


def test_terminal_reason_agrees_wherever_the_harness_has_an_opinion(copies):
    """The harness's four reasons must still come out of the shared copy unchanged. The
    shared one has three MORE -- stopped, queued, decision -- which it can only reach
    through flags the harness has no parameter for, so they cannot collide."""
    shared, harness = copies
    for kw in _cases():
        call = {k: kw[k] for k in ("research", "nudges_used", "max_nudges", "mcp_unavailable")}
        assert shared["terminal_reason"](**call) == harness["terminal_reason"](**call), call


def test_the_shared_copy_is_the_one_with_the_new_clauses(copies):
    """Directional, so a lazy "fix" that deletes the new clauses to make the sweep pass
    reds instead. The three flags are 1b's and 1c's whole mechanism."""
    shared, _ = copies
    base = dict(research=None, nudges_used=0, max_nudges=5, tool_count=0,
                tool_count_at_last_nudge=-1)
    for flag, reason in (("stopped", "stopped"), ("pending_user_message", "queued"),
                         ("pending_decision", "decision")):
        assert shared["should_continue_run"](**{**base, flag: True}) is False, flag
        assert shared["terminal_reason"](
            research=None, nudges_used=0, max_nudges=5, **{flag: True}) == reason


def test_there_is_no_third_copy(tmp_path):
    """1d says two copies, not three. A new one is only findable by looking."""
    import subprocess

    # Two ways this check can cover nothing, both of which it hit while being written:
    # without --untracked a copy added in THIS branch is invisible, and without the `^`
    # anchor the pattern matches its own quoted self in this file -- so the check reported
    # a third copy that was only ever the grep string. The anchor is also the more precise
    # question: both real copies are module-level definitions.
    out = subprocess.run(
        ["git", "grep", "--untracked", "-l", "-e", "^def should_continue_run"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8",
    )
    assert out.returncode in (0, 1), out.stderr
    found = {line.strip() for line in out.stdout.splitlines() if line.strip()}
    expected = {"apps/server/app/agent/continue_policy.py", "eval/harness/e2e/stop_checker.py"}
    assert found == expected, (
        f"should_continue_run is defined in {sorted(found)}; 1d allows exactly {sorted(expected)}. "
        "A third copy means the alpha and the prototype have stopped sharing one."
    )


def test_the_worker_imports_the_shared_copy_rather_than_redefining_it():
    options = (REPO / "apps/server/proto/worker/options.py").read_text(encoding="utf-8")
    assert "from app.agent.continue_policy import" in options
    assert "def should_continue_run(" not in options, "the worker must import, not redefine"
    real_agent = (REPO / "apps/server/app/agent/real_agent.py").read_text(encoding="utf-8")
    assert "from .continue_policy import" in real_agent, "and so must the alpha"


def test_the_veto_text_has_exactly_one_definition():
    """The whole point of CONTINUE_REASON is that every plane sends the SAME words. It
    shipped as two hand-kept copies -- one in `proto/worker/options.py`, one in
    `real_agent.py` -- each carrying a comment saying it was copied from the other, which
    is the one arrangement that cannot guarantee it. `--untracked` because git grep skips
    files a branch has not added yet, and `^CONTINUE_REASON` so this test's own quoted
    mention of the name does not match itself."""
    out = subprocess.run(
        ["git", "grep", "--untracked", "-l", "-e", "^CONTINUE_REASON = "],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8",
    )
    assert out.returncode in (0, 1), out.stderr
    found = {line.strip() for line in out.stdout.splitlines() if line.strip()}
    assert found == {"apps/server/app/agent/continue_policy.py"}, (
        f"CONTINUE_REASON is defined in {sorted(found)}; there must be exactly one. "
        "Both Stop hooks import it, and two copies drift silently."
    )
    for rel in ("apps/server/proto/worker/options.py", "apps/server/app/agent/real_agent.py"):
        body = (REPO / rel).read_text(encoding="utf-8")
        assert "CONTINUE_REASON" in body, f"{rel} still sends the veto"
        assert "CONTINUE_REASON = (" not in body, f"{rel} must import it, not redefine it"


def test_the_env_guard_is_shared_where_it_can_be_and_only_where_it_can_be():
    """A bare `int()`/`float()` on a typo'd environment variable raises at module scope,
    before anything binds, and the orchestrator restarts the container forever. That
    shipped three times as three separate hand-written guards, which is what says it
    belongs in one place -- and it bit once already (#F, the unguarded `int()`).

    The web tier is the exception and it is a REAL one, not laziness: `proto/web/Dockerfile`
    copies only `enqueue.py`, `sql/` and `web/`, so `app` is not importable there. An
    import would pass every test -- the suite runs from the repo root, where the whole
    tree is on the path -- and fail only in the deployed container. So it keeps its own
    copy, and this test pins the reason by reading the Dockerfile."""
    dockerfile = (REPO / "apps/server/proto/web/Dockerfile").read_text(encoding="utf-8")
    copied = [ln.split()[1] for ln in dockerfile.splitlines() if ln.startswith("COPY ")]
    assert not any(c.startswith("app") or "/app" in c for c in copied), (
        f"the web image now copies {copied}; if `app` is in it, proto/web/app.py should "
        f"import the shared env guard instead of keeping its own copy"
    )

    # Everything that CAN share, does.
    for rel in ("apps/server/app/agent/real_agent.py", "apps/server/proto/worker/worker.py"):
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
