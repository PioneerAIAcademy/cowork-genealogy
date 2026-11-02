"""`PROJECT_WRITER_TOOLS` must name every engine tool that writes a project
document, or the hand-edit validator fails a run for a legitimate write.

Read from the engine's own list (`tool-result.ts`), never a hand copy: a new
writer tool fails here until the validator knows it. `evaluation_append` was
lost from the validator by a merge and only a paid gps-mentor run noticed;
`project_create` and `tree_forget` had never been added.
"""

import re
from pathlib import Path

from validators.test_universal import CONDITIONAL_PROJECT_WRITER_TOOLS, PROJECT_WRITER_TOOLS

TOOL_RESULT_TS = Path(__file__).resolve().parents[4] / "packages/engine/mcp-server/src/tool-result.ts"


def _ts_list(name: str) -> set[str]:
    body = re.search(
        rf"export const {name} = \[(.*?)\] as const",
        TOOL_RESULT_TS.read_text(encoding="utf-8"),
        re.S,
    )
    assert body, f"{name} not found in tool-result.ts"
    return set(re.findall(r'"([a-z_]+)"', body.group(1)))


def test_the_validator_knows_every_engine_document_writer():
    engine = _ts_list("OK_FALSE_IS_FAILURE") - _ts_list("NOT_A_DOCUMENT_WRITER")
    assert engine, "read no writers from tool-result.ts"
    validator = set(PROJECT_WRITER_TOOLS) | set(CONDITIONAL_PROJECT_WRITER_TOOLS)
    assert validator == engine, {
        "missing": sorted(engine - validator),
        "extra": sorted(validator - engine),
    }
