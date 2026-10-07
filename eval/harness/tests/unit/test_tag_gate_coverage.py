"""Lint: every tag a validator gates on is carried by a test, or declared dormant.

A validator gated on a test tag (``harness.runnability.tag_gated_validator_tags``)
stops running once no test carries the tag -- after a rename, a typo, or the
last tagged test being deleted -- and nothing fails. This lint closes that hole.

For every ``eval/harness/validators/test_*.py``, each gate tag must be carried in
``test.tags`` by a unit test whose ``test.skill`` selects that file, or be listed in
``DORMANT`` with a reason. ``test_universal.py`` runs for every suite, so its tags
are claimed by a test in any suite. A tag carried only in another suite does not
count: a rename that lands on a tag used elsewhere is exactly the hole.

Gate tags come from ``tag_gated_validator_tags`` itself, so this lint and the
runnability gate cannot disagree about what a gate is. Suites are matched the way
the harness picks a validator file: ``test.skill`` with ``-`` replaced by ``_``.
"""

from __future__ import annotations

import json
from pathlib import Path

from harness.runnability import DEFAULT_VALIDATORS_DIR, tag_gated_validator_tags

UNIT_TESTS_DIR = Path(__file__).resolve().parents[3] / "tests" / "unit"

UNIVERSAL = "universal"

# Gate tags no test carries, each with the reason. An entry fails the lint once a
# test in its suite carries the tag, or once no validator gates on it.
DORMANT: dict[str, str] = {
    "hypothesis-open-blocks-tier": (
        "its only test, ut_proof_conclusion_021, was a routing negative; b68d2e9ec "
        "retired that whole category on purpose when /research moved to calling "
        "agents directly, so no scenario exercises it"
    ),
    "no-shortcut": "claimed by PR #3165 (ut_research_015); delete this entry when it lands",
}


def _suite_key(skill: str) -> str:
    return skill.replace("-", "_")


def gate_tags(validators_dir: Path) -> dict[str, set[str]]:
    """Suite key -> gate tags, for every validator file that has any."""
    gates: dict[str, set[str]] = {}
    for path in sorted(Path(validators_dir).glob("test_*.py")):
        key = path.stem[len("test_") :]
        tags = tag_gated_validator_tags(validators_dir, key)
        if tags:
            gates[key] = tags
    return gates


def carried_tags(tests_dir: Path) -> dict[str, set[str]]:
    """Suite key -> union of ``test.tags`` across the unit tests of that skill."""
    carried: dict[str, set[str]] = {}
    for path in sorted(Path(tests_dir).glob("*/*.json")):
        test = json.loads(path.read_text(encoding="utf-8"))["test"]
        carried.setdefault(_suite_key(test["skill"]), set()).update(
            test.get("tags") or []
        )
    return carried


def problems(
    gates: dict[str, set[str]],
    carried: dict[str, set[str]],
    dormant: dict[str, str],
) -> list[str]:
    found: list[str] = []
    every_suite = set().union(*carried.values()) if carried else set()

    def claimed(key: str) -> set[str]:
        return every_suite if key == UNIVERSAL else carried.get(key, set())

    for key, tags in sorted(gates.items()):
        if key != UNIVERSAL and key not in carried:
            found.append(
                f"test_{key}.py gates on {sorted(tags)} but no unit test has "
                f"test.skill selecting it, so those gates can never run"
            )
            continue
        where = "any suite" if key == UNIVERSAL else "its suite"
        for tag in sorted(tags - claimed(key)):
            if tag not in dormant:
                found.append(
                    f"test_{key}.py gates on '{tag}' but no test in {where} carries "
                    f"it; tag a test, or add it to DORMANT with a reason"
                )

    for tag, reason in sorted(dormant.items()):
        if not reason.strip():
            found.append(f"DORMANT['{tag}'] has no reason")
        gated_in = [key for key, tags in gates.items() if tag in tags]
        if not gated_in:
            found.append(
                f"DORMANT['{tag}'] is no longer a gate tag anywhere: remove it"
            )
        elif all(tag in claimed(key) for key in gated_in):
            found.append(
                f"DORMANT['{tag}'] is a stale exemption, a test carries it: remove it"
            )
    return found


