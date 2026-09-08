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
