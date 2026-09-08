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
# Resolved by getattr over BOTH tier spellings rather than the report_ name
# directly. A rename to `test_*` (i.e. promotion to gating) would otherwise
# AttributeError at import and break every test in this file with a message
# about a missing attribute; this way the rename produces one clean failure from
# `test_v3_is_tier_2_reporting_not_gating`, which explains what it means, while
# the rest still exercise the logic.
check_identity_first = getattr(
    _VALIDATOR,
    "report_resolution_precedes_identity",
    getattr(_VALIDATOR, "test_resolution_precedes_identity", None),
)

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
            fx = json.loads(fixture.read_text(encoding="utf-8"))
            base = fx.get("conflicts", [])
            # V3's shared-source arm joins competing_assertion_ids -> source_id,
            # so the replay has to carry assertions[] too. V6 and V2 never read
            # them, which is why this widens the shared helper instead of
            # forking it. Valid to take them from the FIXTURE unchanged: across
            # the committed logs `sections_modified` is ["conflicts"] on every
            # run, so no run altered assertions[].
            base_assertions = fx.get("assertions", [])
            for r in t.get("runs", []):
                diff = (((r.get("output") or {}).get("file_changes") or {})
                        .get("research.json") or {}).get("diff") or {}
                conflicts_diff = diff.get("conflicts") or {}
                modified = conflicts_diff.get("modified") or []
                added = conflicts_diff.get("added") or []
                if not modified and not added:
                    continue
                before = {"research_json": {"conflicts": base,
                                           "assertions": base_assertions}}
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
                after = {"research_json": {"conflicts": after_conflicts,
                                          "assertions": base_assertions}}
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


def _second_derivation_carries_analysis(entry: dict) -> bool:
    """Whether a conflict entry carries resolution work, stated as the RULE.

    Restated rather than imported, for the same reason as the field tuple above.
    The rule (SKILL.md's creation template) is that a freshly identified conflict
    has all five fields at null / "unresolved", so:

    - `status` counts only when it is something OTHER than null or "unresolved"
    - the four prose/id fields count when populated

    Bare truthiness is NOT the rule, and getting that wrong is what made this
    derivation disagree with the validator on a permitted turn: the creation
    template writes `"status": "unresolved"`, which is truthy, so every created
    conflict looked like a resolution and a run that resolved one conflict while
    identifying a new one reddened the corpus test (@clack391).
    """
    for f in _SECOND_DERIVATION_ANALYSIS_FIELDS:
        v = entry.get(f)
        if f == "status":
            if v not in (None, "unresolved"):
                return True
        elif v not in (None, "", [], {}):
            return True
    return False


def _independently_multi_conflict_runs():
    """Runs whose diff writes an analysis field on MORE THAN ONE conflict.

    A created conflict counts only when it ARRIVES carrying analysis — creating
    an empty conflict is identification, which V6 leaves unrestricted.
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
            if isinstance(a, dict) and _second_derivation_carries_analysis(a):
                touched.add(a.get("id"))
        if len(touched) > 1:
            out.add((name, test_id))
    return out


def _independently_over_cap_counts():
    """(weighing, rationale) writes above their bands, derived from the diff.

    Mirrors V2's population AND its escape: created conflicts count (V2 is wider
    than V6 by design), a rationale on a conflict with three or more competing
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
                # CREATED conflicts count too. V2's population
                # (`_conflicts_written`) is deliberately WIDER than V6's: a
                # conflict the run created carrying a 460-word rationale is
                # exactly what a word cap is for, and `_replay` appends `added`
                # entries to the after state, so the validator sees them. Reading
                # only `modified` here made the derivation blind to a population
                # the validator observes, which disagreed the moment a run
                # created a conflict with over-cap prose (@clack391).
                for a in (cdiff.get("added") or []):
                    if not isinstance(a, dict):
                        continue
                    if len(str(a.get("weighing_analysis") or "").split()) > 210:
                        weighing += 1
                    competing = a.get("competing_assertion_ids") or []
                    if (
                        len(competing) < 3
                        and len(str(a.get("resolution_rationale") or "").split()) > 300
                    ):
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


