# flynn-prior-craft-verdict

Mid-research Flynn project carrying **one prior craft verdict** on `ps_001`,
with its sidecar body on disk.

Derived from `mid-research-flynn-with-evaluation`. The only differences are in
`evaluations[]` and the new `evaluations/` directory.

## What makes this scenario distinct

`evaluations[0]` is an `on-demand` verdict on `ps_001` whose sidecar body sets
`"craft": true`. That flag is the only mark separating a craft read from an
evidentiary one — both are `focus: "on-demand"` — and the supersession rule
turns on it (`packages/engine/plugin/agents/gps-mentor.md:299-306`). The flag
lives **only in the sidecar body**: the `evaluations[]` entry carries `focus`,
`target_id`, `verdict` and `file_path`, and nothing on it distinguishes a craft
read from an evidentiary one.

`file_path` follows the shape `research_append` actually writes —
`evaluations/<focus>-<target_id>-<short_iso>.json`, built in `prepareVerdict`
(`packages/engine/mcp-server/src/tools/research-append.ts`), a JSON body, not
markdown. The existing `mid-research-flynn-with-evaluation` fixture claims
`evaluations/ev_001.md`, which that tool would never produce; this scenario
does not copy that.

The verdict is `consider_addressing`, not `address_first`: craft findings are
advisory and never produce a must-address item or an `address_first` verdict
(`gps-mentor.md:661-664`). Each finding carries a `Craft — <axis>` label, which
is the citation a craft finding gets in place of a numbered Genealogy Standard.

## The prior verdict describes the prose that is actually in ps_001

Every finding in the sidecar is checkable against `ps_001`'s
`narrative_markdown` in this scenario's `research.json`:

- the proof vocabulary it flags is present — "Original Source" three times,
  "indirect evidence" three times, "secondary informant" twice, and one "GPS
  preponderance hierarchy";
- the Evidence Summary is a three-item numbered list of records;
- the point about the relationship column arriving in 1880 is made twice, under
  the 1860 census and again in the Assessment.

This matters because a prior verdict describing findings that are *not* in the
prose gives the agent a false premise to reason from, and the resulting claims
to the researcher read as fluent and are wrong.

## Why the sidecar file has to be on disk

`sidecar_read` is a LIVE tool in the unit harness — it resolves a
project-relative ref against the workspace rather than a fixture
(`eval/harness/harness/mock_mcp.py`). Until this scenario landed, no scenario
in the corpus shipped an `evaluations/` sidecar and `build_workspace` did not
copy one, so the call could only ever answer `not_found`.
