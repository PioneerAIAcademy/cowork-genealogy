"""Direct tests for the two source-evaluation doctrine validators (issue #2222).

Same reason as `test_conflict_resolution_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run — which is exactly how the two defects
below reached a released run log.

**Both defects are replayed from the run log that exposed them**, not from
invented text. On `v1_2026-09-08_14-22-00.json` the two shipped tests that had
been passing for a week both went red, and neither failure was a regression in
the skill:

- `ut_source_evaluation_m8q` failed `test_index_discrepancy_recommends_reread`
  on a reply that followed the doctrine *better* than the pattern anticipated.
  The Minnesota Death Index is index-only, and the reply said so — "there is no
  scan to open behind this index entry. The source of truth is the underlying
  Minnesota death certificate" — then routed the fix through "FamilySearch's
  correction process". The pattern wanted the literal "correction path" and
  "correct the index". A false negative built out of an incomplete enumeration.
- `ut_source_evaluation_r4k` failed
  `test_index_discrepancy_does_not_recommend_detaching` on a *correct* closing
  summary: "One index correction needed (the 1945 death year in the Minnesota
  Death Index) and one detachment warranted (the 1885 Otter Tail County
  census…)". Two sources, two different remedies, each attached to the right
  one. The guard splits on blank lines, so one sentence naming both trips it.

The prove-it-can-fail half is not optional here (CLAUDE.md, "A new lint must be
proven to fail"): widening a pattern and adding a skip both make a guard weaker,
and a guard that cannot fail is worse than none. So each fix is paired with a
case that must still be caught.
"""

import glob
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))


