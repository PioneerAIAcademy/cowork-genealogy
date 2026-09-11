"""Direct tests for the V6, V2 and V3 conflict-resolution validators (issue #1972).

Same reason as `test_proof_conclusion_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise appear
only inside a paid per-skill run.

The corpus tests replay every committed run log through each validator (4 logs as
of 2026-09-08; candidate retention keeps 5 per skill, so re-derive rather than
quote).
Synthetic dicts prove the branch logic and an independent second derivation proves
the rule's arithmetic, but neither asserts the validators fire on the real data — a
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
# suppressing the judge at orchestrator.py:607.
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
# ONE arm: a shared `source_id`. A second arm (an intersection of
# `blocks_question_ids`, transposing #1823 step 2's ruling) shipped in the first
# revision and was withdrawn under review — it could not discriminate on any
# committed fixture, attached 8 spurious pair-observations to the 7 real ones
# (15 in all across 8 runs),
# and its "shared" semantics was pinned by no test (`&` -> `|` left the suite
# green, while the same mutation on the source arm reds two tests below). The
# validator's own comment carries the measurements.
#
# Scope is `conflict_type: "fact"` on the resolved side, per #1972's V3 heading.


def _v3_states(before_conflicts, after_conflicts, assertions):
    return (
        {"research_json": {"conflicts": before_conflicts, "assertions": assertions}},
        {"research_json": {"conflicts": after_conflicts, "assertions": assertions}},
    )


def _assertions(**id_to_source):
    return [{"id": i, "source_id": s} for i, s in id_to_source.items()]


_A = _assertions(a_001="src_001", a_002="src_001", a_009="src_003", a_014="src_005")


def _v3_resolved(cid, **kw):
    """V3's own resolved-conflict builder.

    NOT named `_resolved`: a helper of that name already exists above for V6,
    and Python binds at call time, so defining a second one silently rebound
    V6's six invocations to this shape — dropping the full analysis fields whose
    presence is the stated premise of
    `test_v6_still_fires_when_both_were_already_resolved_and_both_change`. Both
    V6 tests still passed, which is why review caught it and the suite did not.
    `ruff` cannot: F811 flags redefinition of an *unused* name, and `_resolved`
    is used between the two definitions.
    """
    kw.setdefault("status", "resolved")
    kw.setdefault("resolution_rationale", "x")
    kw.setdefault("conflict_type", "fact")
    return _conflict(cid, **kw)


def _identity(cid, **kw):
    kw.setdefault("conflict_type", "identity")
    kw.setdefault("status", "unresolved")
    return _conflict(cid, **kw)


def test_v3_clean_when_the_identity_conflict_shares_no_source():
    """Both sides carry sources, and they are disjoint.

    Deliberately not "neither side has sources": with sources present on both,
    swapping the arm's `&` for `|` makes this fire, so this test is what pins
    the intersection semantics. An empty-vs-empty fixture would leave that
    mutation green — which is precisely how the withdrawn second arm went
    unpinned.
    """
    ident = _identity("c_002", competing_assertion_ids=["a_014"])  # src_005
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_v3_resolved("c_001", competing_assertion_ids=["a_002"]), ident],  # src_001
        _A,
    )
    check_identity_first(before, after)


def test_v3_fires_on_a_shared_source():
    """The deep dive's worked shape: c_001 resolved on a_002 (src_001) while an
    identity conflict disputes a_001 (also src_001)."""
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_v3_resolved("c_001", competing_assertion_ids=["a_002"]), ident],
        _A,
    )
    with pytest.raises(AssertionError) as e:
        check_identity_first(before, after)
    msg = str(e.value)
    assert "c_001" in msg and "c_002" in msg
    assert "src_001" in msg, f"the shared source is the evidence; name it: {msg}"


def test_v3_does_not_fire_when_the_resolved_conflict_is_not_a_fact_conflict():
    """The scope gate, and it is not cosmetic.

    Precisely, because this docstring used to contradict the validator's: with
    the gate replaced by `if False:` the SHIPPED arm reports the identical 7
    runs, so on the shipped arm the gate is a measured no-op. What it prevented
    was the WITHDRAWN blocked-question arm firing on
    ut_conflict_resolution_005, whose own prompt says "Analyze the geographic
    identity conflict c_003 and resolve it". It is kept for scope, because
    #1972's V3 heading scopes the rule to a `resolved` FACT conflict.
    """
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_identity("c_003", competing_assertion_ids=["a_002"]), ident],
        [_v3_resolved("c_003", conflict_type="identity",
                      competing_assertion_ids=["a_002"]), ident],
        _A,
    )
    check_identity_first(before, after)


def test_v3_reports_a_real_pair_that_happens_to_share_a_conflict_id():
    """Two DISTINCT conflicts that collide on an id are still a real violation.

    A previous revision carried an `oid == cid` guard here and asserted silence,
    on the reasoning that the pair was "c_001 against itself". It is not: these
    are two separate entries — one open identity on `a_001`, one resolved fact on
    `a_002` — sharing `src_001`. That is precisely what this check exists to
    report, and comparing ids suppressed it.

    Reachability is what made the id-comparing form harmful rather than safe: it
    could only ever fire on a state where a real violation exists, so every case
    it caught was a true positive being silenced.

    Self-pairing would need object identity, and that can never occur —
    `_resolutions_this_run` requires `status == "resolved"` while the
    open-identity filter requires `"unresolved"` on the same after-state list, so
    no single entry is in both. Measured overlap: 0.

    Not live coverage: `nextResearchId` mints ids as max+1, so no tool can write
    a duplicate `conflicts[].id`; the state is reachable only by hand or fixture
    edit. Kept because the id-comparing guard would have been wrong even so, and
    because the message must stay readable when ids collide — hence the indices.
    """
    dup_open = _identity("c_001", competing_assertion_ids=["a_001"])
    dup_resolved = _v3_resolved("c_001", competing_assertion_ids=["a_002"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), dup_open],
        [dup_resolved, dup_open],
        _A,
    )
    with pytest.raises(AssertionError) as e:
        check_identity_first(before, after)
    msg = str(e.value)
    assert "src_001" in msg
    # ORDER-SENSITIVE. `"index 0" in msg and "index 1" in msg` is order-blind —
    # swapping the two values left the whole suite green, and telling the two
    # same-id entries apart is the only thing the indices are for. The resolved
    # entry is at array position 0 and the open identity at 1, so the message
    # must say so in that order.
    assert "(a fact conflict, index 0)" in msg, msg
    assert "conflicts[c_001] (index 1) is an unresolved identity" in msg, msg


def test_v3_ignores_a_prose_only_edit_to_an_already_resolved_conflict():
    """Population is conflicts whose STATUS this run moved to `resolved`.

    Under V6's wider `_conflicts_with_changed_analysis` — any change to the five
    analysis fields, prose included — a run that only fixed a typo in the
    rationale of an already-resolved conflict was reported as having "written
    status='resolved'", which is simply false. Caught in review.
    """
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    resolved_before = _v3_resolved("c_001", competing_assertion_ids=["a_002"],
                                   resolution_rationale="teh evidence favours Ireland")
    resolved_after = _v3_resolved("c_001", competing_assertion_ids=["a_002"],
                                  resolution_rationale="the evidence favours Ireland")
    before, after = _v3_states([resolved_before, ident], [resolved_after, ident], _A)
    check_identity_first(before, after)


@pytest.mark.parametrize(
    "label,before_kw,after_kw",
    [
        ("competing reordered, same members",
         dict(competing_assertion_ids=["a_002", "a_009"]),
         dict(competing_assertion_ids=["a_009", "a_002"])),
        ("preferred changed, competing unchanged",
         dict(competing_assertion_ids=["a_002"], preferred_assertion_id="a_002"),
         dict(competing_assertion_ids=["a_002"], preferred_assertion_id=None)),
        ("an UNDISPUTED id added",
         dict(competing_assertion_ids=["a_002"]),
         dict(competing_assertion_ids=["a_002", "a_009"])),
        ("an id removed",
         dict(competing_assertion_ids=["a_002", "a_009"]),
         dict(competing_assertion_ids=["a_002"])),
    ],
)
def test_v3_does_not_report_an_edit_to_an_ALREADY_resolved_conflict(
    label, before_kw, after_kw
):
    """The withdrawn `repoint` arm, pinned so it is not re-proposed a third time.

    An arm shipped for one revision that reported a conflict `resolved` in both
    states whose `preferred_assertion_id` or `competing_assertion_ids` this run
    changed. Two reasons it is gone, and the first is that it had no evidence:
    the shape needs a conflict already `resolved` in the BEFORE state, and 0 of
    the 136 e2e starting states ship any conflict at all, let alone a resolved
    one. The round-2 figure that justified it ("4 of 161 e2e final states") was
    measured wrongly; those 4 are the create-and-resolve path the transition arm
    already covers.

    The second is that it was defective. Each case below FIRED under it, and in
    every one the shared source pre-existed the run — so it attributed a
    pre-existing violation to this turn, which is exactly what the population
    exists to prevent. On the reorder case the message's literal claim
    ("repointed onto different evidence") was also false.
    """
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_v3_resolved("c_001", **before_kw), ident],
        [_v3_resolved("c_001", **after_kw), ident],
        _A,
    )
    check_identity_first(before, after)

    # Paired, so this cannot pass on the check being inert: the same conflict
    # moved INTO `resolved` this turn is still reported.
    with pytest.raises(AssertionError):
        check_identity_first(*_v3_states(
            [_conflict("c_001", **after_kw), ident],
            [_v3_resolved("c_001", **after_kw), ident],
            _A,
        ))


def test_v3_fires_when_a_conflict_arrives_already_resolved():
    """Polarity for the population above: create-and-resolve must still count,
    or the narrower population becomes a bypass."""
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [ident],
        [_v3_resolved("c_009", competing_assertion_ids=["a_002"]), ident],
        _A,
    )
    with pytest.raises(AssertionError):
        check_identity_first(before, after)


def test_v3_fires_with_no_preferred_assertion_id():
    """The case the plan-stage narrowing was blind on.

    An earlier draft keyed the join on the source of `preferred_assertion_id`.
    That is schema-legal to omit on a resolved conflict, and 11 of 53 resolved
    conflicts in the committed e2e corpus are in exactly that shape.
    """
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_v3_resolved("c_001", competing_assertion_ids=["a_002"],
                      preferred_assertion_id=None), ident],
        _A,
    )
    with pytest.raises(AssertionError):
        check_identity_first(before, after)


@pytest.mark.parametrize("status", ["resolved", "moot"])
def test_v3_clean_when_the_identity_conflict_is_no_longer_open(status):
    """Only an UNRESOLVED identity conflict blocks. `moot` is a real enum value
    (enums.schema.json $defs.conflict_status), not a placeholder."""
    ident = _identity("c_002", competing_assertion_ids=["a_001"], status=status)
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_v3_resolved("c_001", competing_assertion_ids=["a_002"]), ident],
        _A,
    )
    check_identity_first(before, after)


def test_v3_clean_when_the_related_conflict_is_not_an_identity_conflict():
    """A shared source with another open FACT conflict is ordinary and common —
    firing on it would flag most multi-conflict scenarios."""
    other = _conflict("c_002", conflict_type="fact", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), other],
        [_v3_resolved("c_001", competing_assertion_ids=["a_002"]), other],
        _A,
    )
    check_identity_first(before, after)


def test_v3_clean_when_the_run_wrote_moot_instead_of_resolved():
    """The spec's stated correct behaviour: 'if the identity resolves the other
    way the entry is moot, not resolved'. A run that does the right thing must
    not be flagged for it."""
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        # `conflict_type="fact"` is load-bearing. Without it the `fact` scope
        # gate excluded the entry whatever its status, so the test passed on the
        # missing field rather than on `moot` — measured as a 4-cell matrix in
        # which `(resolved, no conflict_type)`, the VIOLATING value, also passed.
        [_conflict("c_001", competing_assertion_ids=["a_002"], status="moot",
                   conflict_type="fact",
                   resolution_rationale="deferred to the identity question"), ident],
        _A,
    )
    check_identity_first(before, after)


def test_v3_clean_when_the_violation_is_preexisting_and_untouched():
    """Whole-state scanning would report a fixture's own defect as this run's."""
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    stale = _v3_resolved("c_001", competing_assertion_ids=["a_002"])
    before, after = _v3_states([stale, ident], [dict(stale), ident], _A)
    check_identity_first(before, after)


@pytest.mark.parametrize(
    "competing",
    [
        42,               # int: `.get` on it is fine, but iterating raises TypeError
        {"a_002": 1},     # dict: iterates KEYS, so it reports iff they match ids
        "a_002",          # bare string: iterates CHARACTERS — silently wrong, never raises
    ],
)
def test_v3_a_non_list_competing_assertion_ids_neither_raises_nor_misreports(competing):
    """`_sources_for`'s `isinstance(ids, list)` guard, which nothing pinned.

    Narrowed to the shapes that are actually reachable: `validator.ts` requires
    `competing_assertion_ids`, so absent and null are rejected at the write
    boundary, but it does not type-check the value. The three it accepts are
    above, and the bare string is the dangerous one — it neither raises nor
    reports, it iterates to characters and yields a confidently wrong answer.
    """
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=competing), ident],
        [_v3_resolved("c_001", competing_assertion_ids=competing), ident],
        _A,
    )
    check_identity_first(before, after)


@pytest.mark.parametrize(
    "assertions",
    [
        [None],
        ["a_001"],
        [{"id": "a_001", "source_id": ["src_001"]}],
        [{"no_id": True}],
        None,
    ],
)
def test_v3_malformed_assertions_do_not_raise(assertions):
    """`assertions` is the dependency V3 introduces, so it is the one that most
    needs the guard. Each shape below raised before review: `[None]` and a bare
    string on `.get`, a list-valued `source_id` as an unhashable set member.

    A raise inside a `report_*` GATES — validator_runner.py's crash path
    withholds `reporting_only` on purpose — which suppresses the LLM judge for
    that run, the outcome tier 2 is chosen to avoid.
    """
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_v3_resolved("c_001", competing_assertion_ids=["a_002"]), ident],
        assertions,
    )
    check_identity_first(before, after)


def test_v3_a_dangling_competing_assertion_id_does_not_raise():
    """`validator.ts` runs no `checkRefExists` on `competing_assertion_ids`, so
    a dangling id is reachable, and the crash consequence above applies."""
    ident = _identity("c_002", competing_assertion_ids=["a_999_missing"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_404_missing"]), ident],
        [_v3_resolved("c_001", competing_assertion_ids=["a_404_missing"]), ident],
        _A,
    )
    check_identity_first(before, after)


def test_v3_clean_when_no_identity_conflict_is_open_at_all():
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"])],
        [_v3_resolved("c_001", competing_assertion_ids=["a_002"])],
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
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=["a_002"]), ident],
        [_v3_resolved("c_001", competing_assertion_ids=["a_002"]), ident],
        _A,
    )
    with pytest.raises(AssertionError) as e:
        check_identity_first(before, after)
    assert "cannot read" in str(e.value)


def test_v3_is_tier_2_reporting_not_gating():
    """The tier is carried by the function-name PREFIX and nothing else
    (`validator_runner.py` branches on `startswith("report_")`), so a rename
    flips gating on silently. Gating would suppress the judge
    (orchestrator.py:607) on runs that do produce signal on other dimensions."""
    assert hasattr(_VALIDATOR, "report_resolution_precedes_identity")
    assert not hasattr(_VALIDATOR, "test_resolution_precedes_identity"), (
        "V3 was promoted to a gating test_* function; that is a lead decision "
        "and it suppresses the LLM judge on every run it fires"
    )


# --- V3 over the committed corpus -------------------------------------------
#
# Same contract as the V6/V2 corpus tests above: a SECOND DERIVATION sharing
# none of the validator's code, so a drift between the validator's dict access
# and the run logs' real structure makes the two disagree. No pinned hit count —
# candidate retention keeps 5 logs per skill, so a literal rots.


def _independently_v3_hits():
    """Re-derive V3's hits from raw `changed_fields`, knowing nothing about
    `_sources_for`, `_resolutions_this_run`, `_source_of` or
    `_conflict_entries`."""
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
                became_resolved = set()
                for m in cd.get("modified") or []:
                    cid = m.get("id")
                    if cid is None:
                        continue
                    entry = after.setdefault(cid, {"id": cid})
                    fields = m.get("changed_fields") or {}
                    for f, ch in fields.items():
                        entry[f] = ch.get("after")
                    # Only a STATUS transition into resolved counts.
                    if (fields.get("status") or {}).get("after") == "resolved":
                        became_resolved.add(cid)
                for a in cd.get("added") or []:
                    if not isinstance(a, dict) or not a.get("id"):
                        continue
                    after[a["id"]] = dict(a)
                    if a.get("status") == "resolved":
                        became_resolved.add(a["id"])

                openi = [c for c in after.values()
                         if c.get("status") == "unresolved"
                         and c.get("conflict_type") == "identity"]
                for cid in became_resolved:
                    c = after.get(cid) or {}
                    if c.get("conflict_type") != "fact":
                        continue
                    csrc = {src.get(x) for x in (c.get("competing_assertion_ids") or [])}
                    csrc.discard(None)
                    for other in openi:
                        oid = other.get("id")
                        if not oid or oid == cid:
                            continue
                        osrc = {src.get(x)
                                for x in (other.get("competing_assertion_ids") or [])}
                        osrc.discard(None)
                        if csrc & osrc:
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


def test_v3_reports_one_pair_per_flagged_run_not_a_fan_out():
    """The withdrawn second arm attached 8 spurious pair-observations to the 7
    real ones, 15 in all across 8 runs — an unrelated (c_001, c_003) pair on 7 of
    those 8, plus one identity<->identity pair — and the run-level count hid it,
    because a run already flagged for a real pair stays "1 run" however many
    extra pairs are appended to its message.

    So this asserts at OBSERVATION level, which is what a genealogist reads.
    """
    fired = _replay(check_identity_first)
    assert fired, "V3 fired on nothing in the corpus; the arm may be dead"
    for name, tid, msg in fired:
        pairs = msg.count("was moved to status='resolved' while")
        assert pairs == 1, (
            f"{name}/{tid} reports {pairs} pairs in one observation; a fan-out "
            f"buries the real finding:\n{msg}"
        )


def test_v3_a_non_dict_conflict_entry_does_not_raise():
    """Paired with the malformed-assertions cases: a crash inside a report_*
    gates and suppresses the judge, so malformed state must degrade to "no
    observation" rather than to an exception."""
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before = {"research_json": {"conflicts": [_conflict("c_001"), ident],
                                "assertions": _A}}
    after = {"research_json": {"conflicts": ["not a dict", None, ident],
                               "assertions": _A}}
    check_identity_first(before, after)


