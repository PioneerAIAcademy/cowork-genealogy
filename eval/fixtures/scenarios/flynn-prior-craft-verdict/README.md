# flynn-prior-craft-verdict

Mid-research Flynn project carrying **one prior craft verdict** on `ps_001`,
with its sidecar body on disk.

Derived from `mid-research-flynn-with-evaluation`. The only differences are in
`evaluations[]` and the new `evaluations/` directory.

## What makes this scenario distinct

`evaluations[0]` is an `on-demand` verdict on `ps_001` whose sidecar body sets
`"craft": true`. That flag is the only mark separating a craft read from an
evidentiary one — both are `focus: "on-demand"` — and the supersession rule
turns on it (`packages/engine/plugin/agents/gps-mentor.md:308-312`): a craft
run supersedes only an earlier craft run on the same target, and to tell them
apart the agent must call
`sidecar_read({ projectPath, ref: <the entry's file_path> })` and read the
flag back.

`file_path` follows the shape `research_append` actually writes —
`evaluations/<focus>-<target_id>-<short_iso>.json`
(`research-append.ts:2849`), a JSON body, not markdown. The existing
`mid-research-flynn-with-evaluation` fixture claims `evaluations/ev_001.md`,
which that tool would never produce; this scenario does not copy that.

The verdict is `consider_addressing`, not `address_first`: craft findings are
advisory and never produce a must-address item or an `address_first` verdict
(`gps-mentor.md:662`).

## Why the sidecar file has to be on disk

`sidecar_read` is a LIVE tool in the unit harness — it resolves a
project-relative ref against the workspace rather than a fixture
(`eval/harness/harness/mock_mcp.py`). Until this scenario landed, no scenario
in the corpus shipped an `evaluations/` sidecar and `stage_workspace` did not
copy one, so the call could only ever answer `not_found` and the supersession
path was unreachable from a unit test.
