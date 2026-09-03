"""Direct tests for the V6 and V2 conflict-resolution validators (issue #1972).

Same reason as `test_proof_conclusion_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise appear
only inside a paid per-skill run.

The last two tests replay the five committed run logs through both validators.
Synthetic dicts prove the branch logic and the re-derivation script proves the
rule's arithmetic, but neither asserts the validators fire on the real data — a
shape slip between `after_state["research_json"]` and the run log's
`file_changes` shape passes both halves and is caught only here.
"""

import glob
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Loaded the way `harness/validator_runner.py` loads it — via
# `spec_from_file_location` rather than a plain import — for a reason that is
# not stylistic. pytest collects `validators/test_conflict_resolution.py` under
# `python_files = ["test_*.py"]`, so a plain import gets the ASSERTION-REWRITTEN
# module: its AssertionError carries pytest's generated explanation appended to
# the message, and `"c_001" in str(e.value)` is then satisfied by a repr of
# `touched` that the rewrite embedded — not by the validator naming the id at
# all. Both naming tests below stayed green when the message was changed to name
# nothing (@clack391). Asserting on `e.value.args[0]` does NOT fix it; the
# explanation is concatenated there too.
#
# Loading it unrewritten means these tests grade the exact string the harness
# emits, which is also the string a genealogist reads on a failed run.
#
# Aliased away from the test_*/report_* prefixes on purpose: pyproject sets
# `python_functions = ["test_*", "report_*"]`, so an imported validator keeps
# being collected as a test here and errors on its missing harness fixtures.
def _load_validator_unrewritten():
    import importlib.util

    path = _VALIDATORS_DIR / "test_conflict_resolution.py"
    spec = importlib.util.spec_from_file_location(
        "_cr_validator_unrewritten", path
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_VALIDATOR = _load_validator_unrewritten()
check_word_caps = _VALIDATOR.report_resolution_word_caps
check_one_per_turn = _VALIDATOR.test_at_most_one_conflict_analysis_modified

_REPO = Path(__file__).resolve().parents[4]  # eval/harness/tests/unit -> repo root
_CORPUS = sorted(
    p for p in glob.glob(str(_REPO / "eval/runlogs/unit/conflict-resolution/v1_*.json"))
    if not p.endswith(".ann.json")
)


def _conflict(cid, **kw):
    base = {
        "id": cid,
        "status": "unresolved",
        "independence_analysis": None,
        "weighing_analysis": None,
        "preferred_assertion_id": None,
        "resolution_rationale": None,
        "competing_assertion_ids": ["a_001", "a_002"],
    }
    base.update(kw)
    return base


def _states(before_conflicts, after_conflicts):
    return (
        {"research_json": {"conflicts": before_conflicts}},
        {"research_json": {"conflicts": after_conflicts}},
    )


def _words(n):
    return " ".join(["word"] * n)


# --- V6 -----------------------------------------------------------------

def test_v6_one_conflict_resolved_passes():
    before, after = _states(
        [_conflict("c_001"), _conflict("c_002")],
        [_conflict("c_001", status="resolved", resolution_rationale="x"), _conflict("c_002")],
    )
    check_one_per_turn(before, after)


def test_v6_two_conflicts_resolved_fails_naming_both():
    before, after = _states(
        [_conflict("c_001"), _conflict("c_002")],
        [
            _conflict("c_001", status="resolved", resolution_rationale="x"),
            _conflict("c_002", status="resolved", resolution_rationale="y"),
        ],
    )
    with pytest.raises(AssertionError) as e:
        check_one_per_turn(before, after)
    assert "c_001" in str(e.value) and "c_002" in str(e.value)


def test_v6_creating_an_empty_conflict_is_not_resolution():
    """Identification is explicitly unrestricted -- a created entry with all five
    analysis fields at their template defaults must not count."""
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", status="resolved", resolution_rationale="x"), _conflict("c_003")],
    )
    check_one_per_turn(before, after)


def test_v6_creating_an_already_resolved_conflict_counts():
    """The bypass: nothing stops a create arriving already resolved, so a run
    could resolve one and create-and-resolve a second in one turn."""
    before, after = _states(
        [_conflict("c_001")],
        [
            _conflict("c_001", status="resolved", resolution_rationale="x"),
            _conflict("c_003", status="resolved", resolution_rationale="y"),
        ],
    )
    with pytest.raises(AssertionError) as e:
        check_one_per_turn(before, after)
    assert "c_003" in str(e.value)


