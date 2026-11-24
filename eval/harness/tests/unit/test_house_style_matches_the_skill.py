"""The validator's copy of the narration string must equal the one that ships.

`project_create` writes one `narration_guidance` string on every create, from the
engine constant `HOUSE_RESEARCHER_PROFILE` (issue #3384; it moved there from
`agents/init-project.md`), and `validators/test_init_project.py` holds its own copy as
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
normalisation beyond joining the constant's string literals, because "verbatim" is the
property under test and a comparison that forgives whitespace would forgive the
drift too.
"""

from __future__ import annotations

import html
import json
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
#: The string ships in the engine: `project_create` writes the profile itself
#: (issue #3384), so the agent body no longer carries a copy.
ENGINE = REPO / "packages" / "engine" / "mcp-server" / "src" / "tools" / "project-create.ts"


def _shipped_guidance() -> str:
    """`HOUSE_RESEARCHER_PROFILE.narration_guidance`: its double-quoted literals,
    joined as the `+` concatenation joins them.

    Anchored on the constant and its field, so a second string elsewhere in the
    file is never read. Every literal up to the field's closing comma counts:
    reading only the first would leave this green while a later line drifted.
    """
    text = ENGINE.read_text(encoding="utf-8")
    m = re.search(
        r"export const HOUSE_RESEARCHER_PROFILE = \{.*?narration_guidance:\s*((?:\"[^\"\\]*\"\s*\+?\s*)+),",
        text,
        re.DOTALL,
    )
    assert m, (
        "could not find HOUSE_RESEARCHER_PROFILE.narration_guidance in project-create.ts. "
        "If the declaration changed, fix THIS locator -- do not delete the test, "
        "which is the only free check that the two copies agree."
    )
    return "".join(re.findall(r"\"([^\"\\]*)\"", m.group(1)))


def test_the_engine_still_carries_the_narration_guidance():
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
        "HOUSE_RESEARCHER_PROFILE.narration_guidance have diverged.\n"
        f"  engine:        {_shipped_guidance()!r}\n"
        f"  _HOUSE_STYLE:  {_HOUSE_STYLE!r}\n"
        "Change BOTH, and the four other verbatim copies that "
        "test_the_seeded_copies_carry_the_shipped_string and "
        "test_the_documented_copies_carry_the_shipped_string compare."
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


@pytest.mark.parametrize(
    "phrase",
    [
        "Never sound surer than the evidence was rated",
        "probably for a likely one",
        "possibly for a tentative one",
        "never write that someone is the parent, spouse or child of another",
        "Say match or search result, never hit",
        "never write ARK",
    ],
)
def test_the_hedging_and_plain_word_clauses_survive(phrase):
    """Professional genealogists read our replies as too sure ("John is the father"
    where the evidence was only rated likely) and full of our own words ("hits",
    "ARK"). The fix is these clauses: the reply's certainty follows the rating the
    project already recorded, in the words the viewer's `statusLabelMap` shows for
    it (well established / likely / tentative), so the chat never sounds surer
    than the card beside it.

    Pinned per-phrase so the failure names which clause went.
    """
    assert phrase in _HOUSE_STYLE


@pytest.mark.parametrize(
    "phrase",
    [
        "never a tree or source id",
        "the one identifier you may add is the FamilySearch ID of a person",
        "copied from the data",
        "when the person is not yet in the project tree",
    ],
)
def test_the_familysearch_id_exception_survives(phrase):
    """A tester read "she is in the tree as I13" as meaningless (issue #4669). The
    lead ruled a person's FamilySearch ID is the one identifier narration may show,
    because it is the user's own name for a person, while tree ids, source ids and
    ARKs stay banned. "copied from the data" is there because a PID typed from
    memory or read out of an ARK can point at a different, real person.

    Pinned per-phrase so the failure names which clause went.
    """
    assert phrase in _HOUSE_STYLE


def _template_guidance() -> str:
    path = REPO / "eval" / "harness" / "e2e" / "templates" / "starting-research.json"
    return json.loads(path.read_text(encoding="utf-8"))["researcher_profile"]["narration_guidance"]


def _mock_agent_guidance() -> str:
    path = REPO / "apps" / "server" / "app" / "agent" / "mock_agent.py"
    m = re.search(r"^_NARRATION = '([^'\\]*)'$", path.read_text(encoding="utf-8"), re.MULTILINE)
    assert m, "could not find mock_agent.py's _NARRATION; fix this locator, do not delete the test"
    return m.group(1)


@pytest.mark.parametrize("read", [_template_guidance, _mock_agent_guidance], ids=["e2e-template", "mock-agent"])
def test_the_seeded_copies_carry_the_shipped_string(read):
    """The e2e template seeds every e2e project, so a stale copy there would
    measure every future e2e reply against the OLD string; the mock agent stands
    in for production's project. Both were hand-copied and nothing compared them."""
    assert read() == _shipped_guidance()


def _e2e_spec_guidance() -> str:
    path = REPO / "docs" / "specs" / "e2e-test-spec.md"
    m = re.search(r'^\s*"narration_guidance": "([^"\\]*)"', path.read_text(encoding="utf-8"), re.MULTILINE)
    assert m, "could not find e2e-test-spec.md's narration_guidance; fix this locator, do not delete the test"
    return m.group(1)


def _onboarding_slides_guidance() -> str:
    path = REPO / "docs" / "onboarding-slides.html"
    m = re.search(r"<em>(Plain language for someone[^<]*)</em>", path.read_text(encoding="utf-8"))
    assert m, "could not find onboarding-slides.html's house text; fix this locator, do not delete the test"
    return html.unescape(m.group(1))


@pytest.mark.parametrize("read", [_e2e_spec_guidance, _onboarding_slides_guidance], ids=["e2e-spec", "onboarding-slides"])
def test_the_documented_copies_carry_the_shipped_string(read):
    assert read() == _shipped_guidance()