def test_v3_the_printed_index_is_the_array_position_not_the_filtered_one():
    """With a malformed entry first, the index must still point at the right row.

    Enumerating the dict-filtered view printed 0 and 1 where the array positions
    are 1 and 2 — wrong in exactly the malformed state that makes indices
    necessary in the first place.
    """
    dup_open = _identity("c_001", competing_assertion_ids=["a_001"])
    dup_resolved = _v3_resolved("c_001", competing_assertion_ids=["a_002"])
    before = {"research_json": {"conflicts": [_conflict("c_001",
                                competing_assertion_ids=["a_002"]), dup_open],
                                "assertions": _A}}
    after = {"research_json": {"conflicts": ["not a dict", dup_resolved, dup_open],
                               "assertions": _A}}
    with pytest.raises(AssertionError) as e:
        check_identity_first(before, after)
    msg = str(e.value)
    assert "index 1" in msg and "index 2" in msg, msg
    assert "index 0" not in msg, f"index 0 is the non-dict entry: {msg}"


@pytest.mark.parametrize("competing", [42, "a_002", {"a_002": 1}, None])
def test_v2_does_not_crash_on_a_non_list_competing_assertion_ids(competing):
    """The round-3 blocker, and it is V2's exposure rather than V3's.

    `report_resolution_word_caps` evaluated `len(competing) < 3`, so a non-list
    raised `TypeError` — and a crash inside a `report_*` GATES the run and
    suppresses the LLM judge, the one outcome the tier-2 design exists to
    prevent. It needed only a NON-EMPTY rationale, not an over-cap one, because
    `len(competing) < 3` is evaluated before the word count in the same
    left-to-right `and`.

    Reachable through a normal write: `validator.ts` accepts both `42` and
    `"a_002"` here with 0 conflict errors (only `null` is rejected), so a model
    can produce it and nothing upstream stops it.
    """
    before, after = _states(
        [_conflict("c_001", competing_assertion_ids=competing)],
        [_conflict("c_001", competing_assertion_ids=competing, status="resolved",
                   resolution_rationale="x")],
    )
    # Must not raise anything other than the check's own AssertionError.
    try:
        check_word_caps(before, after)
    except AssertionError:
        pass


