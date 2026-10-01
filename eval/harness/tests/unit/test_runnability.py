"""Tests for harness.runnability — the §9 pre-flight gate."""

import json
from pathlib import Path

import pytest

from harness.loader import TestSpec, load_test_from_dict
from harness.runnability import check_runnable


REPO_ROOT = Path(__file__).resolve().parents[4]
SCENARIOS = REPO_ROOT / "eval/fixtures/scenarios"
FIXTURES = REPO_ROOT / "eval/fixtures/mcp"
SKILLS = REPO_ROOT / "packages/engine/plugin/skills"
TESTS = REPO_ROOT / "eval/tests/unit"


# The synthetic specs below name `record-extraction`, not `search-wikipedia`.
# Issue #2795 deleted that skill directory, and these tests pass the REAL
# `skills_dir`, so a routed spec naming it now aborts `skill not found` before
# reaching the rubric, fixture, stub and invariant gates each of these tests is
# actually about. The lead's 2026-09-22 ruling names `research` and
# `record-extraction` as the two skills that never convert, so this name cannot
# rot out from under the next conversion card.
def _runnable_test_dict():
    return {
        "test": {
            "id": "ut_runnability_001",
            "skill": "research",
            "name": "rn",
            "type": "positive",
            "description": "x",
            "tags": [],
        },
        "input": {"user_message": "look it up", "scenario": None},
        "mcp_fixtures": ["wikipedia-search-schuylkill-county"],
        "judge_context": [],
    }


def test_happy_path_runnable():
    spec = load_test_from_dict(_runnable_test_dict())
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is True
    assert result.reason is None


def test_blocks_when_scenario_notes_non_empty():
    d = _runnable_test_dict()
    d["input"]["scenario_notes"] = "need a variant where..."
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "scenario_notes" in result.reason


def test_blocks_when_scenario_missing():
    d = _runnable_test_dict()
    d["input"]["scenario"] = "nope-not-real"
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "scenario" in result.reason


def test_blocks_when_fixture_missing():
    d = _runnable_test_dict()
    d["mcp_fixtures"] = ["nope"]
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "fixture" in result.reason


def test_blocks_when_fixture_missing_args(tmp_path):
    """Fixtures must declare a non-empty `args` block — required for
    dispatch and Tool Arguments grading. The gate catches authors who
    forget to add it."""
    fake_fixtures = tmp_path / "fixtures"
    fake_fixtures.mkdir()
    (fake_fixtures / "noargs.json").write_text(
        '{"tool": "wikipedia_search", "description": "x", "response": {"title": "X"}}', encoding="utf-8"
    )
    d = _runnable_test_dict()
    d["mcp_fixtures"] = ["noargs"]
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=fake_fixtures,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "args" in result.reason


def test_blocks_when_fixture_args_empty(tmp_path):
    fake_fixtures = tmp_path / "fixtures"
    fake_fixtures.mkdir()
    (fake_fixtures / "emptyargs.json").write_text(
        '{"tool": "wikipedia_search", "description": "x", "args": {},'
        ' "response": {"title": "X"}}', encoding="utf-8"
    )
    d = _runnable_test_dict()
    d["mcp_fixtures"] = ["emptyargs"]
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=fake_fixtures,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "args" in result.reason


def test_blocks_when_skill_missing():
    d = _runnable_test_dict()
    d["test"]["skill"] = "imaginary-skill"
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "skill" in result.reason


def test_runnable_when_rubric_missing(tmp_path):
    """Rubric is opt-in per unit-test-spec-v2.md. A missing rubric.md is
    NOT a runnability failure — the skill is graded on base dimensions
    only."""
    fake_tests = tmp_path / "tests"
    (fake_tests / "research").mkdir(parents=True)
    # no rubric.md
    spec = load_test_from_dict(_runnable_test_dict())
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=fake_tests)
    assert result.runnable is True


