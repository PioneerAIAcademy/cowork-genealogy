"""Direct tests for `test_research_plan_reads_locality_rows`.

Nothing under `validators/` is collected by `make harness-test`, so without these the
validator's pass/fail set would appear only inside a paid per-skill run (issue #4602).
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

# Aliased away from the `test_` prefix so pytest does not collect it.
from test_research_plan import (  # noqa: E402
    test_research_plan_reads_locality_rows as check_rows,
)

TAGGED = {"id": "ut_research_plan_rws", "tags": ["planning", "reads-locality-rows"]}
BEFORE = {"research_json": {"plans": []}}


def _after(*items):
    plan = {"id": "pl_001", "question_id": "q_003", "status": "active", "items": [
        {"id": f"pli_{n:03d}", "record_type": rt, "rationale": why, "jurisdiction": "Schuylkill County, Pennsylvania"}
        for n, (rt, why) in enumerate(items, 1)
    ]}
    return {"research_json": {"plans": [plan]}}


BAPTISM = ("church", "Margaret's baptism, about 1897, in the Catholic parish registers (loc_001).")


@pytest.mark.parametrize(
    "why",
    [
        "Margaret's birth about 1897 in the county orphans' court birth register (loc_001 court row).",
        "Births 1893-1905 were registered by the county, held with the Orphans Court records (loc_001).",
        "Search the county birth register, which covers 1893 to 1906, for Margaret's birth.",
    ],
)
def test_passes_on_an_item_naming_the_register(why):
    check_rows(BEFORE, _after(BAPTISM, ("court", why)), TAGGED)


@pytest.mark.parametrize(
    "items",
    [
        [BAPTISM],
        [BAPTISM, ("probate", "Patrick's estate file at the Register of Wills may name his daughter.")],
        [BAPTISM, ("court", "Orphans' court guardianship dockets, if Patrick died while she was a minor.")],
        [("vital_record", "Pennsylvania state birth certificate for Margaret, 1897.")],
    ],
    ids=["baptism-only", "probate", "orphans-court-without-birth", "state-certificate"],
)
def test_fires_when_no_item_names_the_register(items):
    with pytest.raises(AssertionError, match="no plan item uses the birth register"):
        check_rows(BEFORE, _after(*items), TAGGED)


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check_rows(BEFORE, _after(BAPTISM), {"id": "ut_research_plan_005", "tags": ["planning"]})


def test_a_mapped_test_must_carry_the_tag():
    with pytest.raises(AssertionError, match="no 'reads-locality-rows' tag"):
        check_rows(BEFORE, _after(BAPTISM), {"id": "ut_research_plan_rws", "tags": ["planning"]})
