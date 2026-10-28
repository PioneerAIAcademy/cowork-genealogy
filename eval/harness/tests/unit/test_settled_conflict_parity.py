"""The two "is this conflict settled" copies must agree.

One rule, two implementations, in packages that cannot import each other:

    packages/engine/mcp-server/src/validation/validator.ts   isSettledConflict
    eval/harness/harness/skill_invocation.py                 is_settled_conflict

`resolved` and `moot` both settle a conflict. Issue #2359 was a third definition
that disagreed: `disputedSourceIds` skipped only `resolved`, so a moot conflict
still blocked a tier and a question resolve, and the refusal called it
"unresolved". The engine now routes every settled test through one helper; this
file keeps the harness's copy answering the same way.

Vector-driven, not a string diff, as in `test_awaiting_hand_offs_parity.py`: each
copy is RUN over the same conflicts and the answers compared. The TypeScript side
runs the COMPILED build, which is what ships.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from harness.skill_invocation import is_settled_conflict

_REPO = Path(__file__).resolve().parents[4]
_TS_BUILD = _REPO / "packages" / "engine" / "mcp-server" / "build" / "validation" / "validator.js"

# (label, conflict, settled?)
VECTORS: list[tuple[str, object, bool]] = [
    ("resolved", {"id": "c_001", "status": "resolved"}, True),
    ("moot", {"id": "c_001", "status": "moot"}, True),
    ("unresolved", {"id": "c_001", "status": "unresolved"}, False),
    ("status absent", {"id": "c_001"}, False),
    ("status null", {"id": "c_001", "status": None}, False),
    ("status in the wrong case", {"id": "c_001", "status": "Resolved"}, False),
    ("status not a string", {"id": "c_001", "status": ["resolved"]}, False),
    ("not an object", None, False),
]


def _typescript_answers(conflicts: list) -> list[bool]:
    script = (
        # as_uri, not as_posix: on Windows node refuses a bare `C:/...` import.
        f'import {{ isSettledConflict }} from "{_TS_BUILD.as_uri()}";\n'
        "let input = '';\n"
        "process.stdin.on('data', (d) => (input += d));\n"
        "process.stdin.on('end', () => {\n"
        "  const out = JSON.parse(input).map((c) => isSettledConflict(c));\n"
        "  process.stdout.write(JSON.stringify(out));\n"
        "});\n"
    )
    done = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        input=json.dumps(conflicts),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    assert done.returncode == 0, f"node failed: {done.stderr[:400]}"
    return json.loads(done.stdout)


@pytest.mark.parametrize("label,conflict,expected", VECTORS, ids=[v[0] for v in VECTORS])
def test_the_python_copy_answers_this_vector(label, conflict, expected):
    assert is_settled_conflict(conflict) is expected


@pytest.mark.requires_engine_build
def test_the_compiled_typescript_copy_exists():
    assert _TS_BUILD.is_file(), f"{_TS_BUILD} is missing; run make engine-build"


@pytest.mark.requires_engine_build
def test_both_copies_agree_on_every_vector():
    """The point of the file: not that each matches a table, but each other.

    One node process for every vector, so the file costs one spawn.
    """
    conflicts = [v[1] for v in VECTORS]
    python = [is_settled_conflict(c) for c in conflicts]
    typescript = _typescript_answers(conflicts)
    disagreements = [
        f"{label}: python={p} typescript={t}"
        for (label, _, _), p, t in zip(VECTORS, python, typescript)
        if p != t
    ]
    assert not disagreements, "the settled-conflict copies disagree:\n" + "\n".join(disagreements)
