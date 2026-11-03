"""Direct tests for the search-images relabelled-browse-log validator (#4012).

Same reason as `test_search_images_validators.py` and its siblings:
`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/`
is collected by `make harness-test`, and a validator's real pass/fail set
would otherwise appear only inside a paid per-skill run.

These exist to satisfy CLAUDE.md's "a new lint must be proven to fail" rule.

The shape being pinned: on Haiku low, `research_log_append` refused to attach a
page's staged file to an `image_search` entry, and the agent relabelled the
entry `tool: "image_transcribe"` so the file was accepted — writing a results/
sidecar and leaving the browse itself unlogged (#4012, observed on d1 and three
012 runs). The single-relabelled-entry shape already fails
`test_positive_appends_browse_log_entry` (no browse-tool entry remains), but
the SPLIT shape — a correct image_search entry plus a relabelled one — passes
it, and passes `test_no_results_sidecar_written` too when no staged ref was
attached. The relabel validator is what fails both shapes, and the divergence
is demonstrated below rather than asserted in prose.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validator as a test of this module and error on its
# harness-supplied fixtures. Same pattern as the sibling validator tests.
from test_search_images import (  # noqa: E402
    test_browse_log_never_labelled_image_transcribe as check_no_relabel,
)
from test_search_images import (  # noqa: E402
    test_positive_appends_browse_log_entry as check_browse_logged,
)

_POSITIVE = {"type": "positive", "tags": ["browse", "volume-selection"]}
_CAP = {"type": "positive", "tags": ["cap-refusal"]}

# new_log_entries takes the WRAPPED per-run state ({"research_json": {...}}),
# not the unwrapped research.json dict — see validators_lib.new_log_entries.
_NO_LOG_STATE = {"research_json": {"log": []}, "files": {}}


def _state_with_log(entries):
    return {"research_json": {"log": entries}, "files": {}}


def test_passes_on_the_instructed_browse_log_shape():
    """The green case, so the RED cases below mean something: one entry, named
    for the browse, as search-images.md step 6 instructs."""
    after = _state_with_log(
        [{"id": "log_010", "tool": "image_search", "outcome": "positive"}]
    )
    check_no_relabel(_NO_LOG_STATE, after, _POSITIVE)


def test_passes_on_a_faithful_error_outcome_for_identical_reads():
    """THE OTHER DIRECTION the rubric protects: an agent that notices the mock's
    identical page reads and logs the browse with outcome 'error' is reporting
    faithfully. The entry still names the browse tool, so this must stay green —
    the validator polices the tool label, never the outcome."""
    after = _state_with_log(
        [{"id": "log_010", "tool": "image_search", "outcome": "error"}]
    )
    check_no_relabel(_NO_LOG_STATE, after, _POSITIVE)


def test_fires_on_the_single_relabelled_entry_shape():
    """The d1/012 slip as committed on Haiku low: the browse's only log entry
    relabelled image_transcribe so the staged page file would be accepted."""
    after = _state_with_log(
        [
            {
                "id": "log_010",
                "tool": "image_transcribe",
                "outcome": "positive",
                "results_ref": "results/log_010.json",
            }
        ]
    )
    with pytest.raises(AssertionError, match="never image_transcribe"):
        check_no_relabel(_NO_LOG_STATE, after, _POSITIVE)


def test_fires_on_the_split_shape_the_browse_validator_passes():
    """The split shape: the browse logged correctly AND a second relabelled
    entry alongside it. test_positive_appends_browse_log_entry passes this —
    an image_search entry exists — which is exactly why the relabel validator
    is not redundant with it."""
    after = _state_with_log(
        [
            {"id": "log_010", "tool": "image_search", "outcome": "positive"},
            {"id": "log_011", "tool": "image_transcribe", "outcome": "positive"},
        ]
    )
    check_browse_logged(_NO_LOG_STATE, after, _POSITIVE)  # the gap, shown live
    with pytest.raises(AssertionError, match="never image_transcribe"):
        check_no_relabel(_NO_LOG_STATE, after, _POSITIVE)


def test_fires_on_a_server_prefixed_spelling():
    """The `in` match, not equality: an agent writing a Cowork-prefixed tool
    name into the entry must not slip past the label check."""
    after = _state_with_log(
        [
            {
                "id": "log_010",
                "tool": "mcp__Genealogy_Research__image_transcribe",
                "outcome": "positive",
            }
        ]
    )
    with pytest.raises(AssertionError, match="never image_transcribe"):
        check_no_relabel(_NO_LOG_STATE, after, _POSITIVE)


def test_skips_on_cap_refusal():
    """A cap refusal stops the browse at a page read, so its partial log may
    name image_transcribe (ut_search_images_d6's committed shape)."""
    after = _state_with_log(
        [{"id": "log_010", "tool": "image_transcribe", "outcome": "partial"}]
    )
    with pytest.raises(BaseException, match="cap refusal"):
        check_no_relabel(_NO_LOG_STATE, after, _CAP)


def test_skips_on_a_negative_test():
    with pytest.raises(BaseException, match="positive"):
        check_no_relabel(_NO_LOG_STATE, _NO_LOG_STATE, {"type": "negative", "tags": []})