def test_v6_zero_conflicts_modified_passes():
    """The commonest real shape: a run that never touches conflict analysis.

    `len(touched) <= 1` was exercised at 1 and at 2 but never at 0, so an
    accidental `== 1` would have passed the suite while failing every run that
    correctly did nothing.
    """
    before, after = _states([_conflict("c_001")], [_conflict("c_001")])
    check_one_per_turn(before, after)

def test_v6_skips_when_either_side_lacks_research_json():
    """Split per side for the reason given on the V2 twin below: both-None cannot
    tell `or` from `and`."""
    good = {"research_json": {"conflicts": []}}
    with pytest.raises(pytest.skip.Exception):
        check_one_per_turn({"research_json": None}, good)
    with pytest.raises(pytest.skip.Exception):
        check_one_per_turn(good, {"research_json": None})


# --- V2 -----------------------------------------------------------------

def test_v2_rationale_inside_the_band_is_not_observed():
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", resolution_rationale=_words(260))],
    )
    check_word_caps(before, after)


def test_v2_long_rationale_on_two_way_conflict_is_observed():
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", resolution_rationale=_words(400))],
    )
    with pytest.raises(AssertionError) as e:
        check_word_caps(before, after)
    assert "400 words" in str(e.value)


def test_v2_three_way_conflict_escapes_the_rationale_cap():
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001",
                   resolution_rationale=_words(400),
                   competing_assertion_ids=["a_001", "a_002", "a_003"])],
    )
    check_word_caps(before, after)


def test_v2_escape_reads_competing_ids_from_after_state_not_the_diff():
    """The 17-vs-32 regression.

    A run almost never writes competing_assertion_ids -- it appears in
    changed_fields on 0 of the 32 over-cap writes in the corpus. An
    implementation that looks for it among the changed fields sees nothing,
    concludes "fewer than three", and the escape never applies. Here the field is
    unchanged between before and after AND has three entries: the escape must
    still apply.
    """
    three = ["a_001", "a_002", "a_003"]
    before, after = _states(
        [_conflict("c_001", competing_assertion_ids=three)],
        [_conflict("c_001", competing_assertion_ids=three,
                   resolution_rationale=_words(400))],
    )
    check_word_caps(before, after)


def test_v2_long_weighing_is_observed():
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", weighing_analysis=_words(215))],
    )
    with pytest.raises(AssertionError) as e:
        check_word_caps(before, after)
    assert "215 words" in str(e.value)


def test_v2_covers_newly_created_conflicts():
    """V2's population is wider than V6's on purpose: a conflict the run authored
    is exactly what a word cap is for."""
    before, after = _states(
        [],
        [_conflict("c_003", resolution_rationale=_words(400))],
    )
    with pytest.raises(AssertionError) as e:
        check_word_caps(before, after)
    assert "c_003" in str(e.value)


# --- Corpus replay ------------------------------------------------------

