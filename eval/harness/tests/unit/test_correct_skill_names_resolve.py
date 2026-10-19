"""Every committed test's declared callees name a live skill or agent.

Two places in `runnability.py` refuse a test whose declared callee resolves to
neither `skills/<name>/` nor `agents/<name>.md`: the `negative.correct_skill`
loop (`:325-334`) and the `execution.stub_skills` loop (`:210-218`). **Both run
only inside `make eval-skill`.** So a conversion that deletes a skill or agent
without reworking the tests naming it is discovered when a paid run aborts
`not_runnable` — PR #3000 hit two such aborts, in a run that had already been
paid for. Nothing free read the committed corpus.

Both arms are walked here rather than only `correct_skill`, because they are
one class and the stub arm is the larger surface: 200 `stub_skills` entries
across 24 files against 18 `correct_skill` entries (measured 2026-10-19). A
guard over the smaller half would leave the gap open where it is widest.

**The predicate is copied from `runnability.py`, deliberately, rather than
lifted into a shared helper** (issue #3105, decided 2026-10-16). Open PR #3479
touches that file, and a consolidation buys no correctness — a drift between
the two surfaces as a red test here, not a silent pass. If you edit the
resolution rule in `runnability.py:210-218` or `:325-334`, edit it here too.

One deliberate divergence from that predicate, because the predicate is wrong
on one input shape: `Path(skills_dir) / ""` IS the skills directory, so
`is_dir()` returns True and `correct_skill: [""]` reads as a live skill. The
same holds for `"."`. This walk rejects a falsy or dot-only name as a shape
check on the input. That makes it stricter than the paid gate on exactly that
shape; the corpus carries none, so both agree on every committed file.

`execution.run_skills` is walked by the same loop but carries **0 entries
corpus-wide**, so it gets no premise assert below and is not claimed as
covered — an arm over an empty population asserts nothing.
"""

from __future__ import annotations

import json
from pathlib import Path

from harness.skill_stubs import parse_stub_skills
from harness.workspace import DEFAULT_PLUGIN_AGENTS, DEFAULT_PLUGIN_SKILLS

REPO_ROOT = Path(__file__).resolve().parents[4]
CORPUS = REPO_ROOT / "eval/tests/unit"

# A floor, not an equality: the corpus grows with every mined test. It exists
# because without it a mistyped path makes every assertion below pass over zero
# files — the silent success that is worse than no check at all.
MIN_EXPECTED_FILES = 300


def _resolves(name: str, skills_dir: Path, agents_dir: Path) -> bool:
    """Mirror of the resolution in `runnability.py:210-218` and `:325-334`.

    The falsy/dot guard is the divergence the module docstring records: without
    it `Path(skills_dir) / ""` resolves to the skills directory itself and an
    empty name reads as a live skill.
    """
    if not name or not name.strip() or name.strip(".") == "":
        return False
    return (skills_dir / name).is_dir() or (agents_dir / f"{name}.md").is_file()