def test_every_gate_tag_is_carried_or_dormant():
    gates = gate_tags(DEFAULT_VALIDATORS_DIR)
    carried = carried_tags(UNIT_TESTS_DIR)
    assert len(gates) >= 20, f"found only {len(gates)} gated validator files"
    assert len(carried) >= 20, f"found only {len(carried)} unit-test suites"
    assert problems(gates, carried, DORMANT) == []


# --- The lint against synthetic corpora, through the real readers ---------------


def _validator(vdir: Path, key: str, *tags: str) -> None:
    body = "import pytest\n\n"
    for i, tag in enumerate(tags):
        body += (
            f"def test_v{i}(test):\n"
            f"    if {tag!r} not in test.get('tags', []):\n"
            f"        pytest.skip('x')\n\n"
        )
    (vdir / f"test_{key}.py").write_text(body, encoding="utf-8")


def _unit_test(tdir: Path, skill: str, name: str, *tags: str) -> None:
    suite = tdir / skill
    suite.mkdir(parents=True, exist_ok=True)
    doc = {"test": {"skill": skill, "tags": list(tags)}}
    (suite / f"{name}.json").write_text(json.dumps(doc), encoding="utf-8")


def _run(tmp_path: Path, dormant: dict[str, str]) -> list[str]:
    return problems(
        gate_tags(tmp_path / "validators"), carried_tags(tmp_path / "tests"), dormant
    )


def _dirs(tmp_path: Path) -> tuple[Path, Path]:
    vdir, tdir = tmp_path / "validators", tmp_path / "tests"
    vdir.mkdir()
    tdir.mkdir()
    return vdir, tdir


def test_tag_carried_in_its_own_suite_passes(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "proof_conclusion", "open-blocks")
    _unit_test(tdir, "proof-conclusion", "t1", "open-blocks")
    assert _run(tmp_path, {}) == []


def test_tag_carried_by_no_test_fails(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "proof_conclusion", "open-blocks")
    _unit_test(tdir, "proof-conclusion", "t1")
    [msg] = _run(tmp_path, {})
    assert "'open-blocks'" in msg and "test_proof_conclusion.py" in msg


def test_tag_carried_only_in_another_suite_fails(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "proof_conclusion", "open-blocks")
    _unit_test(tdir, "proof-conclusion", "t1")
    _unit_test(tdir, "research", "t2", "open-blocks")
    [msg] = _run(tmp_path, {})
    assert "'open-blocks'" in msg


def test_universal_tag_is_claimed_by_any_suite(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "universal", "hand-back")
    _unit_test(tdir, "research", "t1", "hand-back")
    assert _run(tmp_path, {}) == []


def test_universal_tag_carried_nowhere_fails(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "universal", "hand-back")
    _unit_test(tdir, "research", "t1")
    [msg] = _run(tmp_path, {})
    assert "test_universal.py" in msg and "'hand-back'" in msg


def test_gated_validator_with_no_suite_fails(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "source_evaluation", "x")
    _unit_test(tdir, "research", "t1", "x")
    [msg] = _run(tmp_path, {})
    assert "test_source_evaluation.py" in msg and "can never run" in msg


def test_dormant_tag_with_reason_passes(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "research", "no-shortcut")
    _unit_test(tdir, "research", "t1")
    assert _run(tmp_path, {"no-shortcut": "claimed by PR #1"}) == []


def test_dormant_tag_with_blank_reason_fails(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "research", "no-shortcut")
    _unit_test(tdir, "research", "t1")
    [msg] = _run(tmp_path, {"no-shortcut": "  "})
    assert "no reason" in msg


def test_dormant_tag_now_carried_is_stale(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "research", "no-shortcut")
    _unit_test(tdir, "research", "t1", "no-shortcut")
    [msg] = _run(tmp_path, {"no-shortcut": "claimed by PR #1"})
    assert "stale" in msg


def test_dormant_tag_still_missing_in_one_of_two_suites_is_not_stale(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "research", "no-results")
    _validator(vdir, "search_records", "no-results")
    _unit_test(tdir, "research", "t1", "no-results")
    _unit_test(tdir, "search-records", "t2")
    assert _run(tmp_path, {"no-results": "pending"}) == []


def test_dormant_tag_no_longer_gated_fails(tmp_path):
    vdir, tdir = _dirs(tmp_path)
    _validator(vdir, "research", "other")
    _unit_test(tdir, "research", "t1", "other")
    [msg] = _run(tmp_path, {"renamed-away": "claimed by PR #1"})
    assert "no longer a gate tag" in msg