def test_blocks_when_rubric_empty(tmp_path):
    """A blank rubric.md is NOT equivalent to a missing one. Opting out of
    rubric grading means deleting the file; a blank one is rejected by the
    CRUD UI's parser, so letting it through here would grade the run on base
    dimensions while breaking the skills list the annotator needs."""
    fake_tests = tmp_path / "tests"
    (fake_tests / "research").mkdir(parents=True)
    (fake_tests / "research" / "rubric.md").write_text("", encoding="utf-8")
    spec = load_test_from_dict(_runnable_test_dict())
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=fake_tests)
    assert result.runnable is False
    assert "delete the file" in (result.reason or "")


def test_blocks_when_rubric_malformed(tmp_path):
    fake_tests = tmp_path / "tests"
    (fake_tests / "research").mkdir(parents=True)
    (fake_tests / "research" / "rubric.md").write_text("no proper structure here", encoding="utf-8")
    spec = load_test_from_dict(_runnable_test_dict())
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=fake_tests)
    assert result.runnable is False
    assert "rubric" in result.reason


def test_runnable_when_mcp_skill_has_non_keyword_dimension_name(tmp_path):
    """v1.8 relaxed: the runnability gate no longer blocks based on
    tool-usage-keyword match against dimension names. A rubric whose
    author named the dimension "Search quality" rather than "Tool usage"
    runs fine; if the skill actually calls MCP tools and no keyword-matching
    dimension exists, the orchestrator emits a `warnings` entry instead
    of failing the gate."""
    fake_skills = tmp_path / "skills"
    fake_tests = tmp_path / "tests"
    (fake_skills / "search-records-clone").mkdir(parents=True)
    (fake_skills / "search-records-clone" / "SKILL.md").write_text(
        "---\nname: search-records-clone\nallowed-tools:\n  - record_search\n---\n# Search\n", encoding="utf-8"
    )
    (fake_tests / "search-records-clone").mkdir(parents=True)
    (fake_tests / "search-records-clone" / "rubric.md").write_text(
        "# search-records-clone\n\n## Search quality\n\n"
        "- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
    )
    d = _runnable_test_dict()
    d["test"]["skill"] = "search-records-clone"
    d["mcp_fixtures"] = []
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
        skills_dir=fake_skills, tests_dir=fake_tests,
    )
    assert result.runnable is True


def test_blocks_when_negative_correct_skill_has_typo(tmp_path):
    """Spec: a typo in negative.correct_skill silently produces an
    unsatisfiable test — Claude can route correctly and still fail.
    The gate must catch this."""
    d = _runnable_test_dict()
    d["test"]["type"] = "negative"
    d["negative"] = {
        "correct_skill": ["search-record"],  # typo: missing 's'
        "explanation": "x",
    }
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "search-record" in result.reason
    assert "not an existing skill" in result.reason


def _stub_check(execution):
    d = _runnable_test_dict()
    d["execution"] = execution
    return check_runnable(
        load_test_from_dict(d), scenarios_dir=SCENARIOS,
        fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS,
    )


@pytest.mark.parametrize(
    "entry",
    [
        "search-external-site",  # typo: missing trailing 's'
        {"skill": "search-external-site", "response": "Ancestry: https://x"},
    ],
    ids=["bare-string-form", "canned-response-form"],
)
def test_blocks_when_stub_skills_names_a_nonexistent_skill(entry):
    """A stub is matched by exact name in the PreToolUse hook, so a typo is a
    silent no-op — the callee runs for real and the run log looks identical to
    a working stub. Both declared forms must be gated."""
    result = _stub_check({"stub_skills": [entry]})
    assert result.runnable is False
    assert "search-external-site" in result.reason
    assert "not an existing skill" in result.reason


def test_allows_stub_skills_naming_a_real_skill():
    result = _stub_check(
        {"stub_skills": ["search-external-sites", {"skill": "research-plan"}]}
    )
    assert result.runnable is True


def test_allows_stub_skills_naming_an_agent_with_no_skill_directory():
    """A callee converted from a skill to an agent is stubbed at its spawn
    (issue #2825). `gps-mentor` ships as an agent only."""
    assert not (SKILLS / "gps-mentor").exists()
    assert _stub_check({"stub_skills": ["gps-mentor"]}).runnable is True


