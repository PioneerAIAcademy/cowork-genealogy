"""The narration figures report must not call sub-agent prose "what a reader sees".

`make e2e-narration-figures` derives figures the later-phases plan builds product
rules on. One of them -- the share of paragraphs opening "Now..." / "Let me..." --
was already corrected once, from a believed 18% to a measured 8.8%, and the plan
records that correction as load-bearing.

**That 8.8% is still a mixed-population figure.** `foldChatEvent` drops all
sub-agent prose, so a paragraph a sub-agent wrote never reaches the screen; and
`packages/engine/plugin/agents/record-extractor.md:62` says that agent does not
even apply the researcher profile, so the narration rule does not govern it. On
the 133-minute McAndrew capture the split is stark: 9.2% of the FEED opens that
way and 3.7% of the SCREEN does, because 19 of its 26 openers are sub-agent.

So the report now splits by thread, and this module pins the part that is easy to
get wrong in a way that looks right: an UNTAGGED paragraph -- one captured before
`orchestrator.py` recorded the thread -- must be reported as untagged and counted
in NEITHER population. Silently promoting it to "main thread" would reproduce the
original error with a more confident label on it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from e2e.narration_figures_report import derive


def _write_run(root: Path, name: str, narration: list[dict], calls: list[dict] | None = None) -> None:
    """One committed-shaped e2e run log carrying a narration capture."""
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "run-001.json").write_text(
        json.dumps(
            {
                "narration": narration,
                "tool_calls": calls or [],
                "usage": {"timeline": [], "continue_nudges": 0},
            }
        ),
        encoding="utf-8",
    )


def _para(text: str, thread: str | None = None, idx: int = 0) -> dict:
    entry = {"kind": "assistant", "text": text, "tool_calls_before": idx}
    if thread is not None:
        entry["thread"] = thread
    return entry


# --- the split itself -------------------------------------------------------

def test_a_tagged_run_splits_into_main_and_sub(tmp_path):
    _write_run(
        tmp_path,
        "r1",
        [
            _para("Now searching the census.", thread="main"),
            _para("Found four children.", thread="main"),
            _para("Now extracting record 3 of 12.", thread="sub"),
            _para("Now extracting record 4 of 12.", thread="sub"),
        ],
    )
    r = derive(tmp_path)
    assert r["paragraphs"] == 4
    assert (r["paras_main"], r["openers_main"]) == (2, 1)
    assert (r["paras_sub"], r["openers_sub"]) == (2, 2)
    assert r["paras_untagged"] == 0


def test_the_main_share_differs_from_the_mixed_share():
    """The whole reason the split exists. If these could not diverge there would
    be nothing to fix -- this is the McAndrew shape in miniature: the openers
    concentrate in the sub-agent prose a reader never sees."""
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        _write_run(
            root,
            "r1",
            [_para("Found four children.", thread="main")]
            + [_para("Now extracting.", thread="sub") for _ in range(9)],
        )
        r = derive(root)
        mixed = r["openers"] / r["paragraphs"]
        main = r["openers_main"] / r["paras_main"]
        assert mixed == pytest.approx(0.9)
        assert main == pytest.approx(0.0)
        assert mixed != main


# --- the part that fails open if nobody pins it -----------------------------

def test_an_untagged_paragraph_is_untagged_not_main(tmp_path):
    """Every committed run predates the tag. Counting those as main thread would
    report the old mixed figure under a label claiming it is the screen -- the
    same error the 18%->8.8% correction was about, with more confidence."""
    _write_run(
        tmp_path,
        "r1",
        [_para("Now searching."), _para("Found four children.")],
    )
    r = derive(tmp_path)
    assert r["paras_untagged"] == 2
    assert r["openers_untagged"] == 1
    assert r["paras_main"] == 0, "an untagged paragraph must not be promoted to main"
    assert r["openers_main"] == 0
    assert r["paras_sub"] == 0


def test_a_mixed_corpus_keeps_the_three_populations_apart(tmp_path):
    """Tagged and untagged runs coexist while the corpus is being re-captured."""
    _write_run(tmp_path, "old", [_para("Now searching."), _para("Found it.")])
    _write_run(tmp_path, "new", [_para("Now searching.", thread="main"),
                                 _para("Now extracting.", thread="sub")])
    r = derive(tmp_path)
    assert r["paragraphs"] == 4
    assert (r["paras_main"], r["paras_sub"], r["paras_untagged"]) == (1, 1, 2)
    assert r["paras_main"] + r["paras_sub"] + r["paras_untagged"] == r["paragraphs"]


# --- the opener rule is unchanged by the split ------------------------------

def test_the_opener_stays_anchored_to_the_first_character(tmp_path):
    """An announcement that CLOSES a paragraph is not an opener, and this figure
    has never claimed to count one. Stated here because the phase-5 draft read
    the figure as measuring process narration in general, which it does not --
    on the McAndrew capture, announcements in the closing sentence run ~50%
    while openers run under 10%."""
    _write_run(
        tmp_path,
        "r1",
        [
            _para("Now searching the census.", thread="main"),
            _para("Found four children. Now checking 1910.", thread="main"),
        ],
    )
    r = derive(tmp_path)
    assert r["openers_main"] == 1, "only the paragraph that STARTS with Now counts"


def test_totals_still_sum_after_the_split(tmp_path):
    """A regression the split could introduce: double-counting a paragraph into
    both the overall tally and a per-thread one incorrectly."""
    _write_run(
        tmp_path,
        "r1",
        [_para("Now a.", thread="main"), _para("Now b.", thread="sub"), _para("Now c.")],
    )
    r = derive(tmp_path)
    assert r["openers"] == 3
    assert r["openers_main"] + r["openers_sub"] + r["openers_untagged"] == r["openers"]
    assert r["paras_main"] + r["paras_sub"] + r["paras_untagged"] == r["paragraphs"]
