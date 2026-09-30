"""The validator's copy of the narration string must equal the one that ships.

`init-project/SKILL.md` tells the skill to store one `narration_guidance` string
"verbatim", and `validators/test_init_project.py` holds its own copy as
`_HOUSE_STYLE` and asserts exact equality against what a run actually wrote --
"stored verbatim, not paraphrased".

NOTHING TIED THE TWO COPIES TOGETHER. `_HOUSE_STYLE` was referenced only by that
validator, which runs **only inside a paid per-skill eval**, and by unit tests
that feed it in as INPUT and so agree with it by construction. So editing the
string in SKILL.md and forgetting the constant -- or the reverse -- reddened
every `ut_init_project_*` test, and the only way to find out was to spend $8-12
on a run. A phase-5 plan draft proposed exactly that edit and priced no such
cost, because nothing free was there to say it existed.

This closes that with a string comparison. It is deliberately dumb: no
normalisation beyond stripping the blockquote marker, because "verbatim" is the
property under test and a comparison that forgives whitespace would forgive the
drift too.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

# `validators/` is not a package on the import path by default -- same two lines
# `test_init_project_provenance_validators.py` uses.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_init_project import _HOUSE_STYLE  # noqa: E402

REPO = Path(__file__).resolve().parents[4]
SKILL = REPO / "packages" / "engine" / "plugin" / "skills" / "init-project" / "SKILL.md"


def _shipped_guidance() -> str:
    """The blockquote immediately after the line that introduces it.

    Anchored on the introducing sentence rather than on a line number, which
    moves, or on "the first blockquote", which would silently start matching a
    different one if a quote were added above it.
    """
    text = SKILL.read_text(encoding="utf-8")
    m = re.search(
        r"this `narration_guidance`, stored verbatim:\s*\n+> (.+?)\n",
        text,
        re.DOTALL,
    )
    assert m, (
        "could not find the narration_guidance blockquote in SKILL.md. If the "
        "surrounding wording changed, fix THIS locator -- do not delete the test, "
        "which is the only free check that the two copies agree."
    )
    return m.group(1).strip()


def test_the_skill_still_carries_a_narration_guidance_blockquote():
    """A zero-length find proves nothing, so the locator is asserted separately
    from the comparison: a test that silently matched nothing would pass forever."""
    shipped = _shipped_guidance()
    assert shipped
    assert len(shipped) > 80, f"suspiciously short guidance: {shipped!r}"


def test_house_style_is_byte_identical_to_the_shipped_string():
    """The whole point. If this fails, one of the two copies moved and every
    `ut_init_project_*` run is about to go red at $8-12 a time."""
    assert _shipped_guidance() == _HOUSE_STYLE, (
        "validators/test_init_project.py::_HOUSE_STYLE and "
        "init-project/SKILL.md's narration_guidance have diverged.\n"
        f"  SKILL.md:      {_shipped_guidance()!r}\n"
        f"  _HOUSE_STYLE:  {_HOUSE_STYLE!r}\n"
        "Change BOTH, and see docs/plan/research-as-a-job-phase5-prose.md for the "
        "four other verbatim copies that also have to move."
    )


@pytest.mark.parametrize(
    "phrase",
    [
        "Do not narrate between actions",
        "report once when the step is done",
        "what happens next in one sentence",
    ],
)
def test_the_clause_and_its_sanctioned_report_both_survive(phrase):
    """Phase 5 decided (owner, 2026-09-30) to keep the string as it stands.

    A draft of that phase read the prohibition and the forward sentence as
    contradicting each other and proposed dropping one. They do not: the
    semicolon carves the once-per-step report OUT of the prohibition, so
    "between actions" bans interim paragraphs while the one sanctioned report
    may close with a forward sentence. Dropping the prohibition would newly
    PERMIT the interim chatter it exists to ban.

    Pinned per-phrase so the failure names which half went.
    """
    assert phrase in _HOUSE_STYLE