@pytest.mark.parametrize("competing", [42, "a_002", {"a_002": 1}, None])
def test_v3_does_not_crash_on_a_non_list_competing_assertion_ids(competing):
    """The same shape through V3, which shares the accessor."""
    ident = _identity("c_002", competing_assertion_ids=["a_001"])
    before, after = _v3_states(
        [_conflict("c_001", competing_assertion_ids=competing), ident],
        [_v3_resolved("c_001", competing_assertion_ids=competing), ident],
        _A,
    )
    try:
        check_identity_first(before, after)
    except AssertionError:
        pass


def test_v2_population_is_prose_authored_not_v6s_resolution_set():
    """Pins a distinction V2's own docstring calls load-bearing but nothing
    tested — found while mutation-testing V4 (a mis-targeted anchor hit V2's
    copy of the same line and the whole V2 suite stayed green).

    `_conflicts_written` is "every after-state conflict whose prose this run
    authored"; V6's `_conflicts_with_changed_analysis` is "entries this run
    resolved", which counts a `status`-only change. Under V6's population a run
    that merely flipped `status` on a conflict carrying a pre-existing 400-word
    rationale would be reported for prose it never wrote; under V2's it is not.

    Swapping the two left 11 of 11 V2 tests green before this existed.
    """
    long_prose = _words(400)
    base = {"id": "c_001", "conflict_type": "fact",
            "competing_assertion_ids": ["a_001", "a_002"],
            "independence_analysis": None, "preferred_assertion_id": None,
            "weighing_analysis": None, "resolution_rationale": long_prose}
    before, after = _states([dict(base, status="unresolved")],
                            [dict(base, status="resolved")])
    # The run wrote no prose, so the cap has nothing to report.
    check_word_caps(before, after)

    # Paired: authoring the same prose this turn IS reported, so the clean case
    # above cannot be passing because the check is inert.
    b2, a2 = _states([dict(base, status="unresolved", resolution_rationale=None)],
                     [dict(base, status="resolved")])
    with pytest.raises(AssertionError):
        check_word_caps(b2, a2)