@pytest.mark.parametrize("execution", [{}, {"stub_skills": []}, {"max_turns": 35}])
def test_stub_skills_gate_is_inert_when_nothing_is_declared(execution):
    assert _stub_check(execution).runnable is True


@pytest.mark.parametrize(
    "stub_entry",
    ["search-external-sites", {"skill": "search-external-sites"}],
    ids=["bare-string-form", "canned-response-form"],
)
def test_blocks_a_callee_declared_in_both_run_skills_and_stub_skills(stub_entry):
    """The one combination worse than either alone.

    `run_skills` unions the callee's allowed-tools into the session allowlist
    and makes the fixture preflight demand a fixture for each. `stub_skills`
    denies the launch and waives that demand — `uncovered_callee_fixtures`
    skips a stubbed callee outright. Declared together they compose into
    neither: the tools are granted, the fixture check is skipped, and the
    callee never runs to need them. The main thread can then call one, find no
    fixture, and abort the caller with `unmatched_tool_call` ~20 turns in.

    The schema calls the two "mutually exclusive" in prose but has no
    `not`/`allOf` enforcing it, so before this gate a test could declare both
    and nothing complained. Both stub forms are gated because
    `parse_stub_skills` normalizes them to the same name.
    """
    result = _stub_check(
        {"run_skills": ["search-external-sites"], "stub_skills": [stub_entry]}
    )
    assert result.runnable is False
    assert "search-external-sites" in result.reason
    assert "BOTH" in result.reason
    assert "run_skills" in result.reason and "stub_skills" in result.reason


def test_allows_run_skills_and_stub_skills_naming_different_callees():
    """Both fields on one test is fine — the constraint is per callee, not per
    test. search-records delegates to several skills and a test may reasonably
    execute one and deny another."""
    result = _stub_check(
        {"run_skills": ["search-external-sites"], "stub_skills": ["research-plan"]}
    )
    assert result.runnable is True


@pytest.mark.parametrize(
    "execution",
    [
        {"run_skills": ["search-external-sites"]},
        {"run_skills": [], "stub_skills": ["search-external-sites"]},
        {"run_skills": [], "stub_skills": []},
    ],
    ids=["run-only", "empty-run-list", "both-empty"],
)
def test_exclusivity_gate_is_inert_without_an_actual_overlap(execution):
    assert _stub_check(execution).runnable is True


def _check_with(tags, execution):
    d = _runnable_test_dict()
    d["test"]["tags"] = tags
    d["execution"] = execution
    return check_runnable(
        load_test_from_dict(d), scenarios_dir=SCENARIOS,
        fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS,
    )


@pytest.mark.parametrize(
    "execution",
    [{}, {"stub_skills": []}, {"max_turns": 20}],
    ids=["no-execution", "empty-stub-list", "no-stub-key"],
)
def test_blocks_grade_trigger_without_stubbed_callees(execution):
    """grade:trigger (issue #2156) grades a positive test on activation alone,
    with the judge dimensions diagnostic. That is sound only when the delegated
    sub-skills are stubbed — an outcome score would otherwise measure the stub,
    not the skill. Tagged but stubbing nothing, the callees run for real and the
    tag silences the judge's gate over that real execution: a vacuous pass, the
    same failure mode as grade_on_invariant. It must be refused at load time."""
    result = _check_with(["grade:trigger"], execution)
    assert result.runnable is False
    assert "grade:trigger" in result.reason
    assert "stub_skills" in result.reason


def test_allows_grade_trigger_with_stubbed_callees():
    """The four shipped grade:trigger fixtures all stub their callees, so this
    is the positive control for that population."""
    result = _check_with(["grade:trigger"], {"stub_skills": ["research-plan"]})
    assert result.runnable is True