# --- the BEFORE state read ---------------------------------------------------
#
# `_conflicts_by_id(before)` had no coverage at all: making it return `{}`
# unconditionally, or breaking only the before-side of the
# `conflicts`/`conflict_entries` slip, left the suite at baseline (@clack391).
# The after-side half fails 14 tests; the before-side half failed nothing.
#
# It is not theoretical, and it is worse on a GATING validator. Re-derived:
# **32 of the 41 committed scenario conflicts ship `status: "resolved"` with all
# four analysis fields populated**, and one of those scenarios,
# `flynn-competing-fathers`, is in this skill's own corpus. With a broken
# before-reader every one of them looks new, `_analysis_written` returns True,
# and V6 fires on a run that touched exactly one conflict — failing the run and
# suppressing the judge at orchestrator.py:600.
#
# The corpus replay structurally cannot cover this: `_replay` skips runs with no
# conflicts diff, and every scenario it reaches starts with zero analysed
# conflicts. Nor could the synthetic tests above, since every `_states(...)` call
# used template defaults for the before side.


def _resolved(cid):
    """A conflict already carrying full analysis — the shape 32 of the 41
    committed scenario conflicts actually ship."""
    return _conflict(
        cid,
        status="resolved",
        independence_analysis="independent sources",
        weighing_analysis="the register outweighs the index",
        preferred_assertion_id="a_002",
        resolution_rationale="preferred on originality",
    )


def test_v6_ignores_a_conflict_that_was_already_resolved_before_the_run():
    """The before state is read, not assumed empty.

    One conflict arrives already resolved and is left alone; the run resolves a
    different one. That is exactly one conflict touched, so V6 must pass. A
    before-reader that returns nothing makes the pre-resolved conflict look
    newly created-and-resolved, counts two, and fails a permitted run.
    """
    before, after = _states(
        [_resolved("c_001"), _conflict("c_002")],
        [_resolved("c_001"), _conflict("c_002", status="resolved",
                                       resolution_rationale="preferred")],
    )
    check_one_per_turn(before, after)


def test_v6_still_fires_when_both_were_already_resolved_and_both_change():
    """The control, so the test above cannot pass by V6 never firing on a
    before state that carries analysis."""
    before, after = _states(
        [_resolved("c_001"), _resolved("c_002")],
        [
            _resolved("c_001") | {"resolution_rationale": "rewritten one"},
            _resolved("c_002") | {"resolution_rationale": "rewritten two"},
        ],
    )
    with pytest.raises(AssertionError, match="more than one conflict"):
        check_one_per_turn(before, after)


# --- V3: no resolution while an open identity conflict covers it -------------
#
# The rule has TWO arms and they are not of equal standing (see the validator's
# own comment): arm B (shared source) is the deep dive's heuristic and carries
# the signal; arm A (shared blocked question) is #1823 step 2's ruled definition
# transposed to conflict->conflict, and its sole extra hit on the current corpus
# is one identity<->identity pair. Each arm is pinned separately below, because
# a single fixture that satisfies both would let either one rot silently.


def _v3_states(before_conflicts, after_conflicts, assertions):
    return (
        {"research_json": {"conflicts": before_conflicts, "assertions": assertions}},
        {"research_json": {"conflicts": after_conflicts, "assertions": assertions}},
    )


def _assertions(**id_to_source):
    return [{"id": i, "source_id": s} for i, s in id_to_source.items()]


# Two sources, no overlap between the fact conflict and the identity conflict
# unless a test arranges it.
_A = _assertions(a_001="src_001", a_002="src_001", a_009="src_003", a_014="src_005")


def _resolved(cid, **kw):
    kw.setdefault("status", "resolved")
    kw.setdefault("resolution_rationale", "x")
    return _conflict(cid, **kw)


def test_v3_clean_when_the_identity_conflict_is_unrelated():
    """Neither arm: no shared blocked question, no shared source."""
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]),
         _conflict("c_002", conflict_type="identity", competing_assertion_ids=["a_014"])],
        [_resolved("c_001", competing_assertion_ids=["a_002"]),
         _conflict("c_002", conflict_type="identity", competing_assertion_ids=["a_014"])],
        _A,
    )
    check_identity_first(before, after)