# --- V4: no certainty upgrade on a hedged informant --------------------------
#
# ONE of the spec's three arms ships. The validator's comment carries the
# measurements; the parametrized regression below carries the three real corpus
# sentences that make the firsthand arm unshippable, so nobody re-adds it
# without seeing them.
#
# METHOD NOTE. Deleting the V4 block only reds the tests that assert a FINDING —
# a clean-case test passes when the feature is absent, which is how three
# vacuous tests shipped earlier in this issue. So every clean case below is
# PAIRED with a near-miss that must fire, and the pair is what pins it.

check_certainty_upgrade = getattr(
    _VALIDATOR, "report_informant_certainty_upgrade", None
)

_HEDGED_INFORMANT = "Unknown household member (likely Thomas Flynn or wife)"
# The real sentence from ut_008, v1_2026-08-19_15-24-31.
_UPGRADE_SENTENCE = (
    "First, informant proximity: the household informant for the census "
    "birthplace — almost certainly Thomas Flynn or his wife, Patrick's own "
    "parents — had direct personal knowledge of where their child was born."
)


def _v4_states(informant, *, before_prose=None, after_prose=None,
               field="weighing_analysis", quality="indeterminate"):
    a = {"id": "a_002", "source_id": "src_001", "informant": informant,
         "information_quality": quality}
    base = {"id": "c_001", "status": "resolved", "conflict_type": "fact",
            "competing_assertion_ids": ["a_002"], "preferred_assertion_id": "a_002",
            "independence_analysis": None, "weighing_analysis": None,
            "resolution_rationale": None}
    b = dict(base); b[field] = before_prose
    af = dict(base); af[field] = after_prose
    return ({"research_json": {"conflicts": [b], "assertions": [a]}},
            {"research_json": {"conflicts": [af], "assertions": [a]}})


def _fires(before, after, text=""):
    with pytest.raises(AssertionError) as e:
        check_certainty_upgrade(before, after, text)
    return str(e.value)


def test_v4_fires_on_a_certainty_upgrade_in_a_persisted_field():
    msg = _fires(*_v4_states(_HEDGED_INFORMANT, after_prose=_UPGRADE_SENTENCE))
    assert "Thomas Flynn" in msg
    assert "c_001" in msg
    # The record must be quoted against the prose, or a reader cannot judge it.
    assert _HEDGED_INFORMANT in msg, msg


def test_v4_fires_on_a_certainty_upgrade_in_the_REPLY_TEXT():
    """The spec's own worked example lives here, not in a persisted field.

    `"almost certainly Thomas Flynn, Patrick's father … with firsthand
    knowledge"` occurs exactly once in the corpus — in
    `v1_2026-08-19_15-24-31` / `ut_conflict_resolution_008` /
    `output.text_response` — and in NO `weighing_analysis` or
    `resolution_rationale`. A check reading only the persisted fields fires on
    none of it; 6 of the 15 corpus observations are in this field.
    """
    reply = ("**Decisive finding:** The census informant — almost certainly "
             "Thomas Flynn, Patrick's father — reported Ireland within 5–15 "
             "years of the birth, with firsthand knowledge.")
    before, after = _v4_states(_HEDGED_INFORMANT, after_prose="Some weighing.")
    msg = _fires(before, after, reply)
    assert "the reply text" in msg, msg
    assert "Thomas Flynn" in msg


def test_v4_clean_when_the_informant_is_named_WITHOUT_a_hedge():
    """Paired near-miss: the same prose fires once the record hedges the name.
    Without the pair, this passes with the feature deleted."""
    check_certainty_upgrade(
        *_v4_states("Thomas Flynn (father)", after_prose=_UPGRADE_SENTENCE,
                    quality="primary"), "")
    # The hedge has to sit in the NAME's own segment for the pair to fire — an
    # earlier version of this line put it in a name-free segment, so the
    # near-miss stayed silent and proved nothing.
    _fires(*_v4_states("Unknown (likely Thomas Flynn, the father)",
                       after_prose=_UPGRADE_SENTENCE, quality="primary"))


def test_v4_clean_when_the_hedge_sits_in_a_DIFFERENT_segment():
    """`"James Brown (son-in-law); the census informant is unknown"` names Brown
    flatly — the hedge is about someone else. A naive contains-hedge-AND-name
    test reads it as a hedged Brown."""
    flat = "James Brown (son-in-law); the census informant is unknown"
    prose = "The informant was almost certainly James Brown, the son-in-law."
    check_certainty_upgrade(*_v4_states(flat, after_prose=prose, quality="secondary"), "")
    # Paired: move the hedge into Brown's own segment and it must fire.
    hedged = "Unknown informant (possibly James Brown, son-in-law)"
    assert "James Brown" in _fires(
        *_v4_states(hedged, after_prose=prose, quality="secondary"))


@pytest.mark.parametrize(
    "sentence",
    [
        # Real corpus sentences. All three are CORRECT reasoning about the
        # losing informant, and all three match the firsthand phrase list the
        # spec proposes — which is why that arm is not shipped (>=63% of its
        # matches are these).
        "James Brown was a son-in-law who knew Patrick only as a long-established "
        "Pennsylvania resident; he had no firsthand access to birth facts.",
        "James Brown could not have had any firsthand knowledge of a birth that "
        "occurred decades before he joined the family as a son-in-law.",
        "This is precisely the epistemic position of a secondary informant: "
        "reporting the family's American context rather than a witnessed fact.",
    ],
)
def test_v4_is_clean_on_the_firsthand_forms_that_make_that_arm_unshippable(sentence):
    """The regression that keeps arm 1 out.

    Paired below with a certainty upgrade in the same text, so this cannot pass
    merely because the feature is absent.
    """
    check_certainty_upgrade(*_v4_states(_HEDGED_INFORMANT, after_prose=sentence), "")
    _fires(*_v4_states(_HEDGED_INFORMANT,
                       after_prose=sentence + " " + _UPGRADE_SENTENCE))


