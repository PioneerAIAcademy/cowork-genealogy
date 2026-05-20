"""Skill-specific validators for the locality-guide skill.

locality-guide is a read-only display skill: it consults the place_search,
place_collections, place_external_links, wiki, and wikipedia MCP tools and outputs
the locality research guide directly to the user. It does NOT write
to research.json or tree.gedcomx.json — that rule is enforced
universally by `test_universal.py::test_ownership_table` and
`test_universal.py::test_tree_ownership_table` (locality-guide is
absent from both OWNERSHIP_TABLE and TREE_OWNERSHIP_TABLE, so any
write triggers a violation).

All rubric dimensions for locality-guide (Jurisdiction accuracy,
Record availability, Research strategy) require reading the narrative
output for genealogical judgment, so they stay in `rubric.md` rather
than migrating to deterministic validators. This file exists to document
that fact and as a placeholder for future tag-gated regression checks.

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` per
docs/plan/criteria-demotion-and-rubric-opt-in.md.
"""

from __future__ import annotations