def test_grade_trigger_gate_is_inert_without_the_tag():
    """The other direction: an ordinary positive test with no stubs is still
    runnable — the empty-stub refusal fires only for grade:trigger, not for
    every stubless positive test."""
    assert _check_with([], {}).runnable is True


def _invariant_test_dict(tags):
    d = _runnable_test_dict()
    d["test"]["type"] = "negative"
    d["test"]["tags"] = tags
    d["negative"] = {
        "correct_skill": ["research-plan"],
        "explanation": "x",
        "grade_on_invariant": True,
    }
    return d


def _validators_dir(tmp_path, body):
    """A validators dir holding one validator file for record-extraction
    (the skill `_runnable_test_dict` uses)."""
    v = tmp_path / "validators"
    v.mkdir()
    (v / "test_research.py").write_text(body, encoding="utf-8")
    return v


OPT_IN_VALIDATOR = '''
import pytest

def test_invariant(test):
    if "no-harm" not in test.get("tags", []):
        pytest.skip("not a no-harm scenario")
    assert True
'''

# The gate must see the tag check even when it is one operand of a
# compound condition — citation's real validator is written this way, and
# missing it would falsely abort ut_citation_012.
COMPOUND_VALIDATOR = '''
import pytest

def test_invariant(test):
    if test.get("type") != "positive" and "no-harm" not in test.get("tags", []):
        pytest.skip("negative test without the no-harm invariant")
    assert True
'''

# `"<tag>" in tags -> skip` turns a validator OFF for tagged tests, so it
# can never be the invariant a grade_on_invariant test leans on.
EXCLUSION_VALIDATOR = '''
import pytest

def test_invariant(test):
    if "no-harm" in test.get("tags", []):
        pytest.skip("excluded")
    assert True
'''


@pytest.mark.parametrize("body", [OPT_IN_VALIDATOR, COMPOUND_VALIDATOR])
def test_allows_grade_on_invariant_with_matching_validator(tmp_path, body):
    spec = load_test_from_dict(_invariant_test_dict(["no-harm"]))
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
        validators_dir=_validators_dir(tmp_path, body),
    )
    assert result.runnable is True, result.reason


@pytest.mark.parametrize(
    "tags,body",
    [
        # Typo'd tag — reaches no validator.
        (["no-harn"], OPT_IN_VALIDATOR),
        # Tag omitted entirely.
        ([], OPT_IN_VALIDATOR),
        # Tag exists but only as an exclusion gate.
        (["no-harm"], EXCLUSION_VALIDATOR),
    ],
)
def test_blocks_grade_on_invariant_without_live_validator(tmp_path, tags, body):
    """grade_on_invariant hands the verdict to the invariant validator, so a
    tag that reaches no validator passes VACUOUSLY — green forever, asserting
    nothing. Same silent-unsatisfiability class as a correct_skill typo."""
    spec = load_test_from_dict(_invariant_test_dict(tags))
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
        validators_dir=_validators_dir(tmp_path, body),
    )
    assert result.runnable is False
    assert "grade_on_invariant" in result.reason
    assert "vacuous" in result.reason


def test_blocks_grade_on_invariant_when_skill_has_no_validator_file(tmp_path):
    spec = load_test_from_dict(_invariant_test_dict(["no-harm"]))
    empty = tmp_path / "validators"
    empty.mkdir()
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS, validators_dir=empty,
    )
    assert result.runnable is False
    assert "vacuous" in result.reason


def test_grade_on_invariant_check_exempts_xfail(tmp_path):
    """Matches the correct_skill check's exemption: an xfail test is an
    explicitly declared known-failing test, not a typo to catch."""
    d = _invariant_test_dict([])
    d["test"]["expected_outcome"] = "xfail"
    d["test"]["xfail_reason"] = "validator not written yet"
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
        validators_dir=_validators_dir(tmp_path, OPT_IN_VALIDATOR),
    )
    assert result.runnable is True, result.reason