def test_v4_clean_when_certainty_names_a_DIFFERENT_person():
    prose = "The informant was almost certainly Bridget Murphy, not a Flynn."
    check_certainty_upgrade(*_v4_states(_HEDGED_INFORMANT, after_prose=prose), "")
    _fires(*_v4_states(_HEDGED_INFORMANT,
                       after_prose=prose + " " + _UPGRADE_SENTENCE))


def test_v4_clean_on_a_capitalised_non_name():
    """`'WPA Graves Registration worker (identity unknown)'` yields the bigram
    `Graves Registration`, which is a record series, not a person."""
    # The hedge must be in the NAME's own segment, or segment-scoping rejects
    # the string before the stop-list is consulted and this proves nothing —
    # which is how an earlier version of this test left the stop-list unpinned
    # (deleting it kept the suite green).
    junk = "Unknown (likely a WPA Graves Registration worker)"
    prose = "The record was almost certainly Graves Registration material."
    check_certainty_upgrade(*_v4_states(junk, after_prose=prose), "")
    # Paired: a real hedged person in the same construction must fire.
    _fires(*_v4_states("Unknown worker (likely Thomas Flynn)",
                       after_prose="It was almost certainly Thomas Flynn."))


def test_v4_clean_when_the_run_wrote_no_conflict_prose():
    """Population is `_conflicts_written`. An untouched conflict is not this
    run's doing, however bad its existing prose."""
    before, after = _v4_states(_HEDGED_INFORMANT,
                               before_prose=_UPGRADE_SENTENCE,
                               after_prose=_UPGRADE_SENTENCE)
    check_certainty_upgrade(before, after, "")
    # Paired: authoring the same prose this turn fires.
    _fires(*_v4_states(_HEDGED_INFORMANT, after_prose=_UPGRADE_SENTENCE))


def test_v4_reports_one_observation_per_upgrade_not_two():
    """One span, one observation.

    This does NOT pin the alternation order — reversing it leaves the suite
    green, because `finditer` matches `almost certainly` at the same position
    either way. The comment in the validator that claimed otherwise was wrong
    and is corrected. What this pins is the count itself, which a duplicated
    scan of the same field would break.
    """
    msg = _fires(*_v4_states(_HEDGED_INFORMANT, after_prose=_UPGRADE_SENTENCE))
    assert msg.count("attaches a certainty marker to 'Thomas Flynn'") == 1, msg


def test_v4_fires_on_a_bare_certainty_marker_too():
    """Polarity for the ordering test: `certainly` on its own is in scope."""
    _fires(*_v4_states(_HEDGED_INFORMANT,
                       after_prose="The informant was certainly Thomas Flynn."))


def test_v4_the_extracted_name_may_be_the_research_SUBJECT():
    """Documented behaviour, not a bug, and pinned so it is a known cost.

    `mid-research-flynn-merge-pending` carries
    `'Unknown — most likely Patrick Flynn as head of household, possibly his
    wife'`, so the hedged name is the project's own subject. Strict adjacency
    keeps this narrow — only a certainty marker DIRECTLY on the name fires — but
    a resolution asserting "almost certainly Patrick Flynn" is reported.
    """
    inf = "Unknown — most likely Patrick Flynn as head of household, possibly his wife"
    _fires(*_v4_states(inf, after_prose="The informant was almost certainly Patrick Flynn."))
    # And ordinary prose about the subject is NOT reported.
    check_certainty_upgrade(
        *_v4_states(inf, after_prose="Patrick Flynn was born in Ireland in 1845."), "")


def test_v4_a_single_word_hedged_name_is_a_known_FALSE_NEGATIVE():
    """Recorded as a limitation rather than left to be discovered.

    `'Unknown informant (likely Bridget herself, as head of household)'` yields
    no bigram, so `"almost certainly Bridget"` is missed. Admitting lone
    capitalised tokens would match ordinary sentence-initial words.
    """
    inf = "Unknown informant (likely Bridget herself, as head of household)"
    check_certainty_upgrade(
        *_v4_states(inf, after_prose="It was almost certainly Bridget."), "")


@pytest.mark.parametrize(
    "informant",
    [None, 42, {"name": "Thomas Flynn"}, [], ""],
)
def test_v4_a_malformed_informant_does_not_raise(informant):
    """An UNEXPECTED exception in a `report_*` gates and suppresses the judge;
    an assert does not. `informant` is schema-required and typed string, so
    these are defensive against states the schema forbids."""
    check_certainty_upgrade(*_v4_states(informant, after_prose=_UPGRADE_SENTENCE), "")


def test_v4_skips_when_either_side_lacks_research_json():
    """Each side independently, the way V6 and V2 do it.

    Only the before=None path was covered. Worth being exact about the reason:
    an `or` -> `and` mutation DOES red this, but by raising `AttributeError`
    inside `_conflicts_by_id(None)` rather than by failing the skip assertion —
    so the after=None branch was untested and the red proved something else.
    """
    with pytest.raises(pytest.skip.Exception):
        check_certainty_upgrade({"research_json": None}, {"research_json": {}}, "")
    with pytest.raises(pytest.skip.Exception):
        check_certainty_upgrade({"research_json": {}}, {"research_json": None}, "")


def test_v4_is_tier_2_reporting_not_gating():
    assert hasattr(_VALIDATOR, "report_informant_certainty_upgrade")
    assert not hasattr(_VALIDATOR, "test_informant_certainty_upgrade"), (
        "V4 was promoted to a gating test_*; this arm reads PROSE, and gating "
        "suppresses the only grader that can judge whether the upgrade was "
        "justified"
    )


# --- V4 over the committed corpus -------------------------------------------
#
# The house pattern, and the thing whose absence let three different hit counts
# (9 / 10 / 11 / 15) circulate in the plan before any code existed. `_replay`
# above cannot serve: it calls `validator(before, after)` with two arguments and
# V4 needs `text_response`, which is where 6 of the 15 observations live.


def _replay_v4():
    """Every committed run through V4, carrying `text_response`."""
    fired = []
    for path in _CORPUS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        for t in log.get("tests", []):
            fixture = (_REPO / "eval/fixtures/scenarios"
                       / str(t.get("scenario")) / "research.json")
            if not fixture.exists():
                continue
            fx = json.loads(fixture.read_text(encoding="utf-8"))
            base = fx.get("conflicts") or []
            assertions = fx.get("assertions") or []
            for r in t.get("runs", []):
                cd = ((((r.get("output") or {}).get("file_changes") or {})
                       .get("research.json") or {}).get("diff") or {}).get("conflicts") or {}
                after_c = [dict(c) for c in base]
                by_id = {c["id"]: c for c in after_c}
                for e in cd.get("modified") or []:
                    tgt = by_id.get(e.get("id"))
                    if tgt is None:
                        continue
                    for f, ch in (e.get("changed_fields") or {}).items():
                        tgt[f] = ch.get("after")
                for a in cd.get("added") or []:
                    if isinstance(a, dict) and a.get("id") not in by_id:
                        after_c.append(dict(a))
                try:
                    check_certainty_upgrade(
                        {"research_json": {"conflicts": base, "assertions": assertions}},
                        {"research_json": {"conflicts": after_c, "assertions": assertions}},
                        str((r.get("output") or {}).get("text_response") or ""),
                    )
                except AssertionError as e:
                    fired.append((Path(path).name, t["test_id"], str(e)))
                except pytest.skip.Exception:
                    pass
    return fired


