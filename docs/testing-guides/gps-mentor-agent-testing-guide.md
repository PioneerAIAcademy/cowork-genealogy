# GPS Mentor Agent Testing Guide

This guide walks you through testing the `gps-mentor` Cowork plugin
agent end-to-end after it's built. Follow each layer in order — each
catches a different class of bug.

The agent is specified in
[`docs/specs/gps-mentor-agent-spec.md`](../specs/gps-mentor-agent-spec.md).
The agent file itself lives at
[`packages/engine/plugin/agents/gps-mentor.md`](../../packages/engine/plugin/agents/gps-mentor.md).

## What the agent does (30 seconds)

`gps-mentor` is a Board for Certification of Genealogists (BCG)-style
senior genealogist who reviews the researcher's work and tells them
what to address next. It runs at three checkpoints in the `/research`
flow (pre-exhaustiveness, conclusion-readiness, proof-critique) and
on-demand when the user asks for a review.

Unlike a tool, this agent has structured side effects on the project
folder:

1. Writes a verdict JSON to `evaluations/<focus>-<target_id>-<short_iso>.json`
2. Appends an `ev_NNN` pointer record to `research.json`'s
   `evaluations[]` array
3. Prints a markdown `narrative_for_user` to the conversation

It is **append-only** to `research.json`. It must never mutate
anything other than the `evaluations[]` array, and never touches
`tree.gedcomx.json` at all.

The schema and validator changes that back this agent are checked
against [`docs/specs/research-schema-spec.md`](../specs/research-schema-spec.md)
§5.12 and live in
[`packages/engine/mcp-server/src/validation/validator.ts`](../../packages/engine/mcp-server/src/validation/validator.ts).

## Before you start

### 1. Build the MCP server and run all tests

```bash
cd packages/engine/mcp-server
npm run build
npm test
```

All tests must pass, including the evaluations validator tests in
`tests/validation/validator.test.ts`. If anything is red, fix it
first.

### 2. Build both shipping artifacts

```bash
cd /home/jay/cowork-genealogy
./scripts/build-mcpb.sh
./scripts/package-plugin.sh
./scripts/verify-mcpb.sh
```

You should end with two artifacts in `releases/`:

- `genealogy-mcp.mcpb` — the host MCP server (contains the updated
  validator)
- `genealogy-plugin.zip` — the Cowork plugin (contains
  `agents/gps-mentor.md`)

Confirm the plugin zip actually contains the agent:

```bash
unzip -l releases/genealogy-plugin.zip | grep gps-mentor
```

You should see `agents/gps-mentor.md`. If it's missing,
`scripts/package-plugin.sh` regressed — check that `agents/` is in
its zip command list.

---

## Layer 0: Validator unit tests

**What this tests:** The schema and validator code accept
well-formed `evaluations[]` entries and reject every malformed shape
the spec calls out.

**Time needed:** 30 seconds

### Steps

```bash
cd packages/engine/mcp-server
npm test -- tests/validation/validator.test.ts
```

### What success looks like

All evaluations tests pass:

- accepts a minimal valid project (with `evaluations: []`)
- flags missing top-level `evaluations` section
- accepts a valid evaluation entry
- rejects an invalid `focus` value
- rejects an invalid `verdict` value
- rejects an entry with the wrong ID prefix (e.g. `eval_001`)
- rejects a `target_id` that points at no real question or proof summary
- rejects a `target_id` that is not `"project"` when `target_type` is `project`
- accepts a valid `superseded_by` chain
- rejects a dangling `superseded_by` ID
- rejects a non-ISO 8601 `timestamp`

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `evaluations` field unknown | Schema not updated | Check `docs/specs/schemas/research.schema.json` has `evaluation_entry` in `$defs` |
| `requiredSections` doesn't include `evaluations` | Validator regression | Check `packages/engine/mcp-server/src/validation/validator.ts` requiredSections array |
| Dangling `superseded_by` not flagged | Cross-ref logic missing | Check `validateEvaluations` builds the full ID set before validating references |

