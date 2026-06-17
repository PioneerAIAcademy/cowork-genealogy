"""Tests for the opt-in `judge_reads_files` capability.

When a test sets `judge_reads_files: true`, the harness includes the actual
content the skill wrote to research.json / tree.gedcomx.json in what the LLM
judge sees (orchestrator._summarize_changes), instead of only change counts.
Default false reproduces the legacy counts-only behavior for every other test
and skill.
"""

from harness import judge
from harness.loader import load_test_from_dict
from harness.orchestrator import _summarize_changes


def _minimal_positive():
    return {
        "test": {
            "id": "ut_jrf_001",
            "skill": "proof-conclusion",
            "name": "judge_reads_files smoke",
            "type": "positive",
            "description": "Verifies the loader parses judge_reads_files.",
            "tags": [],
        },
        "input": {"user_message": "hi", "scenario": None},
        "judge_context": [],
    }


def _sample_changes():
    return {
        "research.json": {
            "sections_modified": ["proof_summaries", "project"],
            "diff": {
                "proof_summaries": {
                    "added": [
                        {
                            "id": "ps_001",
                            "tier": "proved",
                            "narrative_markdown": (
                                "## Conclusion\n\nThe evidence conclusively "
                                "establishes the parentage.\n\n### Citations\n"
                                "1. 1850 census...\n"
                            ),
                        }
                    ],
                    "modified": [],
                    "deleted": [],
                },
                "project": {
                    "added": [],
                    "deleted": [],
                    "modified": [
                        {
                            "id": "rp_001",
                            "changed_fields": {
                                "status": {"before": "active", "after": "completed"}
                            },
                        }
                    ],
                },
            },
        }
    }


# --- loader -----------------------------------------------------------

def test_judge_reads_files_defaults_false():
    spec = load_test_from_dict(_minimal_positive())
    assert spec.judge_reads_files is False


def test_judge_reads_files_parsed_when_set():
    raw = _minimal_positive()
    raw["judge_reads_files"] = True
    assert load_test_from_dict(raw).judge_reads_files is True


# --- _summarize_changes: default OFF is the legacy counts-only output --

def test_summarize_changes_empty():
    assert "no research.json" in _summarize_changes({}, [])
    assert "no research.json" in _summarize_changes(None, [])


def test_summarize_changes_counts_only_by_default():
    out = _summarize_changes(_sample_changes(), [])
    assert "proof_summaries: +1 added" in out
    assert "conclusively establishes" not in out  # content is withheld by default
    # the default argument is byte-identical to an explicit include_content=False
    assert out == _summarize_changes(_sample_changes(), [], include_content=False)


# --- _summarize_changes: opt-in ON surfaces the written content -------

def test_summarize_changes_includes_content_when_enabled():
    out = _summarize_changes(_sample_changes(), [], include_content=True)
    assert "proof_summaries: +1 added" in out  # the counts header is still there
    assert "conclusively establishes" in out  # added entry's narrative is shown
    assert "Citations" in out
    assert '"status": "completed"' in out  # modified entry's new value is shown


def test_summarize_changes_truncates_long_narrative():
    fc = _sample_changes()
    fc["research.json"]["diff"]["proof_summaries"]["added"][0][
        "narrative_markdown"
    ] = "z" * 20000
    out = _summarize_changes(fc, [], include_content=True)
    assert "[truncated by harness" in out
    assert "z" * 20000 not in out  # the full untruncated string never appears


# --- _summarize_response string_max parameter -------------------------

def test_summarize_response_respects_custom_string_max():
    s = "y" * 5000
    # default cap (2000) truncates
    assert "[truncated by harness" in judge._summarize_response(s)
    # a larger cap leaves it intact
    assert judge._summarize_response(s, string_max=10000) == s
    # a smaller cap truncates harder
    out = judge._summarize_response(s, string_max=100)
    assert out.startswith("y" * 100)
    assert "[truncated by harness" in out