def _replay(validator):
    """Run one validator over every run in the committed corpus.

    Run logs carry no after_state, so it is reconstructed the way issue #1972
    prescribes: the scenario fixture's conflicts overlaid with changed_fields.

    Both `modified` AND `added` are replayed. `added` matters more than its corpus
    count suggests: it is 0 of the 29 conflict diff entries across the committed run
    logs today, but a created-then-resolved conflict is exactly the V6 bypass
    `test_v6_creating_an_already_resolved_conflict_counts` pins, so a corpus that
    grows one would otherwise be replayed blind at the one path the validator was
    written for.

    Note the two carry DIFFERENT shapes (`harness/diff.py:_diff_array`): a
    `modified` entry is `{id, changed_fields}`, while an `added` entry is the whole
    after-state object. Treating them alike is the easy mistake here.
    """
    fired = []
    for path in _CORPUS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        for t in log.get("tests", []):
            fixture = _REPO / "eval/fixtures/scenarios" / str(t.get("scenario")) / "research.json"
            if not fixture.exists():
                continue
            base = json.loads(fixture.read_text(encoding="utf-8")).get("conflicts", [])
            for r in t.get("runs", []):
                diff = (((r.get("output") or {}).get("file_changes") or {})
                        .get("research.json") or {}).get("diff") or {}
                conflicts_diff = diff.get("conflicts") or {}
                modified = conflicts_diff.get("modified") or []
                added = conflicts_diff.get("added") or []
                if not modified and not added:
                    continue
                before = {"research_json": {"conflicts": base}}
                after_conflicts = [dict(c) for c in base]
                by_id = {c["id"]: c for c in after_conflicts}
                for m in modified:
                    entry = by_id.get(m.get("id"))
                    if entry is None:
                        continue
                    for field, change in (m.get("changed_fields") or {}).items():
                        entry[field] = change.get("after")
                # An `added` entry is the whole after-state object, so it is appended
                # rather than overlaid. Guard on id: a fixture that already carries the
                # id would otherwise be duplicated in the after state.
                for a in added:
                    if isinstance(a, dict) and a.get("id") not in by_id:
                        after_conflicts.append(dict(a))
                after = {"research_json": {"conflicts": after_conflicts}}
                try:
                    validator(before, after)
                except AssertionError as e:
                    fired.append((Path(path).name, t["test_id"], str(e)))
                except pytest.skip.Exception:
                    pass
    return fired


# --- second derivations, deliberately not sharing the validator's code -------
#
# These read each run's raw `changed_fields` and know nothing about
# `_conflicts_written` / `_analysis_written` / `_ANALYSIS_FIELDS`. That is the
# whole point: if the validator's dict access drifts from the run logs' actual
# structure, the two derivations disagree and the corpus tests go red — which is
# what the pinned literals used to buy, minus the rotation fragility.
#
# Field names are restated here on purpose rather than imported. Importing
# _ANALYSIS_FIELDS would make both sides share the one thing most likely to be
# wrong, and the per-field tests above are what keep this list honest.
_SECOND_DERIVATION_ANALYSIS_FIELDS = (
    "independence_analysis",
    "weighing_analysis",
    "preferred_assertion_id",
    "resolution_rationale",
    "status",
)


def _corpus_runs():
    """(log filename, test_id, conflicts-diff) for every run in the corpus."""
    for path in _CORPUS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        for t in log.get("tests", []):
            for r in t.get("runs", []):
                diff = (((r.get("output") or {}).get("file_changes") or {})
                        .get("research.json") or {}).get("diff") or {}
                yield Path(path).name, t["test_id"], (diff.get("conflicts") or {})


def _independently_multi_conflict_runs():
    """Runs whose diff writes an analysis field on MORE THAN ONE conflict.

    A created conflict counts when it arrives carrying analysis, matching V6's
    create-and-resolve arm.
    """
    out = set()
    for name, test_id, cdiff in _corpus_runs():
        touched = set()
        for m in cdiff.get("modified") or []:
            if any(
                f in (m.get("changed_fields") or {})
                for f in _SECOND_DERIVATION_ANALYSIS_FIELDS
            ):
                touched.add(m.get("id"))
        for a in cdiff.get("added") or []:
            if isinstance(a, dict) and any(
                a.get(f) for f in _SECOND_DERIVATION_ANALYSIS_FIELDS
            ):
                touched.add(a.get("id"))
        if len(touched) > 1:
            out.add((name, test_id))
    return out


def _independently_over_cap_counts():
    """(weighing, rationale) writes above their bands, derived from the diff.

    Mirrors V2's escape: a rationale on a conflict with three or more competing
    assertions is exempt, and `competing_assertion_ids` is read from the AFTER
    state — the scenario fixture overlaid with this run's changes — never from
    the diff, which is the 17-vs-32 regression the escape test pins.
    """
    weighing = rationale = 0
    for path in _CORPUS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        for t in log.get("tests", []):
            fixture = (
                _REPO / "eval/fixtures/scenarios" / str(t.get("scenario")) / "research.json"
            )
            base = (
                json.loads(fixture.read_text(encoding="utf-8")).get("conflicts", [])
                if fixture.exists()
                else []
            )
            by_id = {c["id"]: c for c in base if isinstance(c, dict) and "id" in c}
            for r in t.get("runs", []):
                cdiff = ((((r.get("output") or {}).get("file_changes") or {})
                          .get("research.json") or {}).get("diff") or {}
                         ).get("conflicts") or {}
                for m in (cdiff.get("modified") or []):
                    changed = m.get("changed_fields") or {}
                    entry = by_id.get(m.get("id")) or {}
                    if "weighing_analysis" in changed:
                        text = changed["weighing_analysis"].get("after") or ""
                        if len(str(text).split()) > 210:
                            weighing += 1
                    if "resolution_rationale" in changed:
                        text = changed["resolution_rationale"].get("after") or ""
                        competing = (
                            changed.get("competing_assertion_ids", {}).get("after")
                            if "competing_assertion_ids" in changed
                            else entry.get("competing_assertion_ids")
                        ) or []
                        if len(competing) < 3 and len(str(text).split()) > 300:
                            rationale += 1
    return weighing, rationale


