"""Which top-level research.json sections are single objects, not arrays.

`diff.py` (structural before/after diffing) and `replay.py` (replaying
research_append ops from a run log's tool-call ledger) both need this fact
and used to keep their own separate copies of the set — a drift risk PR
#4806's self-review flagged: a future singleton section added to the schema
would need updating in both places, with nothing to catch a miss if one
were. One set, imported by both.
"""

from __future__ import annotations

# Per docs/specs/schemas/research.schema.json: sections that are a single
# object rather than an array of id-keyed entries.
SINGLETON_SECTIONS = frozenset({"project", "researcher_profile"})
