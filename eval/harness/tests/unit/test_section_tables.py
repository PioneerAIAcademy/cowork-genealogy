"""Two harness copies of the engine's section table, pinned to it.

The harness cannot import validator.ts, so a new research.json section is added
to each copy by hand. A section missing from `DIFFED_SECTIONS` is skipped by the
no-delete check and its ids are unknown to the id-resolves check; one missing
from `SECTION_ID_PREFIX` gets no synthesised id in a replay. Neither shows up as
a failure anywhere else. `_PROJECT_ID_PREFIXES` is pinned the same way in
test_status_question_validator.py.
"""

import re
import sys
from pathlib import Path

REPO = next(q for q in Path(__file__).resolve().parents if (q / "eval/harness/validators").is_dir())
sys.path.insert(0, str(REPO / "eval/harness/validators"))

from harness.replay import SECTION_ID_PREFIX  # noqa: E402
from test_universal import DIFFED_SECTIONS  # noqa: E402


def _engine_id_prefixes() -> dict[str, str]:
    source = (REPO / "packages/engine/mcp-server/src/validation/validator.ts").read_text(encoding="utf-8")
    block = source[source.index("export const ID_PREFIXES"):]
    block = block[: block.index("};")]
    table = dict(re.findall(r'^\s*"?([a-z_]+)"?\s*:\s*"([a-z]+_)"', block, re.MULTILINE))
    assert "questions" in table, "premise gone: ID_PREFIXES not found in validator.ts"
    return table


def test_replay_prefixes_are_the_engines_for_every_list_section():
    """`project` is the one object section; it gets no synthesised id."""
    engine = _engine_id_prefixes()
    engine.pop("project")
    assert SECTION_ID_PREFIX == engine


def test_the_diff_set_is_every_top_level_section_with_ids():
    """`plan_items` is research_append's pseudo-section for `plans[].items[]`,
    not a top-level property; a plan-item change shows up under `plans`."""
    engine = set(_engine_id_prefixes()) - {"plan_items"}
    assert len(DIFFED_SECTIONS) == len(set(DIFFED_SECTIONS)), "DIFFED_SECTIONS lists a section twice"
    assert set(DIFFED_SECTIONS) == engine