@pytest.mark.skipif(not _CORPUS, reason="no committed conflict-resolution run logs")
def test_v6_agrees_with_a_second_derivation_over_the_corpus():
    """The validator's firing set must equal an INDEPENDENT derivation of the
    same property, read straight from each run's raw `changed_fields`.

    This used to pin two literal filenames, and #2149 deleted one of them —
    turning this PR's own acceptance check red for a corpus rotation nobody
    could have avoided. `versioning.DEFAULT_KEEP_CANDIDATES = 5` rotates this
    corpus on every paid run, so the next person to land a conflict-resolution
    run log would have inherited the same red in a file they never touched
    (@clack391).

    Agreement, not a count, is what survives rotation while still catching what
    the pinned version caught: the second derivation reads `changed_fields`
    directly and never calls the validator's own helpers, so a shape slip in
    `_conflicts_written` / `_analysis_written` — reading `conflict_entries`
    instead of `conflicts`, say — makes the two disagree.
    """
    fired = {(f, t) for f, t, _ in _replay(check_one_per_turn)}
    expected = _independently_multi_conflict_runs()
    assert fired == expected, (
        f"validator fired on {sorted(fired)} but a second derivation from raw "
        f"changed_fields says {sorted(expected)}"
    )


@pytest.mark.skipif(not _CORPUS, reason="no committed conflict-resolution run logs")
def test_v2_reports_the_measured_counts_on_the_corpus():
    """The validator's over-cap tallies must equal an independent derivation.

    Counts rather than filenames, but the same rotation problem and the same
    fix: derived here instead of pinned, so a paid run that adds a log does not
    redden a file nobody touched. The `splitlines` filter keeps only the
    validator's own `conflicts[...]` observation lines.
    """
    fired = _replay(check_word_caps)
    lines = [ln.strip() for _, _, msg in fired for ln in msg.splitlines()
             if ln.strip().startswith("conflicts[")]
    weighing = len([ln for ln in lines if "weighing_analysis" in ln])
    rationale = len([ln for ln in lines if "resolution_rationale" in ln])

    exp_weighing, exp_rationale = _independently_over_cap_counts()
    assert (weighing, rationale) == (exp_weighing, exp_rationale), (
        f"validator observed {weighing} weighing / {rationale} rationale "
        f"over-cap writes; a second derivation from raw changed_fields says "
        f"{exp_weighing} / {exp_rationale}"
    )


def test_v2_weighing_at_exactly_the_band_is_not_observed():
    """The band is a `>` comparison, so exactly 210 words must NOT fire. Flipping
    it to `>=` is otherwise undetectable — the nearest tests sit at 260 and above."""
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", weighing_analysis=_words(210))],
    )
    check_word_caps(before, after)


def test_v2_rationale_at_exactly_the_band_is_not_observed():
    """Same boundary on the other field: exactly 300 words must not fire."""
    before, after = _states(
        [_conflict("c_001")],
        [_conflict("c_001", resolution_rationale=_words(300))],
    )
    check_word_caps(before, after)


def test_v2_skips_when_either_side_lacks_research_json():
    """V6 had this guard tested; V2 had the same guard and did not.

    Each side is asserted SEPARATELY on purpose. Passing None for both leaves an
    `or` -> `and` typo undetected, because both-None satisfies either operator --
    measured: that mutation left the whole suite green until this was split.
    """
    good = {"research_json": {"conflicts": []}}
    with pytest.raises(pytest.skip.Exception):
        check_word_caps({"research_json": None}, good)
    with pytest.raises(pytest.skip.Exception):
        check_word_caps(good, {"research_json": None})