def test_v3_fires_on_arm_B_alone_shared_source():
    """The deep dive's own worked shape: c_001 resolved on a_002 (src_001) while
    an identity conflict disputes a_001 (also src_001). No blocked question on
    either, so arm A cannot be what fired."""
    ident = _conflict("c_002", conflict_type="identity", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_resolved("c_001", competing_assertion_ids=["a_002"]), ident],
        _A,
    )
    with pytest.raises(AssertionError) as e:
        check_identity_first(before, after)
    msg = str(e.value)
    assert "c_001" in msg and "c_002" in msg
    assert "B:shared source" in msg and "src_001" in msg
    assert "A:shared blocked question" not in msg, f"arm A fired too: {msg}"


def test_v3_fires_on_arm_A_alone_shared_blocked_question():
    """#1823 step 2's ruled definition. Sources deliberately disjoint, so arm B
    cannot be what fired — this is the arm that would vanish if someone
    'simplified' the rule back to the deep dive's heuristic alone."""
    ident = _conflict("c_002", conflict_type="identity",
                      competing_assertion_ids=["a_014"], blocks_question_ids=["q_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"], blocks_question_ids=["q_001"]),
         ident],
        [_resolved("c_001", competing_assertion_ids=["a_002"], blocks_question_ids=["q_001"]),
         ident],
        _A,
    )
    with pytest.raises(AssertionError) as e:
        check_identity_first(before, after)
    msg = str(e.value)
    assert "A:shared blocked question" in msg
    assert "B:shared source" not in msg, f"arm B fired too: {msg}"


def test_v3_fires_with_no_preferred_assertion_id():
    """The case the dropped narrowing was blind on.

    An earlier draft keyed the join on the source of `preferred_assertion_id`.
    That is schema-legal to omit on a resolved conflict (research.schema.json
    does not require it, and validator.ts adds no requirement), and 11 of 52
    resolved conflicts in the committed e2e corpus are in exactly this shape —
    so the narrow form could not see any of them.
    """
    ident = _conflict("c_002", conflict_type="identity", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_resolved("c_001", competing_assertion_ids=["a_002"],
                   preferred_assertion_id=None), ident],
        _A,
    )
    with pytest.raises(AssertionError):
        check_identity_first(before, after)


@pytest.mark.parametrize("status", ["resolved", "moot"])
def test_v3_clean_when_the_identity_conflict_is_no_longer_open(status):
    """Only an UNRESOLVED identity conflict blocks. `moot` is a real enum value
    (enums.schema.json $defs.conflict_status), not a placeholder."""
    ident = _conflict("c_002", conflict_type="identity",
                      competing_assertion_ids=["a_001"], status=status)
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_resolved("c_001", competing_assertion_ids=["a_002"]), ident],
        _A,
    )
    check_identity_first(before, after)


def test_v3_clean_when_the_related_conflict_is_not_an_identity_conflict():
    """A shared source with another open FACT conflict is ordinary and common —
    firing on it would flag most multi-conflict scenarios."""
    other = _conflict("c_002", conflict_type="fact", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), other],
        [_resolved("c_001", competing_assertion_ids=["a_002"]), other],
        _A,
    )
    check_identity_first(before, after)


def test_v3_clean_when_the_run_wrote_moot_instead_of_resolved():
    """The spec's stated correct behaviour: 'if the identity resolves the other
    way the entry is moot, not resolved'. A run that does the right thing must
    not be flagged for it."""
    ident = _conflict("c_002", conflict_type="identity", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_conflict("c_001", competing_assertion_ids=["a_002"], status="moot",
                   resolution_rationale="deferred to the identity question"), ident],
        _A,
    )
    check_identity_first(before, after)


def test_v3_clean_when_the_violation_is_preexisting_and_untouched():
    """Population is entries this run RESOLVED, not the whole after-state.

    Whole-state scanning would report a fixture's own defect as this run's
    doing. Unreachable on today's fixtures — the only two shared-source
    conflicts across all 95 start `unresolved` — but the next fixture edit
    would decide it silently, so it is pinned rather than left to luck.
    """
    ident = _conflict("c_002", conflict_type="identity", competing_assertion_ids=["a_001"])
    stale = _resolved("c_001", competing_assertion_ids=["a_002"])
    # Identical in both states: this run touched nothing.
    before, after = _v3_states([stale, ident], [dict(stale), ident], _A)
    check_identity_first(before, after)


