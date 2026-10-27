"""The two "waiting on the researcher" copies must agree.

One rule, two implementations, in packages that cannot import each other:

    packages/engine/mcp-server/src/utils/awaiting-hand-offs.ts   the engine
    packages/engine/plugin/hooks/step_boundary.py                ships in the plugin

An external-site search is an errand: we hand out a URL, the researcher brings
back a capture. Between those the plan item is open but is NOT work the agent
can do. `project_context` reports those as `awaitingUser`; the step boundary
excludes them from `open_items` so one does not hold a turn's boundary open.
Same question, and the two must answer it identically.

**That is not hypothetical.** The write-lockdown rule has three copies for the
same reason, and a POSIX-only path split made the e2e one a silent no-op on
Windows -- the platform the genealogist team runs -- for two releases (#1228,
`test_write_lockdown_parity.py`). This file is that guard, one release earlier.

Vector-driven, not a string diff: each copy is RUN over the same log and the
answers compared, so a divergence in behaviour fails even when the two look
alike. The TypeScript side runs the COMPILED build, which is what ships.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[4]
_PY_PATH = _REPO / "packages" / "engine" / "plugin" / "hooks" / "step_boundary.py"
_TS_BUILD = _REPO / "packages" / "engine" / "mcp-server" / "build" / "utils" / "awaiting-hand-offs.js"


def _load_python():
    spec = importlib.util.spec_from_file_location("_genealogy_step_boundary_parity", _PY_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {_PY_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sb = _load_python()


def _hand_off(log_id, url, outcome, captured, item_id="pli_001", site="ancestry"):
    return {
        "id": log_id,
        "tool": "external_site",
        "outcome": outcome,
        "plan_item_id": item_id,
        "external_site": {"site": site, "url_generated": url, "capture_received": captured},
    }


URL = "https://example.test/search?q=flynn"
OTHER = "https://example.test/search?q=other"

# (label, log, the plan-item ids still waiting)
VECTORS: list[tuple[str, list, list[str]]] = [
    ("no log at all", [], []),
    (
        "an open hand-off waits",
        [_hand_off("log_001", URL, "partial", False)],
        ["pli_001"],
    ),
    (
        "a capture that came back closes it",
        [_hand_off("log_001", URL, "partial", True)],
        [],
    ),
    (
        "a later entry for the same url closes it, capture or not",
        [_hand_off("log_001", URL, "partial", False), _hand_off("log_002", URL, "error", False)],
        [],
    ),
    (
        "a later entry for a DIFFERENT url does not close it",
        [_hand_off("log_001", URL, "partial", False), _hand_off("log_002", OTHER, "positive", True, "pli_002")],
        ["pli_001"],
    ),
    (
        "a positive entry logged without a capture waits on nobody (#2864)",
        [_hand_off("log_001", URL, "positive", False)],
        [],
    ),
    (
        "an EARLIER close does not close a later hand-off at the same url",
        [_hand_off("log_001", URL, "error", False), _hand_off("log_002", URL, "partial", False)],
        ["pli_001"],
    ),
    (
        "two open hand-offs on different items",
        [
            _hand_off("log_001", URL, "partial", False, "pli_001"),
            _hand_off("log_002", OTHER, "partial", False, "pli_002"),
        ],
        ["pli_001", "pli_002"],
    ),
    (
        "a non-external_site entry is ignored",
        [{"id": "log_001", "tool": "record_search", "outcome": "partial", "plan_item_id": "pli_001"}],
        [],
    ),
    (
        "an entry with no id is ignored",
        [{k: v for k, v in _hand_off("log_001", URL, "partial", False).items() if k != "id"}],
        [],
    ),
    (
        "an entry with no url is ignored",
        [{"id": "log_001", "tool": "external_site", "outcome": "partial",
          "plan_item_id": "pli_001", "external_site": {"site": "ancestry", "capture_received": False}}],
        [],
    ),
    (
        "a hand-off with no plan item waits, but holds no item open",
        [_hand_off("log_001", URL, "partial", False, item_id=None)],
        [],
    ),
]


def _python_answer(log: list) -> list[str]:
    return sorted(sb.awaiting_upload_item_ids({"log": log}))


def _typescript_answer(log: list) -> list[str]:
    script = (
        f'import {{ awaitingUploadItemIds }} from "{_TS_BUILD.as_uri()}";\n'
        "let input = '';\n"
        "process.stdin.on('data', (d) => (input += d));\n"
        "process.stdin.on('end', () => {\n"
        "  const ids = [...awaitingUploadItemIds(JSON.parse(input))].sort();\n"
        "  process.stdout.write(JSON.stringify(ids));\n"
        "});\n"
    )
    done = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        input=json.dumps(log),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    assert done.returncode == 0, f"node failed: {done.stderr[:400]}"
    return json.loads(done.stdout)


@pytest.mark.parametrize("label,log,expected", VECTORS, ids=[v[0] for v in VECTORS])
def test_the_python_copy_answers_this_vector(label, log, expected):
    assert _python_answer(log) == sorted(expected)


@pytest.mark.requires_engine_build
@pytest.mark.parametrize("label,log,expected", VECTORS, ids=[v[0] for v in VECTORS])
def test_the_typescript_copy_answers_this_vector(label, log, expected):
    assert _typescript_answer(log) == sorted(expected)


@pytest.mark.requires_engine_build
@pytest.mark.parametrize("label,log,expected", VECTORS, ids=[v[0] for v in VECTORS])
def test_both_copies_agree_on_this_vector(label, log, expected):
    """The point of the file: not that each matches a table, but each other."""
    assert _python_answer(log) == _typescript_answer(log)


def test_the_python_copy_was_actually_loaded():
    """A parity test over an unloaded copy passes vacuously."""
    assert callable(getattr(sb, "awaiting_upload_item_ids", None))


@pytest.mark.requires_engine_build
def test_the_compiled_typescript_copy_exists():
    assert _TS_BUILD.is_file(), f"{_TS_BUILD} is missing; run make engine-build"


def test_no_unregistered_copy_of_the_hand_off_rule_exists():
    """A third copy would drift unguarded, which is how #1228 happened.

    Greps the CODE (.ts/.py) for the `capture_received` test outside the two
    registered copies and the places that legitimately WRITE or assert on the
    field. Agent and skill prose describes the field in English and is not a
    copy of the rule, so `.md` is out of scope.

    `--untracked` is load-bearing: without it a brand-new file -- exactly the
    shape a third copy arrives in -- is invisible and this passes vacuously.
    """
    found = subprocess.run(
        ["git", "grep", "-l", "--untracked", "capture_received", "--",
         "packages/engine/mcp-server/src/**/*.ts", "packages/engine/plugin/**/*.py"],
        cwd=_REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    assert found.returncode in (0, 1), found.stderr[:300]
    hits = {line.strip() for line in found.stdout.splitlines() if line.strip()}
    allowed = {
        # The two registered copies.
        "packages/engine/mcp-server/src/utils/awaiting-hand-offs.ts",
        "packages/engine/plugin/hooks/step_boundary.py",
        # Writers and validators of the field, not readers of this rule.
        "packages/engine/mcp-server/src/tools/research-log-append.ts",
        "packages/engine/mcp-server/src/tools/build-external-search-url.ts",
        "packages/engine/mcp-server/src/tools/research-append.ts",
        "packages/engine/mcp-server/src/validation/validator.ts",
        "packages/engine/mcp-server/src/utils/question-state.ts",
    }
    unregistered = sorted(hits - allowed)
    assert not unregistered, (
        f"these read `capture_received` and are in neither registered copy: {unregistered}. "
        "Import `awaitingUserHandOffs` from `src/utils/awaiting-hand-offs.ts` (or the Python "
        "mirror in `step_boundary.py`) rather than re-deriving the rule -- an unguarded third "
        "copy is how the write-lockdown drifted (#1228)."
    )
