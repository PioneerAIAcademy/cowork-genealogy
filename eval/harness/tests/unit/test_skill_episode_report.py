"""Unit tests for e2e.skill_episode_report — the per-skill episode fingerprint
report (docs/specs/guardrail-enforcement-spec.md §7, GitHub issue #1463).

**This file is where the arithmetic is pinned.** The corpus run asserts shape
only — the committed corpus grows with every merged e2e PR, so an absolute count
taken from it is stale on merge. Here the expected values are fixed by
construction, so recall, both precision denominators, the empty-episode rule,
and the episode boundary can be asserted exactly and will never drift.

Two of these assertions exist because the definitions were left implicit in the
first draft and produced numbers that contradicted the report's own conclusion:
`test_precision_denominator_is_all_episodes_not_just_this_skills` and the three
`most_specific` rule tests.
"""

from __future__ import annotations

import json

from e2e.skill_episode_report import (
    FINGERPRINT_PRECISION_TARGET,
    PRECISION_FLOOR,
    RECALL_FLOOR,
    EpisodeStats,
    accumulate,
    format_report,
    has_usable_fingerprint,
    scan_corpus,
    skill_launches,
)


def _skill(name):
    return {"tool": "Skill", "args": {"skill": name}}


def _call(tool):
    return {"tool": f"mcp__genealogy__{tool}"}


def _builtin(tool):
    return {"tool": tool}


def _stats(*ledgers):
    stats = EpisodeStats()
    for ledger in ledgers:
        accumulate(ledger, stats)
    return stats


# --- skill_launches ----------------------------------------------------------


def test_skill_launches_returns_index_and_name_in_order():
    ledger = [_call("record_search"), _skill("person-evidence"), _call("tree_edit"), _skill("proof-conclusion")]
    assert skill_launches(ledger) == [(1, "person-evidence"), (3, "proof-conclusion")]


def test_skill_launches_ignores_skill_entries_with_no_name():
    assert skill_launches([{"tool": "Skill", "args": {}}, {"tool": "Skill", "args": {"skill": ""}}]) == []


def test_skill_launches_ignores_non_dict_entries():
    assert skill_launches(["junk", None, _skill("person-evidence")]) == [(2, "person-evidence")]


# --- episode boundary --------------------------------------------------------


def test_episode_runs_from_launch_to_the_next_launch():
    stats = _stats([_skill("person-evidence"), _call("tree_edit"), _skill("proof-conclusion"), _call("tree_correct")])
    assert stats.episodes["person-evidence"] == 1
    assert stats.tool_episodes["person-evidence"]["tree_edit"] == 1
    # tree_correct fell after the second launch, so it belongs to proof-conclusion.
    assert stats.tool_episodes["person-evidence"]["tree_correct"] == 0
    assert stats.tool_episodes["proof-conclusion"]["tree_correct"] == 1


def test_final_episode_runs_to_the_end_of_the_ledger():
    stats = _stats([_skill("person-evidence"), _call("tree_edit"), _call("research_append")])
    assert stats.tool_episodes["person-evidence"]["research_append"] == 1


def test_calls_before_the_first_launch_belong_to_no_episode():
    stats = _stats([_call("record_search"), _skill("person-evidence")])
    assert stats.tool_episodes["person-evidence"]["record_search"] == 0
    assert stats.total_episodes == 1


def test_a_tool_is_counted_once_per_episode_not_once_per_call():
    """Eleven `research_append` calls in one episode is one episode's worth of
    evidence that the tool accompanies the skill, not eleven."""
    stats = _stats([_skill("person-evidence"), *[_call("research_append")] * 11])
    assert stats.tool_episodes["person-evidence"]["research_append"] == 1
    assert stats.recall("person-evidence", "research_append") == 1.0


def test_nested_launch_truncates_the_enclosing_episode():
    """The documented Limits-block artifact, pinned so it cannot change silently."""
    stats = _stats([_skill("person-evidence"), _skill("record-extraction"), _call("extraction_append")])
    assert stats.tool_episodes["person-evidence"]["extraction_append"] == 0
    assert stats.tool_episodes["record-extraction"]["extraction_append"] == 1


# --- empty episodes ----------------------------------------------------------


def test_empty_episode_is_one_with_zero_tool_calls():
    stats = _stats([_skill("person-evidence"), _skill("proof-conclusion"), _call("tree_correct")])
    assert stats.empty["person-evidence"] == 1
    assert stats.empty["proof-conclusion"] == 0


