"""Direct tests for `test_decline_names_a_death_record`.

Same reason as the sibling validator tests: nothing under `validators/` is
collected by `make harness-test`, so a validator's pass/fail set otherwise
appears only inside a paid per-skill run.

The failing cases are the writes two real runs of
`ut_research_exhaustiveness_022` made on 2026-11-17, which the judge passed.
"""

import copy
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased: pyproject.toml collects `test_*`.
from test_research_exhaustiveness import (  # noqa: E402
    test_decline_names_a_death_record as _death_fn,
)

_SCENARIOS = Path(__file__).resolve().parents[3] / "fixtures" / "scenarios"
_TEST = {"tags": ["research-exhaustiveness", "death-record-gap"]}
BEFORE = json.loads(
    (_SCENARIOS / "recent-birth-no-death-record" / "research.json").read_text(encoding="utf-8")
)

_SEALED = {"kind": "privacy_sealed", "log_entry_id": None, "wiki_title": None,
           "description": "Alan Glen Applegarth 1936 Utah birth certificate (pli_004), sealed by privacy law."}
_DEATH = {"kind": "deferred", "log_entry_id": None, "wiki_title": None,
          "description": "Utah death certificate for Alan Glen Applegarth, d. 2023 Cache County. Never searched."}
_OBITUARY = {"kind": "deferred", "log_entry_id": None, "wiki_title": None,
             "description": "Obituary of Alan Glen Applegarth (d. 2023, Cache County, Utah), not searched."}
# The committed run v6_2026-11-17_22-30-22, run 0.
_BIRTH_DEFERRED = {"kind": "deferred", "log_entry_id": None, "wiki_title": "Utah_Vital_Records",
                   "description": "Utah 1936 birth certificate for Alan Glen Applegarth (Ogden, Weber County), "
                                  "which would name parents directly. Recorded as privacy-sealed (release to "
                                  "registrant or direct heir on request); an heir request has not been attempted."}
# Scratch run 11-obituary-clause-x10, run 4.
_BIRTH_SKIPPED = {"kind": "skipped_plan_item", "log_entry_id": None, "wiki_title": None,
                  "description": "pli_004: Utah 1936 birth certificate (Utah Dept. of Health / Ancestry). Skipped "
                                 "with the recorded reason that Utah seals birth records for about 100 years."}
_BIRTH_JUSTIFICATION = ("Overturn risk: high \u2014 Alan's own 1936 Utah birth record would name his parents "
                        "directly, and Utah has kept civil birth registration since 1905.")
_DEATH_JUSTIFICATION = ("Overturn risk: high \u2014 Alan's 2023 Utah death certificate was never searched and "
                        "could name different parents.")


def _declined(justification: str, not_reached: list[dict]) -> dict:
    after = copy.deepcopy(BEFORE)
    after["questions"][0]["search_stop"] = {
        "stopped_because": "resources_spent",
        "justification": justification,
        "log_entry_ids": ["log_001", "log_002", "log_003"],
        "stop_criteria": None,
        "not_reached": not_reached,
    }
    return after


def _run(after: dict, test: dict = _TEST) -> None:
    try:
        _death_fn({"research_json": BEFORE}, {"research_json": after}, test)
    except pytest.skip.Exception as exc:  # a skip here would hide the check
        raise AssertionError(f"validator skipped: {exc}") from exc


def test_skips_without_the_tag():
    with pytest.raises(pytest.skip.Exception):
        _death_fn({"research_json": BEFORE},
                  {"research_json": _declined(_BIRTH_JUSTIFICATION, [_BIRTH_DEFERRED])},
                  {"tags": ["research-exhaustiveness"]})


def test_fails_when_nothing_was_written():
    with pytest.raises(AssertionError, match="search_stop was written"):
        _run(copy.deepcopy(BEFORE))


def test_fails_when_no_death_record_is_named():
    with pytest.raises(AssertionError, match="names a death certificate"):
        _run(_declined(_BIRTH_JUSTIFICATION, [_BIRTH_SKIPPED]))


def test_fails_when_the_birth_certificate_is_deferred_even_with_the_death_record_named():
    with pytest.raises(AssertionError, match="birth certificate is a `deferred` search") as err:
        _run(_declined(_DEATH_JUSTIFICATION, [_DEATH, _BIRTH_DEFERRED]))
    assert "names a death certificate" not in str(err.value)


def test_passes_on_the_death_certificate_in_not_reached_only():
    _run(_declined("Overturn risk: low. The censuses and the marriage agree.", [_SEALED, _DEATH]))


def test_passes_on_the_death_certificate_in_justification_only():
    _run(_declined(_DEATH_JUSTIFICATION, [_SEALED]))


def test_passes_on_the_obituary():
    _run(_declined("Overturn risk: low. The censuses and the marriage agree.", [_OBITUARY]))


def test_passes_on_other_spellings_of_the_death_record():
    for wording in ("certificate of death", "death\nrecord", "Death Registration", "funeral notice"):
        _run(_declined(f"Overturn risk: high \u2014 Alan's 2023 {wording} was never searched.", [_SEALED]))


def test_a_deferred_birth_announcement_is_not_the_birth_certificate():
    announcement = {"kind": "deferred", "log_entry_id": None, "wiki_title": None,
                    "description": "1936 Ogden newspaper birth announcements for Alan Applegarth, not searched."}
    _run(_declined(_DEATH_JUSTIFICATION, [_DEATH, announcement]))


# --- `death-certificate-gap`: ut_research_exhaustiveness_017 -------------
# The project holds the obituary, so the obituary is in every write and only
# the certificate itself can show the decline rests on the right record.

_STRICT = {"tags": ["research-exhaustiveness", "death-certificate-gap"]}
_OBITUARY_HELD = ("Overturn risk: low. The censuses, the marriage and the 2023 obituary agree on the parents. "
                  "Not consulted: the original image of the 1926 marriage register.")


def test_strict_fails_on_a_decline_that_names_only_the_obituary():
    with pytest.raises(AssertionError, match="names a death certificate"):
        _run(_declined(_OBITUARY_HELD, [_SEALED, _OBITUARY]), _STRICT)


def test_strict_fails_on_a_decline_for_another_record():
    with pytest.raises(AssertionError, match="names a death certificate"):
        _run(_declined(_OBITUARY_HELD, [_SEALED]), _STRICT)


def test_strict_fails_when_the_death_certificate_is_listed_sealed():
    invented = {"kind": "privacy_sealed", "log_entry_id": None, "wiki_title": None,
                "description": "Alan's 2023 Utah death certificate, restricted for 50 years."}
    with pytest.raises(AssertionError, match="a seal the project never records"):
        _run(_declined(_OBITUARY_HELD, [_SEALED, invented]), _STRICT)


def test_strict_still_fails_a_deferred_birth_certificate():
    with pytest.raises(AssertionError, match="birth certificate is a `deferred` search"):
        _run(_declined(_DEATH_JUSTIFICATION, [_DEATH, _BIRTH_DEFERRED]), _STRICT)


def test_strict_passes_on_the_death_certificate_with_the_obituary_also_mentioned():
    _run(_declined(_OBITUARY_HELD + " Alan's own 2023 death record is never mentioned in the project.",
                   [_SEALED, _DEATH]), _STRICT)
    _run(_declined("Overturn risk: high — the Certificate of Death was never searched or recorded as sealed.",
                   [_SEALED]), _STRICT)