def dead_callee_entries(
    tests_dir: Path,
    skills_dir: Path,
    agents_dir: Path,
) -> list[tuple[Path, str, int | None, str]]:
    """Return `(path, arm, index, name)` for every declared callee that is dead.

    `rglob`, not `*/*.json`: the harness's own discovery is
    `root.rglob("*.json")` (`run_tests.py`), so a nested JSON file is already a
    would-be test and a shallower glob would leave it unchecked.

    `index` is the position within `correct_skill`; it is `None` for the stub
    arm, whose entries are a set rather than an ordered list.
    """
    dead: list[tuple[Path, str, int | None, str]] = []
    for path in sorted(tests_dir.rglob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Malformed files are test_unit_test_corpus.py's to report. Skipping
            # here keeps one defect from being reported by two tests.
            continue
        if not isinstance(raw, dict):
            continue
        test = raw.get("test") or {}
        execution = raw.get("execution") or {}

        # `correct_skill` — negatives only, and xfail is exempt: an xfail test
        # is explicitly known-failing, so a callee naming a not-yet-built skill
        # is the documented reason for the marker, not a typo (runnability.py).
        if test.get("type") == "negative" and test.get("expected_outcome") != "xfail":
            for i, name in enumerate((raw.get("negative") or {}).get("correct_skill") or []):
                if not isinstance(name, str) or not _resolves(name, skills_dir, agents_dir):
                    dead.append((path, "negative.correct_skill", i, str(name)))

        # `stub_skills` — every test, no xfail exemption. runnability.py:196-199
        # states the reason: "there is no scenario where stubbing a
        # not-yet-built skill is intentional".
        for name in parse_stub_skills(execution):
            if not _resolves(name, skills_dir, agents_dir):
                dead.append((path, "execution.stub_skills", None, name))

        for name in execution.get("run_skills") or []:
            if not isinstance(name, str) or not _resolves(name, skills_dir, agents_dir):
                dead.append((path, "execution.run_skills", None, str(name)))

    return dead


def test_the_corpus_glob_actually_matches_files():
    paths = sorted(CORPUS.rglob("*.json"))
    assert len(paths) > MIN_EXPECTED_FILES, (
        f"corpus glob matched only {len(paths)} files under {CORPUS} — the path "
        f"is wrong, and every check below would pass over nothing."
    )


def test_every_declared_callee_resolves_in_the_committed_corpus():
    dead = dead_callee_entries(CORPUS, DEFAULT_PLUGIN_SKILLS, DEFAULT_PLUGIN_AGENTS)
    assert not dead, "dead callee(s) — each would abort its suite `not_runnable` " "in a PAID run:\n" + "\n".join(
        f"  {p.relative_to(REPO_ROOT)}: {arm}"
        f"{'' if i is None else f'[{i}]'} = {name!r}"
        for p, arm, i, name in dead
    )


def test_the_walk_saw_the_shapes_it_claims_to_check():
    """Premise asserts, so a passing run above cannot be vacuous.

    Counts are floors, never equalities: every skill-to-agent conversion moves
    them, and pinning one would fail the PR that performs the conversion rather
    than the PR that breaks a name.
    """
    negatives = stubbing = 0
    correct_skill_via_agent = stub_via_agent = 0
    for path in sorted(CORPUS.rglob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if not isinstance(raw, dict):
            continue
        test = raw.get("test") or {}
        if test.get("type") == "negative" and test.get("expected_outcome") != "xfail":
            negatives += 1
            for name in (raw.get("negative") or {}).get("correct_skill") or []:
                if isinstance(name, str) and not (DEFAULT_PLUGIN_SKILLS / name).is_dir():
                    correct_skill_via_agent += 1
        stubs = parse_stub_skills(raw.get("execution") or {})
        if stubs:
            stubbing += 1
            for name in stubs:
                if not (DEFAULT_PLUGIN_SKILLS / name).is_dir():
                    stub_via_agent += 1

    assert negatives, "walked no non-xfail negatives — the correct_skill arm checked nothing"
    assert stubbing, "walked no stubbing tests — the stub_skills arm checked nothing"
    assert correct_skill_via_agent, (
        "no correct_skill entry resolved through agents/ only, so this run does "
        "not prove the agent branch is reachable — the regression this guard was "
        "re-scoped to avoid would pass unnoticed"
    )
    assert stub_via_agent, (
        "no stub_skills entry resolved through agents/ only — same gap, stub arm"
    )


def _corpus(tmp_path: Path, test_file: dict, *, skills=(), agents=()) -> tuple[Path, Path, Path]:
    """Build a tmp corpus with sibling `skills/` and `agents/` dirs.

    Sibling, because `check_runnable` derives `agents_dir` from `skills_dir`
    (`runnability.py:210`); a layout where they are unrelated would not be the
    shape the real gate sees.
    """
    plugin = tmp_path / "plugin"
    skills_dir, agents_dir = plugin / "skills", plugin / "agents"
    for name in skills:
        (skills_dir / name).mkdir(parents=True)
    agents_dir.mkdir(parents=True, exist_ok=True)
    for name in agents:
        (agents_dir / f"{name}.md").write_text("x", encoding="utf-8")
    skills_dir.mkdir(parents=True, exist_ok=True)
    tests_dir = tmp_path / "tests" / "some-skill"
    tests_dir.mkdir(parents=True)
    (tests_dir / "t.json").write_text(json.dumps(test_file), encoding="utf-8")
    return tmp_path / "tests", skills_dir, agents_dir


def _negative(correct_skill, **test_extra) -> dict:
    return {
        "test": {"id": "ut_x_001", "skill": "some-skill", "type": "negative", **test_extra},
        "negative": {"correct_skill": correct_skill},
    }


# --- must FIRE -------------------------------------------------------------


def test_fires_on_a_name_matching_neither(tmp_path):
    dirs = _corpus(tmp_path, _negative(["no-such-skill"]), skills=["live"])
    assert [d[3] for d in dead_callee_entries(*dirs)] == ["no-such-skill"]


def test_reports_only_the_dead_index_in_a_mixed_list(tmp_path):
    dirs = _corpus(tmp_path, _negative(["live", "dead"]), skills=["live"])
    dead = dead_callee_entries(*dirs)
    assert len(dead) == 1, dead
    assert dead[0][2] == 1 and dead[0][3] == "dead"


def test_fires_on_an_empty_or_dot_name(tmp_path):
    """`Path(skills_dir) / ""` is the skills dir, so these read as live."""
    for i, bad in enumerate(("", ".", "..", "   ")):
        dirs = _corpus(tmp_path / f"case{i}", _negative([bad]), skills=["live"])
        dead = dead_callee_entries(*dirs)
        assert len(dead) == 1, f"{bad!r} was accepted as a live skill: {dead}"


def test_fires_on_a_dead_stub_in_both_declared_forms(tmp_path):
    for i, entry in enumerate(["dead-stub", {"skill": "dead-stub", "response": "x"}]):
        doc = {"test": {"id": "ut_x_002", "skill": "s", "type": "positive"},
               "execution": {"stub_skills": [entry]}}
        dirs = _corpus(tmp_path / f"form{i}", doc, skills=["live"])
        dead = dead_callee_entries(*dirs)
        assert [d[3] for d in dead] == ["dead-stub"], f"form {entry!r}: {dead}"


def test_fires_on_a_dead_stub_even_when_the_test_is_xfail(tmp_path):
    """The stub arm has no xfail exemption (runnability.py:196-199)."""
    doc = {"test": {"id": "ut_x_003", "skill": "s", "type": "negative",
                    "expected_outcome": "xfail"},
           "negative": {"correct_skill": ["also-dead"]},
           "execution": {"stub_skills": ["dead-stub"]}}
    dirs = _corpus(tmp_path, doc, skills=["live"])
    dead = dead_callee_entries(*dirs)
    arms = {d[1] for d in dead}
    assert arms == {"execution.stub_skills"}, (
        f"xfail must exempt correct_skill and NOT stub_skills; got {dead}"
    )


# --- must NOT fire ---------------------------------------------------------


def test_accepts_a_name_that_exists_only_as_an_agent(tmp_path):
    dirs = _corpus(tmp_path, _negative(["converted"]), skills=["live"], agents=["converted"])
    assert dead_callee_entries(*dirs) == []


def test_accepts_an_xfail_negative_naming_a_dead_correct_skill(tmp_path):
    dirs = _corpus(tmp_path, _negative(["dead"], expected_outcome="xfail"), skills=["live"])
    assert dead_callee_entries(*dirs) == []


def test_accepts_an_empty_correct_skill_list(tmp_path):
    """12 of the 30 committed non-xfail negatives carry `correct_skill: []`."""
    dirs = _corpus(tmp_path, _negative([]), skills=["live"])
    assert dead_callee_entries(*dirs) == []


def test_accepts_a_positive_test_naming_nothing(tmp_path):
    doc = {"test": {"id": "ut_x_004", "skill": "s", "type": "positive"}}
    dirs = _corpus(tmp_path, doc, skills=["live"])
    assert dead_callee_entries(*dirs) == []