def _corpus_invariant_specs():
    out = []
    for path in sorted(TESTS.glob("*/*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if (raw.get("negative") or {}).get("grade_on_invariant"):
            out.append(pytest.param(path, id=raw["test"]["id"]))
    return out


# Tests blocked by the skill-to-agent conversion WINDOW, not by the vacuous
# class this check is about. `{test id: (callee, issue that deletes it)}`.
#
# Issue #2825 ruling C: a converted callee's negatives in a not-yet-converted
# suite abort `not_runnable` until that suite's own conversion card lands, and
# "that is an aborted row, not a wrong verdict, and it is accepted". The lead
# also rejected widening the `correct_skill` gate to resolve an agent, as
# harness work spent keeping alive tests that are about to be deleted.
#
# So the block is ruled, expected and time-boxed -- but it is a DIFFERENT block
# from the one this check exists for, and letting it red the suite would mean
# either deleting another suite's test or editing it, which stales that skill's
# run log and buys a paid re-run it does not otherwise owe. (Measured
# 2026-09-27 against a detached origin/main worktree: `search-familysearch-wiki`'s
# v1_2026-09-21_18-16-58 is ACTIVE with zero snapshot diffs, so the re-run would
# be caused entirely by this edit.) Issue #2795 decided to leave it.
#
# SHRINK-ONLY, and asserted in both directions: an entry whose test has become
# runnable fails here ("the window closed -- delete this entry"), and an entry
# whose test is blocked for any OTHER reason fails too. The vacuous-validator
# class is still asserted for these ids, because the reason is pinned to the
# `correct_skill` one and a vacuous fixture produces a different reason.
CONVERSION_WINDOW = {
    "ut_search_wiki_004": ("search-wikipedia", "#2794"),
}


@pytest.mark.parametrize("path", _corpus_invariant_specs())
def test_every_corpus_grade_on_invariant_test_has_a_live_validator(path):
    """The real corpus, against the real validators dir. This is the check
    that would have caught the compound-condition miss: every shipped
    grade_on_invariant test must have a validator its tags actually reach."""
    from harness.loader import load_test

    spec = load_test(path)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
    )

    if spec.id in CONVERSION_WINDOW:
        callee, closing_issue = CONVERSION_WINDOW[spec.id]
        assert result.runnable is False, (
            f"{spec.id} is runnable again, so the conversion window that "
            f"CONVERSION_WINDOW excuses it for has closed. Delete its entry "
            f"rather than leaving a carve-out nothing needs."
        )
        reason = result.reason or ""
        assert "negative.correct_skill" in reason and callee in reason, (
            f"{spec.id} is blocked for a reason CONVERSION_WINDOW does not "
            f"excuse -- it excuses ONLY a correct_skill naming the converted "
            f"callee {callee!r}, and this check's own class (a "
            f"grade_on_invariant tag that reaches no validator) is not "
            f"excused. Reason was: {reason}"
        )
        assert (SKILLS.parent / "agents" / f"{callee}.md").is_file(), (
            f"{callee} is neither a skill nor an agent, so this is not the "
            f"conversion window at all -- it is a plain typo. Fix the test."
        )

        # `check_runnable` returns on its FIRST failure and the correct_skill
        # gate runs ahead of the grade_on_invariant one, so the assertions above
        # would pass on a fixture that is ALSO vacuous -- the very class this
        # file exists for, hidden by the carve-out. Measured: dropping
        # `no-wiki-search` (ut_search_wiki_004's gating tag) left this green.
        # So re-run the check with only the conversion obstacle removed, and
        # require the rest of the gate to pass exactly as it does for every
        # other fixture.
        raw = json.loads(path.read_text(encoding="utf-8"))
        raw["negative"]["correct_skill"] = [
            n for n in raw["negative"]["correct_skill"] if n != callee
        ]
        without = check_runnable(
            load_test_from_dict(raw), scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
            skills_dir=SKILLS, tests_dir=TESTS,
        )
        assert without.runnable is True, (
            f"{spec.id} is excused for naming the converted callee {callee!r}, "
            f"but it fails the gate for a second, unexcused reason as well: "
            f"{without.reason}. {closing_issue} deletes this test; fix or delete "
            f"it now rather than letting the carve-out cover this."
        )
        pytest.skip(
            f"{spec.id} blocked by the #2825 conversion window; {closing_issue} "
            f"deletes it"
        )

    assert result.runnable is True, result.reason


def test_blocks_when_scenario_research_json_fails_schema(tmp_path):
    """Spec §9: scenario must pass schema validation, not just JSON parse."""
    fake_scenarios = tmp_path / "scenarios"
    (fake_scenarios / "schemabad").mkdir(parents=True)
    # Parseable JSON, but missing required project fields.
    (fake_scenarios / "schemabad" / "research.json").write_text(
        '{"project": {"id": "rp_1"}, "questions": [], "plans": [],'
        ' "log": [], "sources": [], "assertions": [], "person_evidence": [],'
        ' "conflicts": [], "hypotheses": [], "timelines": [],'
        ' "proof_summaries": []}', encoding="utf-8"
    )
    (fake_scenarios / "schemabad" / "tree.gedcomx.json").write_text(
        '{"persons":[],"relationships":[],"sources":[]}', encoding="utf-8"
    )
    d = _runnable_test_dict()
    d["input"]["scenario"] = "schemabad"
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=fake_scenarios, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "schema" in result.reason.lower()


def test_blocks_when_scenario_tree_gedcomx_json_fails_schema(tmp_path):
    """Spec §9: scenario's tree.gedcomx.json must also pass schema
    validation, not just JSON-parse. Earlier coverage tested research.json
    only; tree.gedcomx.json is the parallel case."""
    fake_scenarios = tmp_path / "scenarios"
    (fake_scenarios / "treebad").mkdir(parents=True)
    # Valid research.json so the test reaches the tree check.
    (fake_scenarios / "treebad" / "research.json").write_text(
        '{"project": {"id": "rp_1", "objective": "x", "status": "active",'
        ' "created": "2026-01-01", "updated": "2026-01-01"},'
        ' "questions": [], "plans": [], "log": [], "sources": [],'
        ' "assertions": [], "person_evidence": [], "conflicts": [],'
        ' "hypotheses": [], "timelines": [], "proof_summaries": [],'
        ' "evaluations": []}', encoding="utf-8"
    )
    # Parseable JSON but missing the required `persons` array.
    (fake_scenarios / "treebad" / "tree.gedcomx.json").write_text(
        '{"relationships": [], "sources": []}', encoding="utf-8"
    )
    d = _runnable_test_dict()
    d["input"]["scenario"] = "treebad"
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=fake_scenarios, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "schema" in result.reason.lower()
    assert "tree.gedcomx.json" in result.reason


def test_blocks_when_scenario_research_json_invalid(tmp_path):
    # Build a fake scenarios dir with an invalid research.json
    fake_scenarios = tmp_path / "scenarios"
    (fake_scenarios / "broken").mkdir(parents=True)
    (fake_scenarios / "broken" / "research.json").write_text("{ not json", encoding="utf-8")
    (fake_scenarios / "broken" / "tree.gedcomx.json").write_text('{"persons":[],"relationships":[],"sources":[]}', encoding="utf-8")
    d = _runnable_test_dict()
    d["input"]["scenario"] = "broken"
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=fake_scenarios, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "research.json" in result.reason or "scenario" in result.reason


def test_intentionally_invalid_flag_bypasses_schema_gate(tmp_path):
    """A test that opts in with `intentionally_invalid` runs against a
    schema-invalid scenario instead of being aborted. The flag is the only
    difference from test_blocks_when_scenario_research_json_fails_schema, so
    this also proves the flag — not a blanket bypass — is what unblocks it."""
    fake_scenarios = tmp_path / "scenarios"
    (fake_scenarios / "schemabad").mkdir(parents=True)
    # Same broken-on-purpose scenario as the blocking test above.
    (fake_scenarios / "schemabad" / "research.json").write_text(
        '{"project": {"id": "rp_1"}, "questions": [], "plans": [],'
        ' "log": [], "sources": [], "assertions": [], "person_evidence": [],'
        ' "conflicts": [], "hypotheses": [], "timelines": [],'
        ' "proof_summaries": []}', encoding="utf-8"
    )
    (fake_scenarios / "schemabad" / "tree.gedcomx.json").write_text(
        '{"persons":[],"relationships":[],"sources":[]}', encoding="utf-8"
    )
    d = _runnable_test_dict()
    d["input"]["scenario"] = "schemabad"
    d["intentionally_invalid"] = True
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=fake_scenarios, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is True
    assert result.reason is None


# ---- direct-agent tests key `test.skill` to an agent file (issue #1253) ----
#
# A direct test has no routing skill by construction — `stage_skills=not
# spec.is_direct` never stages one — and an agent-keyed suite (`gps-mentor`)
# has no skill directory at all. Before the fallback these tests aborted at
# "skill not found" before any delegation branch ran, which is what left
# `gps-mentor` with no way to be a test's subject.

AGENTS = REPO_ROOT / "packages/engine/plugin/agents"


def _direct_test_dict(skill="gps-mentor"):
    return {
        "test": {
            "id": "ut_runnability_direct_001",
            "skill": skill,
            "name": "rn",
            "type": "positive",
            "description": "x",
            "tags": [],
        },
        "input": {"delegation": "Critique ps_001.", "scenario": None},
        "mcp_fixtures": [],
        "judge_context": [],
    }


def test_direct_test_runnable_when_only_the_agent_file_exists():
    """The case the fallback exists for: an agent with no routing skill.

    Asserts the two preconditions inline so this reds loudly (rather than
    passing vacuously) if someone later creates a `gps-mentor` skill directory
    — which `scripts/package-plugin.mjs` would then ship as a user-triggerable
    skill competing with the agent's own description.
    """
    spec = load_test_from_dict(_direct_test_dict())
    assert spec.is_direct is True
    assert not (SKILLS / "gps-mentor").is_dir()
    assert (AGENTS / "gps-mentor.md").is_file()
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is True
    assert result.reason is None


def test_direct_test_blocked_when_neither_skill_nor_agent_exists():
    spec = load_test_from_dict(_direct_test_dict(skill="not-a-real-pair"))
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "not-a-real-pair.md" in result.reason


def test_routed_test_still_blocked_by_a_missing_skill_directory():
    """The fallback is gated on `is_direct` deliberately.

    On a ROUTED test a missing skill directory is still a typo worth catching,
    and falling through to a same-named agent would grade the test by a route
    it never asked for. `gps-mentor` is the sharpest case: the agent file
    exists, so only the `is_direct` gate keeps this red.
    """
    d = _runnable_test_dict()
    d["test"]["skill"] = "gps-mentor"
    spec = load_test_from_dict(d)
    assert spec.is_direct is False
    assert (AGENTS / "gps-mentor.md").is_file()
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "skill not found" in result.reason


def test_direct_gate_resolves_the_same_agent_file_as_prompt_for():
    """Gate-time and run-time must name one artifact.

    If these drift, a direct test clears the gate and then dies in
    `_prompt_for` ~20 turns into a paid run, which is the failure the gate
    exists to move forward to load time.
    """
    from harness.orchestrator import _prompt_for

    spec = load_test_from_dict(_direct_test_dict())
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is True
    prompt = _prompt_for(spec)
    assert "gps-mentor" in prompt
    assert "Critique ps_001." in prompt


def test_a_test_only_skill_passes_the_skill_gate():
    """`eval/skills/<name>` is a skill the harness stages for its own suite, so
    the gate resolves it the way the workspace does (`skill_dir_for`)."""
    d = _runnable_test_dict()
    d["test"]["skill"] = "extraction-append"
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.reason is None or "skill not found" not in result.reason


def test_an_unknown_skill_still_fails_the_skill_gate():
    d = _runnable_test_dict()
    d["test"]["skill"] = "no-such-skill-anywhere"
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "skill not found" in result.reason