def test_v2_both_fields_over_cap_are_both_observed():
    """The validator loops the two fields independently and appends to
    `observations`. An accidental `elif` would report only the first, and no
    existing test puts both over the cap on one conflict."""
    before, after = _states(
        [_conflict("c_001")],
        [
            _conflict(
                "c_001",
                weighing_analysis=_words(400),
                resolution_rationale=_words(400),
            )
        ],
    )
    with pytest.raises(AssertionError) as e:
        check_word_caps(before, after)
    msg = str(e.value)
    assert "weighing_analysis" in msg, msg
    assert "resolution_rationale" in msg, msg


# --- _ANALYSIS_FIELDS: one test per field ------------------------------------
#
# Every synthetic V6 test above writes `status` and `resolution_rationale`
# together, and none writes the other three at all, so four of the five fields
# were asserted by nothing: dropping any of them left the suite at baseline
# (@clack391). A repaired corpus replay would not catch it either — the single
# corpus violation writes all five together. These are what make the field set
# the rule actually consists of, rather than a list nothing reads.


@pytest.mark.parametrize(
    "field, value",
    [
        ("independence_analysis", "the two records are independent"),
        ("weighing_analysis", "the parish register outweighs the index"),
        ("preferred_assertion_id", "a_009"),
        ("resolution_rationale", "preferred on originality"),
        ("status", "resolved"),
    ],
)
def test_each_analysis_field_alone_counts_as_a_resolution(field, value):
    """A conflict whose ONLY change is this field must count as touched, so two
    such conflicts in one turn must fail V6. Dropping the field from
    `_ANALYSIS_FIELDS` makes this parametrisation red."""
    before, after = _states(
        [_conflict("c_001"), _conflict("c_002")],
        [_conflict("c_001", **{field: value}), _conflict("c_002", **{field: value})],
    )
    with pytest.raises(AssertionError, match="more than one conflict"):
        check_one_per_turn(before, after)


@pytest.mark.parametrize(
    "field, value",
    [
        ("independence_analysis", "the two records are independent"),
        ("weighing_analysis", "the parish register outweighs the index"),
        ("preferred_assertion_id", "a_009"),
        ("resolution_rationale", "preferred on originality"),
        ("status", "resolved"),
    ],
)
def test_one_conflict_touched_by_this_field_alone_passes(field, value):
    """The positive control for the parametrisation above: one conflict changed
    by this field alone must NOT fail, so the test pair cannot pass by the
    validator simply firing on everything."""
    before, after = _states(
        [_conflict("c_001"), _conflict("c_002")],
        [_conflict("c_001", **{field: value}), _conflict("c_002")],
    )
    check_one_per_turn(before, after)


def test_v6_a_moot_status_counts_as_touching_the_conflict():
    """Pins the `moot` shape so the behaviour is CHOSEN, not inherited.

    SKILL.md tells the skill to set `status: "moot"` when other evidence makes a
    conflict irrelevant, and separately to leave the other conflicts' fields
    untouched that turn. In one turn those two can conflict, and there are zero
    `moot` writes in the corpus to have surfaced it (@clack391).

    V6 sides with one-conflict-per-turn: `status` is in `_ANALYSIS_FIELDS`, so
    mooting a second conflict counts as touching it. This test states that rather
    than leaving it to be discovered. Whether the DOCTRINE should change is a
    genealogist's call and belongs on #1972, not here.
    """
    before, after = _states(
        [_conflict("c_001"), _conflict("c_002")],
        [
            _conflict("c_001", status="resolved", resolution_rationale="preferred"),
            _conflict("c_002", status="moot"),
        ],
    )
    with pytest.raises(AssertionError, match="more than one conflict"):
        check_one_per_turn(before, after)


def test_v6_mooting_one_conflict_alone_passes():
    """The control: a turn that only moots is one conflict touched, so it passes.
    Without this the test above could pass on the validator firing at all."""
    before, after = _states(
        [_conflict("c_001"), _conflict("c_002")],
        [_conflict("c_001", status="moot"), _conflict("c_002")],
    )
    check_one_per_turn(before, after)
