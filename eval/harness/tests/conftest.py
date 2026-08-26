"""Session hooks for the harness suite, incl. the ``requires_engine_build`` marker.

This conftest lives at ``tests/`` (not ``tests/unit/``) so the marker and its hooks
cover every test under ``testpaths = ["tests"]``, and to stay clear of
``tests/unit/conftest.py`` -- which already exists (the autouse auth stub, #1240). The
``pytest_terminal_summary`` hook below writes its own line regardless of verbosity, so
it shows even under ``-q``.

The ``requires_engine_build`` marker
------------------------------------
Six tests need the compiled ``packages/engine/mcp-server/build/`` (mock_mcp's tool
catalog and the compiled TS validator). That build is a Makefile prerequisite of
every ``make`` target and is built in CI, but a bare ``uv run pytest`` in a fresh
worktree has none: the post-checkout hook links node_modules and the ``.env`` files,
not ``build/``. Before this marker each test re-probed the dependency by hand; one
site was forgotten for months (a red that was not a regression, #1265), and the fix
for that made the skips *dark* -- ``pytest -q`` printed ``N skipped`` and moved on. A
test that does not run protects nothing, so the drop is stated at session end.

The probe is *behavioral*, not "does ``build/index.js`` exist". Both artifacts return
their unavailable sentinel (``{}`` / ``None``) whenever the build is absent, ``node``
is missing, or the engine's node_modules cannot be resolved. A path-existence probe
would call a no-``node`` machine "build present" and turn three of these skips into
hard crashes.

Checking the *whole catalog is empty* (not one named tool) is deliberate: a build that
exists but has lost a tool must FAIL loudly, the same way
``run_tests._check_mcp_build_fresh`` treats a stale build. Only a wholly absent build
is a skip; a missing tool is a regression.
"""

from __future__ import annotations

import pytest

_ENGINE_BUILD_SKIP_REASON = "engine build absent; run make engine-build"

# Nodeids skipped by the requires_engine_build marker this session, so the terminal
# summary reports marker-driven skips only -- never terminalreporter.stats["skipped"],
# which would fold in the suite's unrelated skips. Process-local: the suite runs
# single-process (no pytest-xdist), so the controller sees every skip; under `-n` the
# count would need a worker-to-controller channel.
_engine_build_skips: list[str] = []

_engine_build_available_cache: bool | None = None


def _engine_build_available() -> bool:
    """True iff the compiled engine build is usable this session.

    Cached like ``mock_mcp._load_build_tool_catalog`` -- only a successful
    (``True``) result is remembered, so ``node`` is spawned at most twice past
    the first success. An unconditional ``lru_cache`` here would re-introduce
    the exact split-brain that loader's own truthy-only cache exists to avoid:
    a transient failure on the first call (e.g. the load timing out) would get
    locked in here as a permanent ``False`` for the rest of the session --
    skipping all six ``requires_engine_build`` tests -- even though the
    loader's own cache would have recovered on the very next call. Short-
    circuits: an empty catalog means the build is gone, so the validator is
    not probed in that case.
    """
    global _engine_build_available_cache
    if _engine_build_available_cache:
        return True
    from harness.mock_mcp import _load_build_tool_catalog
    from harness.ts_validator import validate_parsed

    if not _load_build_tool_catalog():
        return False
    available = validate_parsed({}, {}) is not None
    if available:
        _engine_build_available_cache = True
    return available


def pytest_runtest_setup(item: pytest.Item) -> None:
    if item.get_closest_marker("requires_engine_build") is None:
        return
    if _engine_build_available():
        return
    _engine_build_skips.append(item.nodeid)
    pytest.skip(_ENGINE_BUILD_SKIP_REASON)


def pytest_terminal_summary(terminalreporter) -> None:
    count = len(_engine_build_skips)
    if count:
        terminalreporter.write_line(
            f"{count} test{'' if count == 1 else 's'} skipped: {_ENGINE_BUILD_SKIP_REASON}"
        )