---

## Layer 1: `validate_research_schema` via MCP Inspector

**What this tests:** The validator surfaces the same errors through
the MCP protocol that the unit tests check directly, against real
project folders on disk.

**Time needed:** 5 minutes

### Set up two fixtures

The repo already has working fixtures from prior development. If they
no longer exist on your machine, recreate them:

**`/tmp/mentor-test-valid/research.json`** — a minimal project with a
`superseded_by` chain:

```json
{
  "project": {
    "id": "rp_001",
    "objective": "Test project for evaluations validation",
    "subject_person_ids": null,
    "status": "active",
    "created": "2026-06-02",
    "updated": "2026-06-02"
  },
  "questions": [
    {
      "id": "q_001",
      "question": "Are the parents of Patrick Flynn Thomas and Mary?",
      "rationale": "Direct objective question.",
      "selection_basis": "objective_decomposition",
      "priority": "high",
      "status": "in_progress",
      "depends_on": [],
      "unblocks": [],
      "created": "2026-06-02",
      "resolved": null,
      "resolution_assertion_ids": [],
      "exhaustive_declaration": {
        "declared": false,
        "log_entry_ids": [],
        "stop_criteria": null
      }
    }
  ],
  "plans": [],
  "log": [],
  "sources": [],
  "assertions": [],
  "person_evidence": [],
  "conflicts": [],
  "hypotheses": [],
  "timelines": [],
  "proof_summaries": [],
  "evaluations": [
    {
      "id": "ev_001",
      "focus": "pre-exhaustiveness",
      "target_id": "q_001",
      "target_type": "question",
      "verdict": "address_first",
      "file_path": "evaluations/pre-exhaustiveness-q_001-2026-06-02T14-30-00.json",
      "timestamp": "2026-06-02T14:30:00Z",
      "superseded_by": "ev_002"
    },
    {
      "id": "ev_002",
      "focus": "pre-exhaustiveness",
      "target_id": "q_001",
      "target_type": "question",
      "verdict": "looks_solid",
      "file_path": "evaluations/pre-exhaustiveness-q_001-2026-06-02T15-00-00.json",
      "timestamp": "2026-06-02T15:00:00Z",
      "superseded_by": null
    }
  ]
}
```

Pair it with a minimal `tree.gedcomx.json`:

```json
{ "persons": [], "relationships": [], "sources": [] }
```

**`/tmp/mentor-test-broken/research.json`** — same shell, but with one
deliberately busted `evaluations[]` entry that should trip every
per-field rule:

```json
"evaluations": [
  {
    "id": "eval_001",
    "focus": "bogus-focus",
    "target_id": "q_nonexistent",
    "target_type": "question",
    "verdict": "totally_fine",
    "file_path": "evaluations/x.json",
    "timestamp": "not-a-date",
    "superseded_by": "ev_999"
  }
]
```

### Run the Inspector

```bash
cd packages/engine/mcp-server
npx @modelcontextprotocol/inspector node build/index.js
```

In the Inspector:

1. Connect.
2. Pick `validate_research_schema` from the tools list.
3. Call it with `projectPath: "/tmp/mentor-test-valid"`.
4. Expected: `{ "valid": true, "errors": [] }`.
5. Call it again with `projectPath: "/tmp/mentor-test-broken"`.
6. Expected: `{ "valid": false, "errors": [...] }` with errors for
   each of: invalid `id` prefix, invalid `focus`, invalid `verdict`,
   unknown `target_id`, invalid timestamp, and dangling `superseded_by`.

> **Heads-up on the Inspector input field:** if you paste the path
> and it complains about ENOENT, the field may have absorbed a
> trailing newline. Clear it completely, type the path manually, and
> don't press Enter inside the input.

### What success looks like

- Valid fixture: `{ "valid": true }`.
- Broken fixture: `{ "valid": false }` with at least six errors,
  each naming the offending entry index.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Valid fixture returns `valid: false` | `requiredSections` rejects the project unexpectedly, or the schema doesn't declare `evaluations` | Re-check `research.schema.json` and `validator.ts` |