def test_back_to_back_launches_at_the_end_are_both_empty():
    stats = _stats([_skill("person-evidence"), _skill("proof-conclusion")])
    assert stats.empty["person-evidence"] == 1
    assert stats.empty["proof-conclusion"] == 1


# --- recall / precision ------------------------------------------------------


def test_recall_is_over_this_skills_episodes():
    stats = _stats(
        [_skill("person-evidence"), _call("tree_edit")],
        [_skill("person-evidence"), _call("record_search")],
    )
    assert stats.recall("person-evidence", "tree_edit") == 0.5


def test_precision_denominator_is_all_episodes_not_just_this_skills():
    """The definitional bug this report was nearly shipped with.

    `tree_edit` appears in one person-evidence episode and one search-records
    episode. Over person-evidence's own episodes that reads 1.0; over every
    episode in the corpus it is 0.5, and only the second is a specificity claim.
    """
    stats = _stats(
        [_skill("person-evidence"), _call("tree_edit")],
        [_skill("search-records"), _call("tree_edit")],
    )
    assert stats.recall("person-evidence", "tree_edit") == 1.0
    assert stats.precision("person-evidence", "tree_edit") == 0.5
    assert stats.tool_total["tree_edit"] == 2


def test_precision_of_an_unseen_tool_is_zero_not_a_division_error():
    assert _stats([_skill("person-evidence")]).precision("person-evidence", "never_called") == 0.0


def test_recall_for_a_skill_with_no_episodes_is_zero():
    assert EpisodeStats().recall("person-evidence", "research_append") == 0.0


# --- most_specific -----------------------------------------------------------


def _one_specific_tool_corpus():
    """`materialize_facts` in 2 of person-evidence's 2 episodes and nowhere else
    (precision 1.0); `research_append` everywhere (precision 0.5)."""
    return _stats(
        [_skill("person-evidence"), _call("materialize_facts"), _call("research_append")],
        [_skill("person-evidence"), _call("materialize_facts"), _call("research_append")],
        [_skill("search-records"), _call("research_append")],
        [_skill("research-plan"), _call("research_append")],
    )


def test_most_specific_prefers_precision_over_recall():
    tool, precision, recall = _one_specific_tool_corpus().most_specific("person-evidence")
    assert (tool, precision, recall) == ("materialize_facts", 1.0, 1.0)


def test_most_specific_excludes_session_builtins():
    """Without this filter `research-exhaustiveness` reports `Read` on the real
    corpus — a tool that accompanies everything and identifies nothing."""
    stats = _stats([_skill("research-exhaustiveness"), _builtin("Read"), _builtin("ToolSearch")])
    assert stats.recall("research-exhaustiveness", "Read") == 1.0
    assert stats.precision("research-exhaustiveness", "Read") == 1.0
    assert stats.most_specific("research-exhaustiveness") is None


def test_most_specific_applies_a_precision_floor():
    """Without this floor `conflict-resolution` reports `research_query` at
    precision 0.02 on the real corpus. Here `shared_tool` clears recall (1.0)
    and fails precision (0.25)."""
    stats = _stats(
        [_skill("conflict-resolution"), _call("shared_tool")],
        [_skill("search-records"), _call("shared_tool")],
        [_skill("research-plan"), _call("shared_tool")],
        [_skill("question-selection"), _call("shared_tool")],
    )
    assert stats.recall("conflict-resolution", "shared_tool") == 1.0
    assert stats.precision("conflict-resolution", "shared_tool") == 0.25
    assert stats.precision("conflict-resolution", "shared_tool") < PRECISION_FLOOR
    assert stats.most_specific("conflict-resolution") is None


def test_most_specific_applies_a_recall_floor():
    """A perfectly specific tool that almost never fires is not a fingerprint:
    its absence cannot be evidence of anything.

    `rare_tool` is unique to person-evidence (precision 1.0) but fires in 1 of
    its 10 episodes. `common_tool` fires in the other 9 but is shared widely
    enough to fail the precision floor, so it cannot win by default — which is
    what leaves the recall floor as the only thing under test.
    """
    stats = _stats(
        *([_skill("person-evidence"), _call("common_tool")] for _ in range(9)),
        [_skill("person-evidence"), _call("rare_tool")],
        *([_skill("search-records"), _call("common_tool")] for _ in range(30)),
    )
    assert stats.precision("person-evidence", "rare_tool") == 1.0
    assert stats.recall("person-evidence", "rare_tool") == 0.1
    assert stats.recall("person-evidence", "rare_tool") < RECALL_FLOOR
    assert stats.recall("person-evidence", "common_tool") == 0.9
    assert stats.precision("person-evidence", "common_tool") < PRECISION_FLOOR
    assert stats.most_specific("person-evidence") is None