def test_v3_a_dangling_competing_assertion_id_does_not_raise():
    """Load-bearing, not defensive tidiness. `validator_runner.py:244-256`
    deliberately does NOT mark an exception `reporting_only`, so a crash inside
    a report_* function GATES and suppresses the judge — the precise outcome
    tier 2 exists to avoid. `validator.ts` runs no `checkRefExists` on
    `competing_assertion_ids`, so a dangling id is reachable."""
    ident = _conflict("c_002", conflict_type="identity",
                      competing_assertion_ids=["a_999_missing"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_404_missing"]), ident],
        [_resolved("c_001", competing_assertion_ids=["a_404_missing"]), ident],
        _A,
    )
    check_identity_first(before, after)  # must not raise, and must not fire


def test_v3_a_conflict_is_not_related_to_itself():
    """An unresolved identity conflict cannot block its own resolution: if it is
    `unresolved` it is not in the resolved population, and self-pairing would
    otherwise make any resolved identity conflict flag itself."""
    before, after = _v3_states(
        [_conflict("c_001", conflict_type="identity", competing_assertion_ids=["a_001"],
                   blocks_question_ids=["q_001"])],
        [_resolved("c_001", conflict_type="identity", competing_assertion_ids=["a_001"],
                   blocks_question_ids=["q_001"])],
        _A,
    )
    check_identity_first(before, after)


def test_v3_clean_when_no_identity_conflict_is_open_at_all():
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"])],
        [_resolved("c_001", competing_assertion_ids=["a_002"])],
        _A,
    )
    check_identity_first(before, after)


def test_v3_skips_when_either_side_lacks_research_json():
    with pytest.raises(pytest.skip.Exception):
        check_identity_first({"research_json": None}, {"research_json": {}})


def test_v3_message_says_the_check_cannot_read_the_acknowledgement():
    """The rubric's harm is resolving over an identity conflict *without saying
    so*, and that half is prose. A message that read as a verdict would send a
    genealogist to fail a run that correctly caveated the dependency —
    `ut_006`'s own judge_context blesses resolve-with-caveat."""
    ident = _conflict("c_002", conflict_type="identity", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_resolved("c_001", competing_assertion_ids=["a_002"]), ident],
        _A,
    )
    with pytest.raises(AssertionError) as e:
        check_identity_first(before, after)
    assert "cannot read" in str(e.value)


def test_v3_is_tier_2_reporting_not_gating():
    """The tier is carried by the function-name PREFIX and nothing else
    (`validator_runner.py` branches on `startswith("report_")`), so a rename
    flips gating on silently. Gating would suppress the judge
    (orchestrator.py:607) on runs that do produce signal on other dimensions —
    Correctness 2, Source independence analysis 2, Tool Arguments 2."""
    assert hasattr(_VALIDATOR, "report_resolution_precedes_identity")
    assert not hasattr(_VALIDATOR, "test_resolution_precedes_identity"), (
        "V3 was promoted to a gating test_* function; that is a lead decision "
        "and it suppresses the LLM judge on every run it fires"
    )


# --- V3 over the committed corpus -------------------------------------------
#
# Same contract as the V6/V2 corpus tests above: a SECOND DERIVATION that shares
# none of the validator's code, so a drift between the validator's dict access
# and the run logs' real structure makes the two disagree. Deliberately no
# pinned hit count — candidate retention keeps 5 logs per skill, so a literal
# rots on its own.


_V3_ANALYSIS_FIELDS = (
    "independence_analysis",
    "weighing_analysis",
    "preferred_assertion_id",
    "resolution_rationale",
    "status",
)