def _independently_v4_hits():
    """Re-derive from raw JSON, sharing none of the validator's helpers.

    Restates the hedge-scoping and the adjacency rule rather than importing
    them, for the reason the V6/V2 second derivations give: importing would make
    both sides share the thing most likely to be wrong.
    """
    import re as _re
    hedge = _re.compile(r"\b(unknown|possibly|likely|most likely)\b", _re.I)
    seg = _re.compile(r"[();]|(?<=\w)\s+[—–-]\s+")
    name = _re.compile(r"\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b")
    notperson = _re.compile(r"\b(WPA|Graves Registration|Registration Worker|"
                            r"Death Certificate|Census|Household Member|"
                            r"Unknown Informant|Bureau|Vital Records)\b", _re.I)
    # `\b` at both ends, matching the validator. Without it the derivation
    # agrees with the validator as it was BEFORE the anchoring landed, so the
    # agreement test could not see the fix at all — measured: removing both
    # anchors from the validator left this test green.
    mark = r"\b(?:almost certainly|undoubtedly|definitely|certainly)"

    out = set()
    for path in _CORPUS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        for t in log.get("tests", []):
            fixture = (_REPO / "eval/fixtures/scenarios"
                       / str(t.get("scenario")) / "research.json")
            if not fixture.exists():
                continue
            fx = json.loads(fixture.read_text(encoding="utf-8"))
            A = {a.get("id"): a for a in fx.get("assertions") or []}
            start = {c.get("id"): c for c in fx.get("conflicts") or []}
            for r in t.get("runs", []):
                cd = ((((r.get("output") or {}).get("file_changes") or {})
                       .get("research.json") or {}).get("diff") or {}).get("conflicts") or {}
                after = {k: dict(v) for k, v in start.items()}
                wrote = set()
                for e in cd.get("modified") or []:
                    cid = e.get("id")
                    if cid is None:
                        continue
                    tgt = after.setdefault(cid, {"id": cid})
                    fields = e.get("changed_fields") or {}
                    for f, ch in fields.items():
                        tgt[f] = ch.get("after")
                    if {"weighing_analysis", "resolution_rationale"} & set(fields):
                        wrote.add(cid)
                # The `added` arm, which `_replay_v4` handles and this omitted.
                # Dormant — 0 added conflict entries in the corpus — but a
                # rotation introducing a created-and-upgraded conflict would
                # make the agreement test fail as "validator only", pointing at
                # the derivation rather than at a real drift. The V2 derivation
                # had to fix this same gap once already.
                for a in cd.get("added") or []:
                    if not isinstance(a, dict) or a.get("id") is None:
                        continue
                    after[a["id"]] = dict(a)
                    # EVERY created conflict, prose keys or not —
                    # `_conflicts_written` counts a new entry via `prev is None`
                    # regardless. Gating on the prose keys made the derivation
                    # silent where the validator fires (measured: a created
                    # conflict with no prose keys and the upgrade in the reply
                    # text).
                    wrote.add(a["id"])
                for cid in wrote:
                    c = after.get(cid) or {}
                    names = set()
                    for aid in c.get("competing_assertion_ids") or []:
                        a = A.get(aid) or {}
                        inf = a.get("informant")
                        if not isinstance(inf, str):
                            continue
                        for s in seg.split(inf):
                            if s and hedge.search(s):
                                names |= {n for n in name.findall(s)
                                          if not notperson.search(n)}
                        # The `indeterminate` arm, which is NOT a no-op — it
                        # supplies 4 of the 11 flagged runs on its own. See
                        # test_v4_the_indeterminate_arm_is_load_bearing.
                        if a.get("information_quality") == "indeterminate":
                            names |= {n for n in name.findall(inf)
                                      if not notperson.search(n)}
                    if not names:
                        continue
                    texts = [str(c.get("weighing_analysis") or ""),
                             str(c.get("resolution_rationale") or ""),
                             str((r.get("output") or {}).get("text_response") or "")]
                    for txt in texts:
                        for nm in names:
                            if _re.search(mark + r"[\s,:;—–-]*" + _re.escape(nm)
                                          + r"\b", txt, _re.I):
                                out.add((Path(path).name, t["test_id"]))
    return out


def test_v4_agrees_with_a_second_derivation_over_the_corpus():
    fired = {(n, t) for n, t, _ in _replay_v4()}
    independent = _independently_v4_hits()
    assert independent, (
        "the second derivation found nothing, so this test cannot detect a V4 "
        "that fires on nothing — has the corpus rotated away flynn-identity-geographic?"
    )
    assert fired == independent, (
        "V4 and an independent re-derivation disagree over the committed corpus."
        f"\n  validator only: {sorted(fired - independent)}"
        f"\n  derivation only: {sorted(independent - fired)}"
    )


def test_v4_catches_the_specs_own_worked_example_in_the_corpus():
    """The spec quotes one violation by name. It is in `text_response`, so a
    check reading only the persisted fields fires on none of it — which is what
    the first version of this plan would have shipped."""
    quote = "almost certainly Thomas Flynn, Patrick's father"
    hits = [(n, t) for n, t, msg in _replay_v4() if quote in msg]
    assert hits, (
        "V4 no longer reports the spec's own worked example. It lives in "
        "ut_conflict_resolution_008's text_response in v1_2026-08-19_15-24-31 — "
        "if that log has rotated out, re-point this test rather than deleting it"
    )
    assert any(t.endswith("008") for _, t in hits), hits


def test_v4_reports_the_reply_text_as_well_as_the_persisted_fields():
    """40% of the corpus signal is in the reply text. A regression that dropped
    that field would leave the two tests above green if the persisted hits
    survived, so the field split is asserted directly."""
    fields = {"weighing_analysis": 0, "resolution_rationale": 0, "the reply text": 0}
    for _, _, msg in _replay_v4():
        for f in fields:
            fields[f] += msg.count(f" {f} attaches a certainty marker to '")
    assert all(v > 0 for v in fields.values()), (
        f"V4 reported nothing from at least one field: {fields}"
    )


def test_v4_the_indeterminate_arm_is_load_bearing_not_a_no_op():
    """Corrects a claim I made in the plan and a reviewer measured differently.

    Both of us called `information_quality: "indeterminate"` a no-op, on the
    grounds that no assertion carries it alongside an *unhedged* name. That is
    true of "unhedged" meaning "no hedge word anywhere in the string" — and
    false under the segment-scoping this check actually uses.

    `flynn-with-birthplace-conflict`'s a_002 is the case:

        'Unknown — most likely a household member (such as Thomas Flynn or his
         wife), but possibly a neighbor'

    The name sits in a parenthetical whose own segment has NO hedge word, so
    segment-scoped extraction yields nothing and only the `indeterminate` arm
    reaches it. It supplies `ut_conflict_resolution_001` in all four committed
    logs — 4 of the 11 flagged runs.

    The corpus re-derivation test found this within a minute of being written,
    which is the argument for having it.
    """
    inf = ("Unknown — most likely a household member (such as Thomas Flynn or "
           "his wife), but possibly a neighbor")
    prose = "The informant was almost certainly Thomas Flynn or his wife."

    # Segment-scoped hedging alone cannot see it: the name's own segment
    # ("such as Thomas Flynn or his wife") carries no hedge word.
    assert _VALIDATOR._hedged_informant_names(inf) == set(), (
        "segment-scoped extraction now reaches this string, so the "
        "indeterminate arm may no longer be what catches it"
    )

    # With `indeterminate`, it fires.
    _fires(*_v4_states(inf, after_prose=prose, quality="indeterminate"))

    # Without it, it does not — which is the whole point of keeping the arm.
    check_certainty_upgrade(
        *_v4_states(inf, after_prose=prose, quality="secondary"), "")