| Broken fixture returns `valid: true` | `validateEvaluations` not called from `validateProject` | Confirm the function is invoked and its errors are appended |
| Validator only flags the first error | Function returns early instead of accumulating | Validator should walk every entry and collect all errors |

---

## Layer 2: Install both artifacts in Claude Desktop

**What this tests:** Claude Desktop accepts the host extension and the
Cowork plugin, and registers the agent in the Cowork plugin list.

**Time needed:** 5 minutes

### Steps

1. Open **Claude Desktop → Settings → Extensions**.
2. Click **Advanced Settings → Install extension** and select
   `releases/genealogy-mcp.mcpb`.
3. Confirm **"Genealogy Research"** appears with a green dot.
4. Switch to the **Cowork tab** in Claude Desktop.
5. Click **Customize → Add → Upload Plugin**.
6. Select `releases/genealogy-plugin.zip`.
7. Confirm **"Genealogy Research"** appears in the installed plugins
   list and that `gps-mentor` is one of the available agents.

### What success looks like

- Both artifacts install without an error dialog.
- The Cowork plugin lists `gps-mentor` alongside the existing skills.

### What failure looks like

- "Invalid extension" → re-run the build/verify scripts; the manifest
  is wrong.
- Plugin installs but no `gps-mentor` agent → `agents/` was not
  packaged into the zip; check `scripts/package-plugin.sh`.

---

## Layer 3: Trigger the agent in a Cowork session

**What this tests:** The Cowork orchestrator auto-delegates to
`gps-mentor` based on its description, and the agent's output
protocol works end-to-end against a real project folder.

**Time needed:** 10 minutes

### Set up a test project folder

Use the `/tmp/mentor-test-valid` fixture as a starting point, or
create a fresh project:

```bash
mkdir -p ~/cowork-test-mentor
cp /tmp/mentor-test-valid/research.json ~/cowork-test-mentor/research.json
cp /tmp/mentor-test-valid/tree.gedcomx.json ~/cowork-test-mentor/tree.gedcomx.json
```

Make sure `~/cowork-test-mentor/evaluations/` does **not** exist yet —
the agent should create it.

### Start a Cowork session

1. In Claude Desktop's Cowork tab, **start a new session** on
   `~/cowork-test-mentor`.
2. Confirm the genealogy plugin is loaded for the session.

### Test each trigger phrase

The agent's description includes these on-demand triggers. Try at
least three to confirm auto-delegation works on varied phrasing:

- "Review my work."
- "Is this defensible?"
- "What would a senior genealogist say?"
- "Mentor."
- "Second opinion."
- "Critique my proof."
- "Am I ready to conclude?"

For each trigger, watch what happens:

- The Cowork orchestrator should delegate to `gps-mentor` (you'll see
  the agent identifier in the transcript).
- The agent should run for ~30 seconds.
- A markdown narrative should print in the conversation.

### Verify the three outcomes

After at least one successful trigger, check the project folder:

```bash
ls -la ~/cowork-test-mentor/evaluations/
cat ~/cowork-test-mentor/research.json | jq '.evaluations'
```

You should see:

1. **A new verdict file** at
   `evaluations/<focus>-<target_id>-<short_iso>.json`, with
   `strengths`, `must_address`, `consider_addressing`,
   `non_blocking_notes`, and `narrative_for_user` fields.
2. **A new `ev_NNN` entry** in `research.json`'s `evaluations[]`,
   with the same `focus`, `target_id`, `verdict`, `file_path`, and
   `timestamp` as the verdict file.
3. **A markdown narrative** printed in the Cowork conversation with
   sections for "What you've done well", "What to address before
   moving on", and "What would change my mind".

### Verify the supersede chain

The fixture already has `ev_001` → `ev_002` with `superseded_by`
chained correctly. Trigger the agent a second time on the same
`q_001` (use **"re-evaluate q_001"** or, in interactive mode, accept
the re-evaluate prompt).

After it runs:

```bash
cat ~/cowork-test-mentor/research.json | jq '.evaluations'
```

You should see a new `ev_003`-style entry appended, and the previous
`ev_002` entry's `superseded_by` should now point at the new entry's
`id`. `ev_001`'s `superseded_by` should still point at `ev_002` — the
chain is preserved.

### Verify append-only behavior

The agent must never touch anything in `research.json` other than the
`evaluations[]` array. Diff before and after:

```bash
cp ~/cowork-test-mentor/research.json /tmp/before.json
# trigger the agent
diff <(jq 'del(.evaluations)' /tmp/before.json) \
     <(jq 'del(.evaluations)' ~/cowork-test-mentor/research.json)
```

Expected: no diff. Anything other than `evaluations[]` is a violation.

`tree.gedcomx.json` should also be untouched.

### Verify the refusal path

Edit `~/cowork-test-mentor/research.json` to make `q_001` have an
empty plan (or set a plan item to `status: "in_progress"`), then ask:

> "Review q_001 before exhaustiveness."

The agent should refuse with a specific message naming the corrective
action (e.g. "Plan items still in progress: [pli_001]. Complete them
before pre-exhaustiveness review.") and still write a `refused`
verdict to disk plus an `ev_NNN` entry — refusals are part of the
audit trail.

### What success looks like

- Cowork orchestrator auto-delegates to `gps-mentor` on each tested
  phrase.
- Each invocation writes a verdict file, appends an `evaluations[]`
  entry, prints a narrative.
- Re-running on the same target writes a new file with the new
  timestamp and supersedes the prior entry — neither overwrites.
- Append-only diff is clean.
- Refusal path also writes a verdict + ev entry.

### What failure looks like

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Agent doesn't trigger | Description doesn't match phrasing | Add the phrase to the agent file's frontmatter description |
| Verdict file written, narrative not printed | Agent stopped at step 3 of output protocol | Re-check output protocol ordering in the agent file |
| `evaluations[]` not updated, file written | Agent skipped step 3 entirely | Re-read the output protocol section of the agent |
| `superseded_by` not updated on prior entry | Agent didn't walk prior entries before appending | Re-check "Superseded-by update" rule in the agent |
| Agent edited a different section of `research.json` | Agent violated append-only | This is the most important regression to catch — re-read "Important rules" #1 |

---

## Quick reference: commands

| What | Command |
|------|---------|
| Build the MCP server | `cd packages/engine/mcp-server && npm run build` |
| Run validator unit tests | `cd packages/engine/mcp-server && npm test -- tests/validation/validator.test.ts` |
| Build host extension | `./scripts/build-mcpb.sh` |
| Build Cowork plugin | `./scripts/package-plugin.sh` |
| Verify host extension | `./scripts/verify-mcpb.sh` |
| Confirm agent is in plugin zip | `unzip -l releases/genealogy-plugin.zip \| grep gps-mentor` |
| Run Inspector | `cd packages/engine/mcp-server && npx @modelcontextprotocol/inspector node build/index.js` |
| Snapshot project before trigger | `cp ~/cowork-test-mentor/research.json /tmp/before.json` |
| Diff non-evaluations sections | `diff <(jq 'del(.evaluations)' /tmp/before.json) <(jq 'del(.evaluations)' ~/cowork-test-mentor/research.json)` |

---

## Summary: what each layer catches

| Layer | What it tests | Bugs it catches |
|-------|---------------|-----------------|
| 0 — Validator unit tests | Schema + validator logic against fixtures | Missing `requiredSections`, missing cross-ref checks, bad regexes |
| 1 — Inspector | `validate_research_schema` against real folders | Validator wiring bugs, error propagation through MCP |
| 2 — Install | Bundle + plugin install in Claude Desktop | Manifest drift, missing `agents/` in the plugin zip |
| 3 — Cowork session | Live agent invocation and side effects | Trigger description gaps, output protocol regressions, append-only violations, supersede-chain bugs |

**Don't skip layers.** Each catches bugs the others miss.
