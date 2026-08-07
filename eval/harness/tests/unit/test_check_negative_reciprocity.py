"""Unit tests for scripts/check_negative_reciprocity.py.

Covers the graph builder and the reciprocity diff on synthetic corpora built
under tmp_path — never the real one. A test that asserted the live corpus has
exactly N asymmetric edges would be the same defect the script's docstring
rejects for a count threshold: it reds for anyone who adds a negative test,
and it stays green when one edge is swapped for another.

To check the builder against the real corpus, run the script and compare the
edges it reports as a SET against the previous run's, not as a count —
`python eval/harness/scripts/check_negative_reciprocity.py`, then diff the
``edge `A -> B` `` pairs. A count comparison cannot distinguish "one edge
removed, another added" from "no change", which is the whole reason this
check is a set.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "check_negative_reciprocity",
    Path(__file__).resolve().parents[2]
    / "scripts"
    / "check_negative_reciprocity.py",
)
check_negative_reciprocity = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_negative_reciprocity)


def write_test(
    tests_dir: Path,
    skill: str,
    test_id: str,
    *,
    type_: str = "negative",
    correct_skill: list[str] | None = None,
    skill_field: str | None = None,
) -> Path:
    """Write one test JSON into `tests_dir/<skill>/<test_id>.json`.

    `skill_field` overrides `test.skill` independently of the directory, so
    the source-of-truth rule can be exercised.
    """
    skill_dir = tests_dir / skill
    skill_dir.mkdir(parents=True, exist_ok=True)
    payload: dict = {
        "test": {
            "id": test_id,
            "skill": skill_field if skill_field is not None else skill,
            "type": type_,
        }
    }
    if correct_skill is not None:
        payload["negative"] = {
            "correct_skill": correct_skill,
            "explanation": "boundary between the two skills",
        }
    path = skill_dir / f"{test_id}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def make_suite(tests_dir: Path, *skills: str) -> None:
    """Create empty suite directories, so a skill can be a legal reciprocal
    target without yet having any test in it."""
    for skill in skills:
        (tests_dir / skill).mkdir(parents=True, exist_ok=True)


def flagged_pairs(tests_dir: Path) -> set[tuple[str, str]]:
    return {
        (source, target)
        for source, target, _ids in check_negative_reciprocity.asymmetric_edges(
            tests_dir
        )
    }


def test_asymmetric_edge_is_flagged(tmp_path: Path) -> None:
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=["beta"])
    make_suite(tmp_path, "beta")
    assert flagged_pairs(tmp_path) == {("alpha", "beta")}


def test_reciprocal_edge_is_not_flagged(tmp_path: Path) -> None:
    """The ut_locality_guide_025 shape: a pair pinned from both sides."""
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=["beta"])
    write_test(tmp_path, "beta", "ut_beta_001", correct_skill=["alpha"])
    assert flagged_pairs(tmp_path) == set()


def test_reciprocity_is_per_pair_not_per_skill(tmp_path: Path) -> None:
    """Having *a* negative test does not back a skill's every inbound edge —
    the reciprocal must name the specific source."""
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=["beta"])
    write_test(tmp_path, "beta", "ut_beta_001", correct_skill=["gamma"])
    make_suite(tmp_path, "gamma")
    assert flagged_pairs(tmp_path) == {("alpha", "beta"), ("beta", "gamma")}


def test_multi_target_correct_skill_yields_two_edges(tmp_path: Path) -> None:
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=["beta", "gamma"])
    make_suite(tmp_path, "beta", "gamma")
    assert check_negative_reciprocity.routing_edges(tmp_path).keys() == {
        ("alpha", "beta"),
        ("alpha", "gamma"),
    }
    assert flagged_pairs(tmp_path) == {("alpha", "beta"), ("alpha", "gamma")}


def test_empty_correct_skill_yields_no_edges(tmp_path: Path) -> None:
    """`correct_skill: []` means no skill should fire — an out-of-scope
    message has no destination, so it can have no reciprocal."""
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=[])
    assert check_negative_reciprocity.routing_edges(tmp_path) == {}
    assert flagged_pairs(tmp_path) == set()


def test_self_naming_target_yields_no_edge(tmp_path: Path) -> None:
    """A skill naming itself is not a routing edge.

    Four corpus tests do this deliberately — `citation` accepts
    `["record-extraction", "citation"]`, `convert-dates` accepts
    `["convert-dates"]` — to say the skill under test handling the request is
    also acceptable. `A -> A` has no reciprocal to write, so admitting it
    would inflate the edge total while trivially satisfying its own check.
    The co-listed real target must still produce its edge.
    """
    write_test(
        tmp_path, "alpha", "ut_alpha_001", correct_skill=["beta", "alpha"]
    )
    write_test(tmp_path, "gamma", "ut_gamma_001", correct_skill=["gamma"])
    make_suite(tmp_path, "beta")
    assert check_negative_reciprocity.routing_edges(tmp_path).keys() == {
        ("alpha", "beta")
    }
    assert flagged_pairs(tmp_path) == {("alpha", "beta")}


def test_target_without_suite_dir_is_skipped_not_flagged(tmp_path: Path) -> None:
    """A reciprocal cannot be written into a suite that does not exist."""
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=["research"])
    assert flagged_pairs(tmp_path) == set()
    assert check_negative_reciprocity.skipped_edges(tmp_path) == [
        ("alpha", "research")
    ]


def test_positive_tests_contribute_no_edges(tmp_path: Path) -> None:
    write_test(
        tmp_path,
        "alpha",
        "ut_alpha_001",
        type_="positive",
        correct_skill=["beta"],
    )
    make_suite(tmp_path, "beta")
    assert check_negative_reciprocity.routing_edges(tmp_path) == {}


def test_negative_test_without_negative_block_is_ignored(tmp_path: Path) -> None:
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=None)
    assert check_negative_reciprocity.routing_edges(tmp_path) == {}


def test_malformed_json_contributes_nothing(tmp_path: Path) -> None:
    (tmp_path / "alpha").mkdir()
    (tmp_path / "alpha" / "broken.json").write_text("{not valid json", encoding="utf-8")
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=["beta"])
    make_suite(tmp_path, "beta")
    assert flagged_pairs(tmp_path) == {("alpha", "beta")}


def test_divergent_skill_field_sources_the_edge_from_the_field(
    tmp_path: Path,
) -> None:
    """`test.skill` is schema-required and authoritative for the harness, so
    it sources the edge — and the reciprocal lookup keys on the same map, not
    on a directory listing. A divergence here is a corpus bug; this pins which
    of the two the script reads so the halves cannot silently drift apart.
    """
    write_test(
        tmp_path,
        "alpha",
        "ut_gamma_001",
        correct_skill=["beta"],
        skill_field="gamma",
    )
    make_suite(tmp_path, "beta", "gamma")
    assert check_negative_reciprocity.routing_edges(tmp_path).keys() == {
        ("gamma", "beta")
    }
    assert flagged_pairs(tmp_path) == {("gamma", "beta")}


def test_missing_skill_field_contributes_no_edge(tmp_path: Path) -> None:
    """No directory fallback. `test.skill` is schema-required, so its absence
    is a corpus violation — sourcing the edge from the parent directory would
    key this half of the pair differently from the reciprocal lookup, which is
    precisely what makes a divergent test read as deliberate rather than
    broken. Unreachable against a valid corpus; pinned so the fallback cannot
    be reintroduced as a harmless-looking convenience.
    """
    skill_dir = tmp_path / "alpha"
    skill_dir.mkdir()
    (skill_dir / "ut_alpha_001.json").write_text(
        json.dumps(
            {
                "test": {"id": "ut_alpha_001", "type": "negative"},
                "negative": {"correct_skill": ["beta"], "explanation": "x"},
            }
        ),
        encoding="utf-8",
    )
    make_suite(tmp_path, "beta")
    assert check_negative_reciprocity.routing_edges(tmp_path) == {}
    assert flagged_pairs(tmp_path) == set()


def test_edges_carry_the_declaring_test_ids(tmp_path: Path) -> None:
    """Provenance is why the warning can name a starting point despite
    carrying no `file=` annotation — the missing file has no path."""
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=["beta"])
    write_test(tmp_path, "alpha", "ut_alpha_002", correct_skill=["beta"])
    make_suite(tmp_path, "beta")
    assert check_negative_reciprocity.asymmetric_edges(tmp_path) == [
        ("alpha", "beta", ["ut_alpha_001", "ut_alpha_002"])
    ]


def test_suite_skills_reads_directories(tmp_path: Path) -> None:
    make_suite(tmp_path, "alpha", "beta")
    (tmp_path / "loose.json").write_text("{}", encoding="utf-8")
    assert check_negative_reciprocity.suite_skills(tmp_path) == {"alpha", "beta"}


def test_missing_corpus_returns_empty(tmp_path: Path) -> None:
    missing = tmp_path / "nope"
    assert check_negative_reciprocity.routing_edges(missing) == {}
    assert check_negative_reciprocity.suite_skills(missing) == set()


def test_main_returns_zero_on_a_fully_asymmetric_corpus(
    tmp_path: Path, capsys
) -> None:
    """The never-blocks property, asserted rather than assumed.

    This is why `main()` takes a `tests_dir` at all: the sibling lint's
    `main()` reads module-level constants and its test suite never calls it,
    so copying that shape would have left the script's central claim — that
    it can never red a build — untested.
    """
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=["beta"])
    write_test(tmp_path, "beta", "ut_beta_001", correct_skill=["gamma"])
    write_test(tmp_path, "gamma", "ut_gamma_001", correct_skill=["alpha"])
    assert check_negative_reciprocity.main(tmp_path) == 0
    out = capsys.readouterr().out
    assert out.count("::warning::") == 3
    assert "3 of them have no reciprocal" in out


def test_main_returns_zero_on_a_clean_corpus(tmp_path: Path, capsys) -> None:
    write_test(tmp_path, "alpha", "ut_alpha_001", correct_skill=["beta"])
    write_test(tmp_path, "beta", "ut_beta_001", correct_skill=["alpha"])
    assert check_negative_reciprocity.main(tmp_path) == 0
    out = capsys.readouterr().out
    assert "::warning::" not in out
    assert "pinned from both directions" in out


def test_main_returns_zero_when_the_corpus_is_missing(
    tmp_path: Path, capsys
) -> None:
    assert check_negative_reciprocity.main(tmp_path / "nope") == 0
    assert "nothing to check" in capsys.readouterr().out