def test_v4_strict_adjacency_is_a_deliberate_FALSE_NEGATIVE_boundary():
    """The cost of not reading the argument, pinned so it is a decision.

    A real corpus sentence — "based on information almost certainly supplied by
    Thomas Flynn or his wife" — puts two words between the marker and the name,
    so strict adjacency does NOT report it. Widening to "up to 3 words" would
    catch it and costs one extra hit corpus-wide; widening to same-sentence
    costs two. Both were measured before the tightest was chosen.

    Paired with the adjacent form, so this cannot pass on the feature being
    absent.
    """
    gap = ("In 1850, the household enumerator recorded Patrick's birthplace as "
           "Ireland based on information almost certainly supplied by Thomas "
           "Flynn or his wife.")
    check_certainty_upgrade(*_v4_states(_HEDGED_INFORMANT, after_prose=gap), "")
    _fires(*_v4_states(_HEDGED_INFORMANT,
                       after_prose="The informant was almost certainly Thomas Flynn."))


def test_v4_ignores_prose_the_run_did_not_author():
    """Population is `_conflicts_written`, not V6's resolution population.

    V6's `_conflicts_with_changed_analysis` counts a `status`-only change as a
    resolution. Under it, a run that merely flipped `status` on a conflict whose
    prose ALREADY carried an upgrade would be reported for prose it never wrote.
    Swapping the populations left the suite green until this test existed.
    """
    a = {"id": "a_002", "source_id": "src_001", "informant": _HEDGED_INFORMANT,
         "information_quality": "indeterminate"}
    base = {"id": "c_001", "conflict_type": "fact",
            "competing_assertion_ids": ["a_002"], "preferred_assertion_id": "a_002",
            "independence_analysis": None, "resolution_rationale": None,
            "weighing_analysis": _UPGRADE_SENTENCE}
    before = {"research_json": {"conflicts": [dict(base, status="unresolved")],
                                "assertions": [a]}}
    after = {"research_json": {"conflicts": [dict(base, status="resolved")],
                               "assertions": [a]}}
    check_certainty_upgrade(before, after, "")

    # Paired: authoring the prose in the same turn IS reported.
    _fires(*_v4_states(_HEDGED_INFORMANT, after_prose=_UPGRADE_SENTENCE))


def test_v4_derivation_and_validator_agree_on_a_CREATED_conflict():
    """Pins the `added` arm of the second derivation, which was dormant.

    The corpus has 0 added conflict entries, so agreement over it cannot
    exercise that path — a rotation introducing a created-and-upgraded conflict
    would have failed the agreement test as "validator only", which points at
    the derivation rather than at real drift. This drives both sides over a
    synthetic run log carrying exactly that shape.
    """
    inf = "Unknown household member (likely Thomas Flynn or wife)"
    log = {"tests": [{
        "test_id": "ut_synth", "scenario": "flynn-identity-geographic",
        "runs": [{"output": {"file_changes": {"research.json": {"diff": {"conflicts": {
            "added": [{
                "id": "c_new", "status": "resolved", "conflict_type": "fact",
                "competing_assertion_ids": ["a_002"],
                "preferred_assertion_id": "a_002",
                "independence_analysis": None,
                "weighing_analysis": "The informant was almost certainly Thomas Flynn.",
                "resolution_rationale": None,
            }]}}}}}}],
    }]}

    fx_path = _REPO / "eval/fixtures/scenarios/flynn-identity-geographic/research.json"
    fx = json.loads(fx_path.read_text(encoding="utf-8"))
    # Confirm the fixture still supplies the hedged informant this rests on.
    A = {a["id"]: a for a in fx.get("assertions") or []}
    assert inf == A["a_002"]["informant"], (
        "flynn-identity-geographic's a_002 informant changed; re-point this test"
    )

    # Drive BOTH real functions over a synthetic corpus, rather than
    # re-implementing either. An earlier version of this test recomputed the
    # `wrote` set inline, so deleting the derivation's `added` arm left it green
    # — shape-only, which is the failure this whole test exists to prevent.
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "v1_2026-01-01_00-00-00.json"
        path.write_text(json.dumps(log), encoding="utf-8")
        saved = globals()["_CORPUS"]
        globals()["_CORPUS"] = [str(path)]
        try:
            fired = {(n, t) for n, t, _ in _replay_v4()}
            independent = _independently_v4_hits()
            messages = [m for _, _, m in _replay_v4()]
        finally:
            globals()["_CORPUS"] = saved

    assert fired == {("v1_2026-01-01_00-00-00.json", "ut_synth")}, fired
    assert independent == fired, (
        "the second derivation missed a CREATED conflict the validator reported "
        f"— its `added` arm is the gap.\n  validator: {sorted(fired)}"
        f"\n  derivation: {sorted(independent)}"
    )
    assert any("c_new" in m for m in messages), messages


def test_v4_observations_are_newline_separated():
    """V2 joins with newlines; a run-on sentence is harder to triage, and a
    genealogist reads this text directly."""
    inf = "Unknown household member (likely Thomas Flynn or wife)"
    a = {"id": "a_002", "source_id": "src_001", "informant": inf,
         "information_quality": "indeterminate"}
    base = {"id": "c_001", "status": "resolved", "conflict_type": "fact",
            "competing_assertion_ids": ["a_002"], "preferred_assertion_id": "a_002",
            "independence_analysis": None, "resolution_rationale": None,
            "weighing_analysis": None}
    # Two fields each carrying an upgrade -> two observations.
    after_c = dict(base,
                   weighing_analysis="It was almost certainly Thomas Flynn.",
                   resolution_rationale="Again, almost certainly Thomas Flynn.")
    with pytest.raises(AssertionError) as e:
        check_certainty_upgrade(
            {"research_json": {"conflicts": [base], "assertions": [a]}},
            {"research_json": {"conflicts": [after_c], "assertions": [a]}},
            "",
        )
    msg = str(e.value)
    assert msg.count("attaches a certainty marker to 'Thomas Flynn'") == 2, msg
    assert "\n" in msg, f"observations are not newline-separated:\n{msg}"