def test_most_specific_does_not_exclude_protected_write_tools():
    """Excluding them was the round-2 critic's proposed fix and it is wrong:
    `materialize_facts` and `tree_correct` ARE protected writes under
    `skill_invocation.owning_skills`, so dropping them zeroes every cell the
    report is supposed to populate."""
    assert _one_specific_tool_corpus().most_specific("person-evidence")[0] == "materialize_facts"


def test_most_specific_breaks_ties_deterministically():
    """Two tools identical on precision and recall — the report must not depend
    on dict insertion order."""
    stats = _stats([_skill("person-evidence"), _call("bbb_tool"), _call("aaa_tool")])
    assert stats.most_specific("person-evidence")[0] == "bbb_tool"


# --- the finding -------------------------------------------------------------


def test_has_usable_fingerprint_is_empty_when_nothing_clears_the_target():
    stats = _stats(
        [_skill("person-evidence"), _call("research_append")],
        [_skill("search-records"), _call("research_append")],
    )
    assert stats.precision("person-evidence", "research_append") < FINGERPRINT_PRECISION_TARGET
    assert has_usable_fingerprint(stats, ("person-evidence",)) == []


def test_has_usable_fingerprint_reports_one_when_it_exists():
    """The report must be able to come out the other way — a check that can only
    confirm its own premise is not a measurement."""
    stats = _one_specific_tool_corpus()
    assert has_usable_fingerprint(stats, ("person-evidence",)) == ["person-evidence/materialize_facts"]


def test_has_usable_fingerprint_ignores_builtins():
    stats = _stats([_skill("person-evidence"), _builtin("Read")])
    assert has_usable_fingerprint(stats, ("person-evidence",)) == []


def test_has_usable_fingerprint_returns_a_stable_order():
    """Insertion order comes from a set comprehension in `accumulate`, so it
    varies between processes on byte-identical input (PYTHONHASHSEED).

    One tool per episode is what keeps this construction deterministic: each
    episode's set is a singleton, so the Counter's key order is the ledger's.
    Both tools in one episode and the assertion becomes a coin flip.
    """
    stats = _stats(
        [_skill("person-evidence"), _call("zzz_tool")],
        [_skill("person-evidence"), _call("aaa_tool")],
    )
    assert has_usable_fingerprint(stats, ("person-evidence",)) == [
        "person-evidence/aaa_tool",
        "person-evidence/zzz_tool",
    ]


# --- scan_corpus -------------------------------------------------------------


def _write_run(dir_, name, tool_calls):
    dir_.mkdir(parents=True, exist_ok=True)
    path = dir_ / name
    path.write_text(json.dumps({"tool_calls": tool_calls}), encoding="utf-8")
    return path


def test_scan_corpus_aggregates_across_runs(tmp_path):
    a = _write_run(tmp_path / "fx1", "run-1.json", [_skill("person-evidence"), _call("tree_edit")])
    b = _write_run(tmp_path / "fx2", "run-2.json", [_skill("person-evidence"), _call("tree_edit")])
    stats = scan_corpus([a, b])
    assert stats.episodes["person-evidence"] == 2
    assert stats.recall("person-evidence", "tree_edit") == 1.0


def test_scan_corpus_skips_unreadable_runs_without_raising(tmp_path, capsys):
    good = _write_run(tmp_path / "fx", "run-1.json", [_skill("person-evidence"), _call("tree_edit")])
    bad = tmp_path / "fx" / "run-2.json"
    bad.write_text("{not json", encoding="utf-8")
    stats = scan_corpus([good, bad])
    assert stats.episodes["person-evidence"] == 1
    assert "skip" in capsys.readouterr().err


def test_scan_corpus_tolerates_a_run_with_no_tool_calls(tmp_path):
    path = tmp_path / "fx" / "run-1.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"verdict": "aborted"}), encoding="utf-8")
    assert scan_corpus([path]).total_episodes == 0


# --- format_report -----------------------------------------------------------