def _independently_v3_hits():
    """Re-derive V3's hits from raw `changed_fields`, knowing nothing about
    `_relation_arms`, `_sources_for`, `_conflicts_with_changed_analysis` or
    `_source_of`. Field names restated rather than imported, for the reason the
    V6/V2 second derivations give: importing them would make both sides share
    the thing most likely to be wrong."""
    hits = set()
    for path in _CORPUS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        for t in log.get("tests", []):
            fixture = (_REPO / "eval/fixtures/scenarios"
                       / str(t.get("scenario")) / "research.json")
            if not fixture.exists():
                continue
            fx = json.loads(fixture.read_text(encoding="utf-8"))
            src = {a.get("id"): a.get("source_id") for a in fx.get("assertions") or []}
            start = {c.get("id"): c for c in fx.get("conflicts") or []}

            for r in t.get("runs", []):
                cd = ((((r.get("output") or {}).get("file_changes") or {})
                       .get("research.json") or {}).get("diff") or {}).get("conflicts") or {}
                after = {k: dict(v) for k, v in start.items()}
                touched = set()
                for m in cd.get("modified") or []:
                    cid = m.get("id")
                    if cid is None:
                        continue
                    entry = after.setdefault(cid, {"id": cid})
                    for f, ch in (m.get("changed_fields") or {}).items():
                        if f in _V3_ANALYSIS_FIELDS:
                            touched.add(cid)
                        entry[f] = ch.get("after")
                for a in cd.get("added") or []:
                    if not isinstance(a, dict) or not a.get("id"):
                        continue
                    after[a["id"]] = dict(a)
                    if any(a.get(f) not in (None, "", [], {}, "unresolved")
                           for f in _V3_ANALYSIS_FIELDS):
                        touched.add(a["id"])

                openi = [c for c in after.values()
                         if c.get("status") == "unresolved"
                         and c.get("conflict_type") == "identity"]
                for cid in touched:
                    c = after.get(cid) or {}
                    if c.get("status") != "resolved":
                        continue
                    csrc = {src.get(x) for x in (c.get("competing_assertion_ids") or [])}
                    csrc.discard(None)
                    cq = set(c.get("blocks_question_ids") or [])
                    for other in openi:
                        oid = other.get("id")
                        if not oid or oid == cid:
                            continue
                        osrc = {src.get(x) for x in (other.get("competing_assertion_ids") or [])}
                        osrc.discard(None)
                        if (cq and cq & set(other.get("blocks_question_ids") or [])) or (csrc & osrc):
                            hits.add((Path(path).name, t["test_id"]))
    return hits


def test_v3_agrees_with_a_second_derivation_over_the_corpus():
    fired = {(name, tid) for name, tid, _ in _replay(check_identity_first)}
    independent = _independently_v3_hits()

    assert independent, (
        "the second derivation found nothing, so this test cannot detect a "
        "validator that fires on nothing — has the corpus rotated away every "
        "flynn-identity-geographic run?"
    )
    assert fired == independent, (
        "V3 and an independent re-derivation disagree over the committed "
        f"corpus.\n  validator only: {sorted(fired - independent)}\n"
        f"  derivation only: {sorted(independent - fired)}"
    )


def test_v3_fires_only_where_an_identity_conflict_is_actually_open():
    """A cheap sanity arm on the corpus result: every run V3 flags must come
    from a scenario that HAS an open identity conflict. Catches a validator that
    fires on the wrong population without needing a pinned count."""
    with_identity = set()
    for d in (_REPO / "eval/fixtures/scenarios").iterdir():
        f = d / "research.json"
        if not f.is_file():
            continue
        try:
            fx = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if any(c.get("conflict_type") == "identity" for c in fx.get("conflicts") or []):
            with_identity.add(d.name)

    scenarios = set()
    for path in _CORPUS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        by_id = {t["test_id"]: t.get("scenario") for t in log.get("tests", [])}
        for name, tid, _ in _replay(check_identity_first):
            if name == Path(path).name and tid in by_id:
                scenarios.add(by_id[tid])

    assert scenarios, "V3 fired on nothing in the corpus; the arms may be dead"
    assert scenarios <= with_identity, (
        f"V3 fired on scenarios with no identity conflict: {sorted(scenarios - with_identity)}"
    )


def test_v3_a_non_dict_conflict_entry_does_not_raise():
    """Paired with the dangling-id test, for the same reason: a crash inside a
    report_* function gates and suppresses the judge, so malformed state must
    degrade to "no observation" rather than to an exception."""
    ident = _conflict("c_002", conflict_type="identity", competing_assertion_ids=["a_001"])
    before = {"research_json": {"conflicts": [_conflict("c_001"), ident], "assertions": _A}}
    after = {"research_json": {"conflicts": ["not a dict", None, ident], "assertions": _A}}
    check_identity_first(before, after)