def test_v4_the_certainty_pattern_is_anchored_at_both_ends():
    """Neither end was anchored, and both shapes fired before `\\b` was added.

    Latent — the whole corpus yields one distinct hedged name (`Thomas Flynn`)
    and zero instances of either shape across 51 runs — so this is pinned by
    argument rather than by a corpus hit.
    """
    inf = "Unknown household member (likely Mary Ann or wife)"

    # A DIFFERENT woman: hedged "Mary Ann", prose "Mary Anne".
    check_certainty_upgrade(
        *_v4_states(inf, after_prose="It was almost certainly Mary Anne Sullivan."), "")

    # `certainly` inside `uncertainly` — plausible genealogy prose.
    check_certainty_upgrade(
        *_v4_states(inf,
                    after_prose="The informant reported uncertainly Mary Ann was present."), "")

    # PAIRED, so neither clean case can rest on the check being inert. The same
    # woman with a surname ADDED must still fire — the trailing `\\b` is
    # deliberately permissive there.
    _fires(*_v4_states(inf, after_prose="It was almost certainly Mary Ann Sullivan."))
    _fires(*_v4_states(inf, after_prose="It was almost certainly Mary Ann."))


@pytest.fixture
def v4_synthetic_corpus(tmp_path, monkeypatch):
    """Point BOTH `_replay_v4` and `_independently_v4_hits` at a corpus we build.

    They read the module globals `_CORPUS` and `_REPO`, so redirecting those is
    what makes the agreement assertion able to see the anchoring. An earlier
    version of this test called the VALIDATOR's own `_certainty_upgrades` helper
    instead — which tested the validator twice and pinned the derivation not at
    all: three mutations to the derivation (both `\b` and the created-conflict
    gate) left the whole suite green.
    """
    mod = sys.modules[__name__]  # this module; pytest does not import it by name

    scen = tmp_path / "eval" / "fixtures" / "scenarios" / "s_demo"
    scen.mkdir(parents=True)
    (scen / "research.json").write_text(
        json.dumps({
            "conflicts": [{"id": "c_001", "status": "unresolved",
                           "conflict_type": "fact",
                           "competing_assertion_ids": ["a_002"],
                           "weighing_analysis": None,
                           "resolution_rationale": None}],
            "assertions": [{"id": "a_002", "source_id": "src_001",
                            "informant": _HEDGED_INFORMANT,
                            "information_quality": "indeterminate"}],
        }),
        encoding="utf-8",
    )
    logs = tmp_path / "logs"
    logs.mkdir()
    monkeypatch.setattr(mod, "_REPO", tmp_path)
    return logs, scen


def _v4_log(path, *, prose=None, reply="", created=False):
    diff = {"conflicts": {}}
    entry = {"id": "c_001", "changed_fields": {}}
    if created:
        # A NEW id, not one the fixture already holds — `_replay_v4` correctly
        # skips an `added` entry whose id is already present, so reusing c_001
        # made this row test nothing.
        diff["conflicts"]["added"] = [{"id": "c_new", "status": "resolved",
                                       "conflict_type": "fact",
                                       "competing_assertion_ids": ["a_002"]}]
    else:
        entry["changed_fields"]["weighing_analysis"] = {"before": None, "after": prose}
        diff["conflicts"]["modified"] = [entry]
    path.write_text(json.dumps({"tests": [{
        "test_id": "ut_probe", "scenario": "s_demo", "outcome": "pass",
        "runs": [{"output": {"text_response": reply,
                             "file_changes": {"research.json": {"diff": diff}}}}],
    }]}), encoding="utf-8")


@pytest.mark.parametrize(
    "label,kwargs,should_fire",
    [
        ("control: the plain upgrade",
         dict(prose="It was almost certainly Thomas Flynn."), True),
        ("control: no certainty marker",
         dict(prose="It was probably Thomas Flynn."), False),
        ("certainly inside uncertainly",
         dict(prose="Reported uncertainly Thomas Flynn was there."), False),
        ("a name extended by a letter",
         dict(prose="It was almost certainly Thomas Flynne."), False),
        ("created conflict, upgrade in the REPLY",
         dict(created=True, reply="It was almost certainly Thomas Flynn."), True),
    ],
)
def test_v4_the_second_derivation_matches_the_validator(
    v4_synthetic_corpus, monkeypatch, label, kwargs, should_fire
):
    """Drives the REAL replay and the REAL derivation over the same corpus.

    The corpus-agreement test above cannot see the anchoring — measured:
    removing both `\b` from the validator left it green, because the derivation
    used the unanchored form and so agreed with the validator as it was BEFORE
    the fix. Had the corpus rotated in one of these shapes it would have
    reddened pointing at the wrong side.

    The created-conflict row is the other half: `_conflicts_written` counts a new
    entry via `prev is None` regardless of prose keys, and the derivation used to
    gate on those keys.
    """
    mod = sys.modules[__name__]  # this module; pytest does not import it by name

    logs, _ = v4_synthetic_corpus
    log = logs / "v1_2026-01-01_00-00-00.json"
    _v4_log(log, **kwargs)
    monkeypatch.setattr(mod, "_CORPUS", [str(log)])

    fired = {(n, t) for n, t, _ in mod._replay_v4()}
    derived = mod._independently_v4_hits()
    assert bool(fired) is should_fire, f"validator disagreed on {label!r}"
    assert fired == derived, (
        f"validator and derivation disagree on {label!r}: "
        f"validator={sorted(fired)} derivation={sorted(derived)}"
    )


def test_v4_the_quoted_span_always_contains_the_phrase_it_accuses():
    """`span[:200]` counted from the SENTENCE start, so a long run-up ate the
    evidence — one real hit ended "…the informant was almost certainly T".
    The window is now clamped to end no more than 200 chars after the match."""
    runup = ("The 1850 census enumerator visited the dwelling on a Tuesday in "
             "August and recorded every member of the household in turn, working "
             "down the page from the head of family, and when he reached the "
             "five-year-old child he wrote Ireland because the informant was "
             "almost certainly Thomas Flynn or his wife.")
    assert len(runup) > 200
    msg = _fires(*_v4_states(_HEDGED_INFORMANT, after_prose=runup))
    quoted = msg.split("Quoted:", 1)[1]
    assert "almost certainly Thomas Flynn" in quoted, quoted




def test_v4_the_quote_does_not_end_at_the_name_it_accuses():
    """The two truncations must not land on the same spot.

    `_certainty_upgrades` bounds the run-up and the message then applies
    `span[:200]`. With both set to 200 they coincide and everything after the
    marker is dropped — measured on `ut_conflict_resolution_006`'s
    `resolution_rationale`: a 295-char span with 95 chars after the match, all 95
    cut, shipping "…the informant was almost certainly Thomas Flynn" where the
    rationale says "almost certainly Thomas Flynn OR HIS WIFE".

    That is the same defect the "attaches a certainty marker to" wording was
    changed to stop — an observation showing the run naming one person when it
    named two — arriving by a different route.
    """
    # A run-up long enough to force the clamp, with the disjunction after.
    prose = (
        "The 1850 census schedule was recorded by an enumerator who visited the "
        "Thomas Flynn household roughly five years after Patrick's estimated "
        "1845 birth, working down the page from the head of family through each "
        "member in turn; the informant was almost certainly Thomas Flynn or his "
        "wife, the two adults responsible for the household."
    )
    msg = _fires(*_v4_states(_HEDGED_INFORMANT, after_prose=prose))
    quoted = msg.split("Quoted:", 1)[1]
    assert "almost certainly Thomas Flynn" in quoted, quoted
    # The tail is the point: it is what shows the prose named TWO people.
    assert "or his wife" in quoted, (
        "the quote stops at the accused name, so it shows the run naming one "
        f"person when it named two:\n{quoted}"
    )