def test_format_report_names_the_precision_denominator():
    """A reader must be able to tell which denominator produced the numbers —
    the two differ materially and both are defensible."""
    out = format_report(_one_specific_tool_corpus(), skills=("person-evidence",))
    assert "Precision denominator: all 4 Skill episodes" in out


def test_format_report_states_the_finding_when_no_fingerprint_exists():
    stats = _stats(
        [_skill("person-evidence"), _call("research_append")],
        [_skill("search-records"), _call("research_append")],
    )
    assert "no non-circular completion fingerprint exists" in format_report(
        stats, skills=("person-evidence",), episode_floor=1
    )


def test_format_report_flags_a_fingerprint_that_would_contradict_the_premise():
    out = format_report(_one_specific_tool_corpus(), skills=("person-evidence",), episode_floor=1)
    assert "USABLE FINGERPRINT FOUND" in out
    assert "issue #1463" in out


def test_format_report_handles_a_skill_with_no_episodes():
    assert "(no episodes)" in format_report(EpisodeStats(), skills=("conflict-resolution",))


def test_the_verdict_is_scoped_to_guardrail_skills_even_in_all_skills_mode():
    """Found by `/code-review`: under `--all-skills`, non-guardrail skills like
    `locality-guide` DO clear the target, and reporting that as "contradicts the
    premise of #1463" told a reader the finding was refuted while every guardrail
    row in the same table read `none`."""
    stats = _stats(
        # A guardrail skill with no fingerprint — the finding.
        [_skill("person-evidence"), _call("research_append")],
        [_skill("search-records"), _call("research_append")],
        # A non-guardrail skill that HAS one.
        [_skill("locality-guide"), _call("wiki_read")],
        [_skill("locality-guide"), _call("wiki_read")],
    )
    out = format_report(stats, skills=("person-evidence", "locality-guide"), episode_floor=1)
    assert "no non-circular completion fingerprint exists" in out
    assert "USABLE FINGERPRINT FOUND" not in out
    # Still surfaced, but as contrast rather than as the verdict.
    assert "Non-guardrail skills with one, for contrast: locality-guide/wiki_read" in out


def test_a_guardrail_fingerprint_still_flips_the_verdict_in_all_skills_mode():
    """The scoping must not make the banner unreachable — it has to still fire
    when a GUARDRAIL skill is the one clearing the target."""
    out = format_report(
        _one_specific_tool_corpus(), skills=("person-evidence", "search-records"), episode_floor=1
    )
    assert "USABLE FINGERPRINT FOUND for a GUARDRAIL skill" in out
    assert "issue #1463" in out


def test_the_verdict_is_withheld_below_the_episode_floor():
    """`--test <slug>` narrows the corpus to one fixture, where two episodes read
    precision 1.00 and the banner announced the finding refuted. Neither verdict
    is available on a sample this size — including the finding itself."""
    stats = _stats(
        [_skill("person-evidence"), _call("merge_warnings")],
        [_skill("person-evidence"), _call("merge_warnings")],
    )
    out = format_report(stats, skills=("person-evidence",))
    assert "USABLE FINGERPRINT FOUND" not in out
    assert "no non-circular completion fingerprint exists" not in out
    assert "Sample too small to decide" in out


def test_the_verdict_names_the_skills_it_withheld():
    """The mixed case. Saying "all four GUARDRAIL skills" while the floor dropped
    one is the same over-claim the floor exists to remove, one level down."""
    stats = _stats(
        *([_skill("person-evidence"), _call("research_append")] for _ in range(20)),
        *([_skill("search-records"), _call("research_append")] for _ in range(20)),
        [_skill("conflict-resolution"), _call("merge_warnings")],
    )
    out = format_report(stats, skills=("person-evidence", "conflict-resolution"))
    assert "no non-circular completion fingerprint exists" in out
    assert "1 GUARDRAIL skill(s) with >= 20 episodes (person-evidence)" in out
    assert "Withheld below the 20-episode floor: conflict-resolution (1 episode)." in out


def test_all_skills_row_order_breaks_ties_by_name():
    """Ties fell to Counter insertion order — i.e. corpus file order — so rows
    reshuffled as runs landed."""
    stats = _stats([_skill("zzz-skill"), _call("t")], [_skill("aaa-skill"), _call("t")])
    ordered = sorted(stats.episodes, key=lambda s: (-stats.episodes[s], s))
    assert ordered == ["aaa-skill", "zzz-skill"]