# Loaded unrewritten, for the reason spelled out at length in
# `test_conflict_resolution_validator.py`: pytest's assertion rewriting appends
# its own explanation to the AssertionError, so a test asserting on the message
# can pass on the rewrite's repr rather than on anything the validator said.
def _load_validator_unrewritten():
    import importlib.util

    path = _VALIDATORS_DIR / "test_source_evaluation.py"
    spec = importlib.util.spec_from_file_location(
        "_se_validator_unrewritten", path
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_VALIDATOR = _load_validator_unrewritten()
_GO_TO_SOURCE = _VALIDATOR._GO_TO_SOURCE_PATTERN
_SUMMARY_LEAD = _VALIDATOR._SUMMARY_LEAD_RE
_recommends_reread = _VALIDATOR.test_index_discrepancy_recommends_reread
_no_detach = _VALIDATOR.test_index_discrepancy_does_not_recommend_detaching

_REPO = Path(__file__).resolve().parents[4]
_PROTECTED = "Minnesota Death Index"
_TEST = {
    "tags": ["index-discrepancy"],
    "type": "positive",
    "index_error_source": _PROTECTED,
}

# The exact sentence from `ut_source_evaluation_r4k` on
# `v1_2026-09-08_14-22-00.json`. Kept verbatim: the point is that this shape is
# correct and must not fail, and a paraphrase would let the fix drift off the
# thing it was built for.
_R4K_SUMMARY = (
    "**Summary:** One index correction needed (the 1945 death year in the "
    "Minnesota Death Index) and one detachment warranted (the 1885 Otter Tail "
    "County census, which belongs to an older Christian Hole). The 1900 census "
    "and the uploaded memory need no action from this audit."
)

# The remedy `ut_source_evaluation_m8q` gave for the same index-only source.
_M8Q_REMEDY = (
    "This collection is described as a **database** (no images) - there is no "
    "scan to open behind this index entry. The source of truth is the "
    "underlying Minnesota death certificate, which is a separate record.\n\n"
    "**Action:** Submit a correction to this index entry through FamilySearch's "
    "correction process, citing the year as 1945. To confirm the correction is "
    "right before submitting it, locate the original Minnesota death "
    "certificate for Christian P. Hole (Polk County, 1945) through the "
    "Minnesota Historical Society or a comparable repository."
)


# --- the reread guard: what it must accept -------------------------------


def test_index_only_correction_route_counts_as_going_back_to_the_source():
    """m8q's real remedy. Index-only collection, so no scan exists to re-read."""
    _recommends_reread(_M8Q_REMEDY, _TEST)


def test_locating_the_original_document_counts_under_any_verb():
    """The earlier pattern fixed both the verb and the noun and missed these."""
    for phrasing in (
        "Locate the original certificate held by the state archive.",
        "Obtain the original register entry from the parish.",
        "Order the original death certificate to settle the year.",
    ):
        _recommends_reread(phrasing, _TEST)


# --- the reread guard: what it must still reject -------------------------


def test_a_detach_only_reply_still_fails_the_reread_guard():
    reply = (
        "### Finding 1 - Minnesota Death Index, 1908-2002\n"
        "The indexed year is 1954; the profile records 1945. Detach it."
    )
    try:
        _recommends_reread(reply, _TEST)
    except AssertionError:
        return
    raise AssertionError(
        "the widened pattern now matches a reply whose only recommendation is "
        "a detach, so the guard asserts nothing. Doctrine point 1 of issue "
        "#1606 is the whole reason this validator exists."
    )


def test_a_reply_with_no_remedy_at_all_still_fails_the_reread_guard():
    try:
        _recommends_reread("4 attached, 0 findings. Everything looks fine.", _TEST)
    except AssertionError:
        return
    raise AssertionError("a reply recommending nothing must not satisfy the guard")


# --- the detach guard: the false positive it must no longer raise --------


def test_a_correct_closing_summary_naming_two_remedies_passes():
    """r4k's real summary. Two sources, two remedies, each correctly attached."""
    _no_detach(_R4K_SUMMARY, _TEST)


def test_the_live_recap_shapes_pass():
    """The two recaps the skill actually wrote, from `v1_2026-09-08_15-53-39`.

    2 of 10 tests in that run put their real recommendations in a recap, which
    is why the earlier "skip the recap block" fix was wrong: it made these pass
    by not looking at them, and `test_a_detach_hidden_in_a_recap_still_fails`
    below is what that bought.
    """
    _no_detach(
        "In summary: correct the death year on the Minnesota Death Index entry "
        "(Finding 1), detach the 1885 Otter Tail County census from this "
        "profile (Finding 2), and the remaining sources are in good order.",
        _TEST,
    )
    _no_detach(
        "**Bottom line:** One source to correct (the death index year), one to "
        "detach (the 1885 Otter Tail census, which belongs to a different "
        "Christian Hole), and the 1900 census and uploaded memory are fine "
        "as-is.",
        _TEST,
    )


def test_a_detach_hidden_in_a_recap_still_fails():
    """The regression the recap skip introduced, and the reason it was replaced.

    A reply whose ONLY detach recommendation lives in a recap is the #1536
    failure. While `_SUMMARY_LEAD_RE` dropped the whole block, this passed
    silently — a false negative in the one guard that stops an unrecoverable
    action, which is strictly worse than the false positive it was fixing.
    """
    for reply in (
        "### Findings\nThe indexed death year is 1954 against the profile's "
        "1945.\n\n**Conclusion:** Detach the Minnesota Death Index - I do not "
        "think it is the right man.",
        "In summary: detach the Minnesota Death Index; it is not this man.",
        "**Bottom line:** the Minnesota Death Index should be detached.",
    ):
        try:
            _no_detach(reply, _TEST)
        except AssertionError:
            continue
        raise AssertionError(
            f"a detach of the protected source hidden in a recap was not "
            f"caught, so the guard is toothless on the shape the skill "
            f"actually uses: {reply!r}"
        )


def test_passages_splits_a_recap_into_clauses():
    got = _VALIDATOR._passages(
        "In summary: correct the death year on the Minnesota Death Index "
        "(Finding 1), detach the 1885 census (Finding 2), and the rest are fine."
    )
    assert any("Minnesota Death Index" in c for c in got), got
    assert not any(
        "Minnesota Death Index" in c and "detach" in c.lower() for c in got
    ), f"the two remedies did not separate: {got}"


def test_a_per_source_verdict_table_passes():
    """x6b's real shape, from `v1_2026-09-08_15-25-07.json`.

    A markdown table carries no blank lines, so before `_passages` split rows
    out, all four verdicts landed in one block: the protected source's row
    ("Belongs, but the indexed death year reads 1954") and the 1885 census's
    row ("Detach") were judged together and the correct report failed.
    """
    reply = (
        "| Source | Verdict |\n"
        "|---|---|\n"
        "| 1900 US Census | Belongs - the 2-year drift is ordinary variance |\n"
        "| Minnesota Death Index, 1908-2002 | Belongs, but the indexed death "
        "year reads 1954 - correct it to 1945 via the original certificate |\n"
        "| Minnesota State Census, 1885 | Detach - it is about a different "
        "Christian Hole (KD96-WX7) |\n"
        "| Funeral card (uploaded memory) | Could not verify |"
    )
    _no_detach(reply, _TEST)


def test_a_detach_in_the_protected_sources_own_table_row_still_fails():
    reply = (
        "| Source | Verdict |\n"
        "|---|---|\n"
        "| Minnesota Death Index, 1908-2002 | Detach - wrong person |"
    )
    try:
        _no_detach(reply, _TEST)
    except AssertionError:
        return
    raise AssertionError(
        "row splitting now hides a detach recommended for the protected "
        "source in its own row, which is the same defect as the block-level "
        "guard it replaced, only quieter"
    )


def test_passages_splits_table_rows_and_keeps_prose_separate():
    text = "Lead-in prose.\n| a | b |\n| c | d |\n\nA later paragraph."
    got = _VALIDATOR._passages(text)
    assert "| a | b |" in got and "| c | d |" in got, got
    assert any("Lead-in prose." in p for p in got), got
    assert any("A later paragraph." in p for p in got), got


def test_summary_lead_matches_the_recap_labels_it_claims_to():
    for lead in ("**Summary:** x", "Summary: x", "## In short - x", "*Recap:* x",
                 "**Overall:** x", "Bottom line: x"):
        assert _SUMMARY_LEAD.match(lead.strip()), lead
    # And does not swallow a finding that merely discusses a summary.
    assert not _SUMMARY_LEAD.match("The index summary disagrees with the profile.")


# --- the detach guard: what it must still catch --------------------------


def test_a_detach_recommended_for_the_protected_source_still_fails():
    reply = (
        "### Finding 1 - Minnesota Death Index, 1908-2002 - wrong person\n"
        "**What to do:** Detach the Minnesota Death Index from this profile."
    )
    try:
        _no_detach(reply, _TEST)
    except AssertionError as exc:
        assert _PROTECTED in str(exc), (
            "the guard fired but did not name the source it protected, so a "
            "reader cannot tell which finding it is complaining about"
        )
        return
    raise AssertionError(
        "the summary skip now swallows a detach recommended in a finding "
        "section, which is the failure feedback case #1536 was filed on"
    )


def test_missing_index_error_source_still_fails_rather_than_skipping():
    """Skipping here is what let this guard run on zero tests once already."""
    try:
        _no_detach(_R4K_SUMMARY, {"tags": ["index-discrepancy"], "type": "positive"})
    except AssertionError as exc:
        assert "index_error_source" in str(exc)
        return
    raise AssertionError("a tagged test with no protected source must fail loudly")


# --- the detach guard's negation scoping, both directions ----------------
#
# The corpus replay below cannot test the firing direction: in a replay the
# guard is its own ground truth. These are the cases that hold it.

_DETACH_RECOMMENDED = {
    "plain": "Minnesota Death Index: detach it from the profile.",
    "hedge": "The Minnesota Death Index may belong to someone else; consider detaching it.",
    "negation_in_earlier_clause": (
        "Do not trust the Minnesota Death Index, detach it."
    ),
    "negation_then_but": (
        "Minnesota Death Index: do not keep it but detach it."
    ),
    "em_dash_1536": (
        "**Finding 1 \u2014 Minnesota Death Index.** The record is not about "
        "this Christian Hole \u2014 detach it from the profile."
    ),
    "en_dash": (
        "Minnesota Death Index: the record is not about this Christian Hole "
        "\u2013 detach it."
    ),
    "spaced_hyphen": (
        "Minnesota Death Index: the record is not about this Christian Hole "
        "- detach it."
    ),
    # A negation elsewhere in the clause, belonging to another verb.
    "not_about_should_be_detached": (
        "Minnesota Death Index: the record is not about this man and should "
        "be detached."
    ),
    "would_not_hesitate": (
        "Minnesota Death Index: I would not hesitate to detach it."
    ),
    "cannot_be_his_so_detach": (
        "Minnesota Death Index cannot be his record so detach it."
    ),
    "does_not_fit_recommend_detaching": (
        "The Minnesota Death Index does not fit him and I recommend detaching "
        "it."
    ),
}

_DETACH_RULED_OUT = {
    "do_not": (
        "Minnesota Death Index \u2026 Do not detach \u2014 the source is good "
        "evidence for this person with one wrong field."
    ),
    "rather_than": (
        "Minnesota Death Index: keep it attached rather than detaching it."
    ),
    "never": "Never detach the Minnesota Death Index over one field.",
    "should_not_be_detached": "Minnesota Death Index should not be detached.",
    "no_detach_term": (
        "Minnesota Death Index: re-read the original and correct the index."
    ),
}


@pytest.mark.parametrize(
    "reply", _DETACH_RECOMMENDED.values(), ids=_DETACH_RECOMMENDED.keys()
)
def test_detach_guard_fires_on_a_recommendation(reply):
    with pytest.raises(AssertionError, match=_PROTECTED):
        _no_detach(reply, _TEST)


@pytest.mark.parametrize(
    "reply", _DETACH_RULED_OUT.values(), ids=_DETACH_RULED_OUT.keys()
)
def test_detach_guard_is_quiet_when_detach_is_ruled_out(reply):
    _no_detach(reply, _TEST)


# --- replay against the committed corpus --------------------------------


def test_both_guards_pass_on_every_committed_positive_run():
    """The half a synthetic case cannot cover: the real replies, as shipped.

    Synthetic strings prove the branch logic; only this asserts the guards
    agree with the corpus. A future widening that breaks a real reply fails
    here rather than inside the next paid run.
    """
    logs = sorted(
        p for p in glob.glob(
            str(_REPO / "eval/runlogs/unit/source-evaluation/v1_*.json")
        )
        if not p.endswith(".ann.json")
    )
    assert logs, "no committed source-evaluation run logs found"
    checked = 0
    for path in logs:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        for entry in log.get("tests") or []:
            if entry.get("test_type") != "positive":
                continue
            for run in entry.get("runs") or []:
                output = run.get("output") or {}
                reply = (output.get("text_response") or "").strip()
                if not reply:
                    continue
                protected = _PROTECTED if "Hole" in reply else "Drouin Collection"
                if protected.lower() not in reply.lower():
                    continue
                test = dict(_TEST, index_error_source=protected)
                _recommends_reread(reply, test)
                _no_detach(reply, test)
                checked += 1
    assert checked, "replayed no positive runs — the corpus reader is broken"


# --- the direct arm: the agent's return is the reply (issue #2796) --------
#
# On a direct test the main thread only relays the agent's return, so the two
# reply guards grade `subject_reply_text`, never the relay.

_DIRECT = dict(_TEST, delegation="Evaluate the sources on KD96-TV2.")
_DETACH_PROTECTED = (
    "Minnesota Death Index, 1908-2002 - wrong person. "
    "Next: detach the Minnesota Death Index from this profile."
)


def _returns(text: str) -> list[dict]:
    return [{"subagent_type": "source-evaluation", "text": text}]


def test_direct_arm_grades_the_agents_return_not_the_relay():
    # A clean relay over a detaching agent return must fail ...
    try:
        _no_detach(_M8Q_REMEDY, _DIRECT, agent_returns=_returns(_DETACH_PROTECTED))
    except AssertionError:
        pass
    else:
        raise AssertionError("the detach guard read the relay instead of the agent's return")
    # ... and a clean agent return under a relay that says nothing passes.
    _recommends_reread("Done.", _DIRECT, agent_returns=_returns(_M8Q_REMEDY))
    _no_detach("Done.", _DIRECT, agent_returns=_returns(_M8Q_REMEDY))


def test_direct_arm_silent_agent_fails_even_when_the_relay_is_right():
    try:
        _recommends_reread(_M8Q_REMEDY, _DIRECT, agent_returns=[])
    except AssertionError:
        return
    raise AssertionError("a silent agent passed on the relay's words")


def test_another_agents_return_is_not_the_subjects():
    try:
        _recommends_reread(
            "Done.", _DIRECT,
            agent_returns=[{"subagent_type": "check-warnings", "text": _M8Q_REMEDY}],
        )
    except AssertionError:
        return
    raise AssertionError("an unrelated agent's return was graded as the audit")


# --- the front-door hand-back (ut_source_evaluation_b6h) ------------------
#
# b6h is `grade_on_invariant`, so this validator is that test's whole verdict.

_handback = _VALIDATOR.test_scope_handback_calls_no_tool
_HB_TEST = {
    "tags": ["scope-handback", "handback-to-conflict-resolution", "direct-arm"],
    "delegation": "which one should I believe?",
}
_HB_REPLY = "Hand-back: conflict-resolution — which of two disagreeing sources to believe."


def test_handback_passes_a_clean_handback():
    _handback([], "", _HB_TEST, agent_returns=_returns(_HB_REPLY))


def test_handback_passes_a_backticked_name_beside_a_builtin_read():
    calls = [{"tool": "Read", "args": {"file_path": "research.json"}}]
    _handback(calls, "", _HB_TEST,
              agent_returns=_returns("Hand-back: `conflict-resolution` — a source conflict."))


def test_handback_fails_on_any_mcp_call():
    calls = [{"tool": "mcp__genealogy__person_read", "args": {"personId": "KD96-TV2"}}]
    try:
        _handback(calls, "", _HB_TEST, agent_returns=_returns(_HB_REPLY))
    except AssertionError as exc:
        assert "person_read" in str(exc)
        return
    raise AssertionError("an audit started before the hand-back passed")


def test_handback_fails_on_the_wrong_destination_or_none():
    for reply in ("Hand-back: check-warnings — impossible dates.",
                  "Please take this to the conflict workflow.", ""):
        try:
            _handback([], "", _HB_TEST, agent_returns=_returns(reply))
        except AssertionError as exc:
            assert "Hand-back: conflict-resolution" in str(exc)
            continue
        raise AssertionError(f"passed on {reply!r}")


def test_handback_fails_when_only_the_relay_names_the_destination():
    try:
        _handback([], _HB_REPLY, _HB_TEST, agent_returns=_returns("I compared the two censuses."))
    except AssertionError:
        return
    raise AssertionError("graded the relay, not the agent")


def test_handback_needs_exactly_one_destination_tag():
    try:
        _handback([], "", {"tags": ["scope-handback"], "delegation": "x"}, agent_returns=_returns(_HB_REPLY))
    except AssertionError as exc:
        assert "handback-to-" in str(exc)
        return
    raise AssertionError("an untargeted hand-back test passed")


def test_handback_skips_an_untagged_test():
    import pytest

    with pytest.raises(pytest.skip.Exception):
        _handback([], "", {"tags": ["direct-arm"]})


# --- a per-source verdict LIST (x6b, v1_2026-10-01_18-58-11) --------------

_X6B_LIST = (
    "- **1900 United States Census** — keep; the household, place, and dates all fit.\n"
    "- **Minnesota Death Index, 1908-2002** — keep, but the indexed death year (1954) needs correction to 1945.\n"
    "- **Funeral card and photograph (uploaded memory)** — cannot be verified from an index read.\n"
    "- **Minnesota State Census, 1885** — detach; it records a different Christian Hole, born 1852, in a "
    "different county with a different family. That man is already on the tree as KD96-WX7."
)


def test_a_per_source_verdict_list_passes():
    _no_detach(_X6B_LIST, _TEST)


def test_a_detach_on_the_protected_sources_own_bullet_still_fails():
    for reply in (
        _X6B_LIST.replace("— keep, but the indexed death year (1954) needs correction to 1945.",
                          "— detach it; the year is wrong."),
        "1. Minnesota Death Index, 1908-2002 — wrong year.\n2. 1900 census — keep.",
    ):
        if "wrong year" in reply:
            reply = reply.replace("wrong year.", "wrong year, so detach it.")
        try:
            _no_detach(reply, _TEST)
        except AssertionError:
            continue
        raise AssertionError(f"a detach on the protected source's bullet passed: {reply!r}")


def test_a_detach_on_a_continuation_line_stays_with_its_bullet():
    reply = (
        "- Minnesota Death Index, 1908-2002 — the year is off by nine.\n"
        "  Detach it from this profile.\n"
        "- Minnesota State Census, 1885 — keep."
    )
    try:
        _no_detach(reply, _TEST)
    except AssertionError:
        return
    raise AssertionError("a continuation line's detach was split off its source")


# --- the checklist does not restate a finding (o3c, issue #2796 finding 3) -

_restate = _VALIDATOR.test_checklist_does_not_restate_a_finding
_OVERLAP = json.loads(
    (_REPO / "eval/fixtures/mcp/person-quality-hole-detail-overlap.json").read_text(encoding="utf-8")
)
_OV_CALLS = [{"tool": "mcp__genealogy__person_quality", "response": _OVERLAP["response"]}]
_OV_TEST = {"tags": ["checklist-overlap", "direct-arm"], "delegation": "audit KD96-TV2"}
_DEATH_LINE = next(i["sentence"] for i in _OVERLAP["response"]["issues"] if i["conclusionType"] == "DEATH")


def test_checklist_pointer_passes():
    reply = (
        "From FamilySearch's own profile checklist:\n  CONSISTENCY\n"
        "    · FamilySearch flags this death date too — finding 1 above.\n"
        "    · It flags the birth date against the 1885 census — finding 2 above.\n"
        "  VERIFIABILITY\n    · The marriage has no tagged sources."
    )
    _restate(_OV_CALLS, "", _OV_TEST, agent_returns=_returns(reply))


def test_checklist_verbatim_restatement_fails_even_rewrapped():
    wrapped = _DEATH_LINE.replace(", which", ",\n      which")
    for line in (_DEATH_LINE, wrapped):
        try:
            _restate(_OV_CALLS, "", _OV_TEST, agent_returns=_returns("CONSISTENCY\n    · " + line))
        except AssertionError as exc:
            assert "restated a finding" in str(exc)
            continue
        raise AssertionError(f"a verbatim restatement passed: {line!r}")


def test_checklist_guard_fails_when_no_consistency_issue_reached_the_run():
    try:
        _restate([], "", _OV_TEST, agent_returns=_returns("anything"))
    except AssertionError as exc:
        assert "checks nothing" in str(exc)
        return
    raise AssertionError("an empty sweep passed")


def test_checklist_guard_skips_an_untagged_test():
    import pytest

    with pytest.raises(pytest.skip.Exception):
        _restate(_OV_CALLS, "", {"tags": ["direct-arm"]})


# --- a checklist pointer carries no action (o3c, v1_2026-10-02_10-48-01) ---

_pointer = _VALIDATOR.test_checklist_pointer_carries_no_action
_O3C_RETURN = (
    "Next: detach this source from Christian P. Hole (KD96-TV2). The record belongs to the "
    "other Christian Hole (KD96-WX7).\n\n---\n\n"
    "From FamilySearch's own profile checklist — suggestions for the profile, not errors in a "
    "source, and not counted above:\n\n"
    "**CONSISTENCY**\n"
    "- FamilySearch flags the death date discrepancy too — finding 2 above.\n"
    "- FamilySearch flags the birth year discrepancy from the 1885 census too — finding 3 above "
    "(the record is misattributed and should be detached).\n\n"
    "**VERIFIABILITY**\n- The marriage has no tagged sources.\n\n"
    "**COMPLETENESS**\n- A marriage place is missing a city."
)
_O3C_CLEAN = _O3C_RETURN.replace(
    " (the record is misattributed and should be detached)", ""
)


def _pointer_fails(reply: str, why: str) -> None:
    try:
        _pointer("", _OV_TEST, agent_returns=_returns(reply))
    except AssertionError as exc:
        assert why in str(exc), str(exc)
        return
    raise AssertionError(f"passed: {reply[-300:]!r}")


def test_the_o3c_pointer_with_a_detach_fails():
    assert _O3C_CLEAN != _O3C_RETURN
    _pointer_fails(_O3C_RETURN, "carries an action")


def test_a_pointer_carrying_any_remedy_fails():
    for tail in (
        "finding 1 above. Re-read the original.",
        "finding 1 above; correct the index entry.",
        "finding 1 above, so keep the source attached.",
        "finding 1 above — this one needs to be fixed.",
    ):
        _pointer_fails(f"**CONSISTENCY**\n- FamilySearch flags this death date too — {tail}", "carries an action")


def test_bare_pointers_pass_in_any_heading_style():
    _pointer("", _OV_TEST, agent_returns=_returns(_O3C_CLEAN))
    _pointer("", _OV_TEST, agent_returns=_returns(
        "From FamilySearch's own profile checklist:\n  CONSISTENCY\n"
        "    · FamilySearch flags this death date too — finding 1 above.\n"
        "    · It flags the birth date against the 1885 census — Finding 2 above.\n"
        "  VERIFIABILITY\n    · The marriage has no tagged sources."
    ))


def test_a_findings_own_next_line_is_out_of_scope():
    reply = (
        "Finding 2 — death index. Same discrepancy as finding 1 above. Next: re-read the original.\n\n"
        "### CONSISTENCY\n- FamilySearch flags this death date too — finding 2 above.\n"
        "### VERIFIABILITY\n- The marriage has no tagged sources — keep in mind (see finding 2 above, correct it)."
    )
    _pointer("", _OV_TEST, agent_returns=_returns(reply))


def test_pointer_guard_fails_when_it_has_nothing_to_check():
    for reply in (
        "From FamilySearch's own profile checklist:\n- The marriage has no tagged sources.",
        "**CONSISTENCY**\n- The death date disagrees with the index.\n**VERIFIABILITY**\n- x",
        "",
    ):
        _pointer_fails(reply, "checks nothing")


# --- a multi-source closing paragraph (x6b, v1_2026-10-01_19-24-15) -------

_X6B_PARAGRAPH = (
    "Of the four attached sources, two belong on the profile without question: the 1900 U.S. Census "
    "(which fits name, household, Polk County residence, and Norwegian birth) and the Minnesota Death "
    "Index (which fits everything except a death year that needs verification against the original "
    "certificate). The uploaded funeral card is plausible but unverifiable from the index. The 1885 "
    "Minnesota State Census should be detached — it documents a different Christian Hole, born 1852, "
    "residing in Otter Tail County, whose own profile (KD96-WX7) already holds the record correctly."
)


def test_a_detach_sentence_naming_another_record_passes():
    _no_detach(_X6B_PARAGRAPH, _TEST)
    _no_detach(
        "The Minnesota Death Index gives 1954 against the profile's 1945. "
        "The 1885 Minnesota State Census belongs to another man and should be detached.",
        _TEST,
    )
    for tail in (
        "belongs to another man and must be detached.",
        "belongs to another man and so should be detached.",
        "is another man's record and is to be detached.",
        "documents another family and needs to be detached.",
        "should be detached.",
    ):
        _no_detach(
            "The Minnesota Death Index gives 1954 against the profile's 1945. "
            "The 1885 Minnesota State Census " + tail,
            _TEST,
        )


def test_a_detach_sentence_that_names_no_record_still_fails():
    for reply in (
        "The Minnesota Death Index has the wrong year. Detach it.",
        "The Minnesota Death Index has the wrong year. The index should be detached.",
        "The Minnesota Death Index is wrong. Detach the Minnesota Death Index.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. Detach the Death Index record.",
        "The Minnesota Death Index gives 1954 against 1945. This Index entry should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. Unlike the 1900 Census, it does not fit him, so detach it.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. Detach it and rely on the 1900 Census instead.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. Unlike the 1900 Census, it should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. It does not match the 1900 Census and should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. Unlink it and rely on the 1900 Census instead.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. Detach the entry and rely on the 1900 Census instead.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. Detach the record and keep the 1900 Census.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. The 1900 Census agrees with 1945 and the index entry should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. The Census shows he lived to 1945 so it should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. The 1900 Census proves the year wrong: it should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. The 1900 Census proves the year wrong; it should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. Unlike the 1900 Census, detach.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. Detach the Death Index and keep the 1900 Census.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. The Death Index should be detached, not the 1900 Census.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. The 1900 Census agrees with 1945 but this entry should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. The 1900 Census agrees with 1945 and hence the entry should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. The 1900 Census agrees with 1945 and thus it should be detached.",
        "The Minnesota Death Index gives 1954 against the profile's 1945. The 1900 Census agrees with 1945 while the index entry should be detached.",
        *(
            "The Minnesota Death Index gives 1954 against the profile's 1945. The 1900 Census agrees with 1945 " + tail
            for tail in (
                "and consequently the entry should be detached.",
                "and accordingly the entry should be detached.",
                "and as a result the entry should be detached.",
                "and now the entry should be detached.",
                "whereas the entry should be detached.",
                "although the entry should be detached.",
                "yet the entry should be detached.",
                "meaning the entry should be detached.",
                "and his index entry should be detached.",
                "and Death Index entry should be detached.",
                "because the entry should be detached.",
                "unless the entry should be detached.",
                "or the entry should be detached.",
                "(the entry should be detached).",
                "— the entry should be detached.",
            )
        ),
        *(
            "The Minnesota Death Index gives 1954 against the profile's 1945. " + second
            for second in (
                "The 1900 Census agrees with 1945 because the entry is wrong and should be detached.",
                "The 1900 Census agrees with 1945 while the index does not and should be detached.",
                "The 1900 Census shows the index is wrong and so should be detached.",
                "The 1900 Census agrees with 1945 but the index entry does not and must be detached.",
                "The 1900 Census agrees with 1945 and the index disagrees and should be detached.",
                "The Census has 1945 though the Index has 1954 and is to be detached.",
            )
        ),
        _X6B_PARAGRAPH + " Detach it as well.",
    ):
        try:
            _no_detach(reply, _TEST)
        except AssertionError:
            continue
        raise AssertionError(f"a detach left attributed to the protected source passed: {reply!r}")
