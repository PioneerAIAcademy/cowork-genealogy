# E2E Test Specification

**Project:** Cowork Genealogy — an AI genealogy research assistant
**Scope:** End-to-end benchmark tests that measure how often the agent
can autonomously complete a real research objective against live
FamilySearch APIs
**Status:** Provisional. Revised after the first real harness run.

---

## 1. Overview

An e2e test snapshots a real well-researched FamilySearch person's
tree, strips a focused subset of the information (the "answer"), and
asks the agent to recover what was removed. The starting state and
the expected findings are committed; the agent's research runs live.

Tests are **benchmarks**, not regression checks. They measure **two
axes** (§7): **recall** — did the agent recover the stripped facts,
graded from the tree (this is the verdict) — and **proof quality** — is
the agent's written GPS proof statement sound, graded from the research
log (an advisory score that does not gate the verdict). Per-PR
regression coverage is the job of unit tests (see `unit-test-spec.md`);
e2e is run on demand, one test at a time.

**What this benchmark does and does not claim.** Recall measures fact
recovery, not sound reasoning — an agent can recover a right answer from
a single weak hit (a lucky match) and still score `pass`. The
proof-quality axis partially closes that gap by grading the written
proof separately. What remains only *sampled*, not guaranteed, is the
agent's **restraint from over-claiming** — see negative fixtures (§3.4).
Read together, the benchmark is a strong capability signal; it is not a
certification that the agent does fully sound, verifiable GPS research.

### What the test fixture contains

- A pre-populated `research.json` (research objective set, no log
  yet)
- A `tree.gedcomx.json` snapshot with the answer information removed
- An `expected-findings.json` enumerating what the agent should
  recover, derived from the diff between the original (well-
  researched) tree and the stripped starting state
- Fixture metadata: id, source PID, tags, caps, model pins
- A README with human notes (PID, what was removed, why)

### What the test fixture does not contain

- The full original (pre-stripping) tree. The diff that defines the
  answer is computed once at fixture-creation time and persisted as
  `expected-findings.json`; the unstripped tree is not retained.
- Mocked MCP responses. Other than the snapshotted starting tree,
  all the agent's tool calls hit live FamilySearch APIs during the
  test run.
- A rubric or human-judged proof grading. Grading is single-axis:
  did the agent's final tree recover the listed findings?

---

## 2. File Location and Naming

Each test gets its own directory under `eval/tests/e2e/`, named by a
short kebab-case slug:

```
eval/tests/e2e/smith-parents-1850/
  fixture.json
  starting-research.json
  starting-tree.gedcomx.json
  expected-findings.json
  README.md
```

Slug convention: `<surname>-<topic>-<year>` where helpful, but any
short descriptive kebab-case is fine. Slugs are also the test ID.

---

## 3. Fixture Files

### 3.1 `fixture.json`

Test metadata.

```json
{
  "id": "smith-parents-1850",
  "name": "Find John Smith's parents from 1850 census evidence",
  "source_pid": "ABCD-123",
  "captured": "2026-05-26",
  "researcher_question": "Who were John Smith's parents?",
  "tags": {
    "question_type": "parents",
    "era": "1850s",
    "geography": "US-VA"
  },
  "model": {
    "agent": "claude-sonnet-4-6",
    "judge": "claude-opus-4-8"
  },
  "caps": {
    "wall_clock_seconds": 3600,
    "inactivity_seconds": 600,
    "tool_calls": 200,
    "max_turns": 100,
    "max_cost_usd": 15
  },
  "difficulty": "easy",
  "notes": "Well-attested parentage; should be straightforward."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique slug matching the directory name |
| `name` | string | yes | Short human-readable name |
| `source_pid` | string | yes | FamilySearch PID the fixture was captured from |
| `captured` | string (YYYY-MM-DD) | yes | Date the snapshot was taken |
| `researcher_question` | string | yes | Natural-language question that becomes the `/research` user message |
| `tags` | object | yes | See §4 |
| `model.agent` | string | yes | Pinned agent model |
| `model.judge` | string | yes | Pinned judge model |
| `caps` | object | yes | Stop-condition limits; see §6 |
| `difficulty` | string | no | `easy` / `medium` / `hard` — author's estimate |
| `notes` | string | no | Free-form authoring notes |

### 3.2 `starting-research.json`

A pre-populated `research.json` per `research-schema-spec.md`. At
minimum:

- `project.objective` set to the researcher question
- `project.subject_person_ids` populated
- `project.status` = `in_progress`
- `researcher_profile.narration_guidance` pinned to `"concise"` (so
  the agent's narration style doesn't vary across runs)
- No prior `log`, `sources`, `assertions`, `person_evidence`,
  `conflicts`, `hypotheses`, `timelines`, or `proof_summaries`
  entries — the test starts from "objective declared, no work done"

### 3.3 `starting-tree.gedcomx.json`

The snapshotted tree per `simplified-gedcomx-spec.md`, with the
answer information removed. Typical stripping patterns:

- Drop one or more relatives (e.g., remove the parents)
- Drop sources attached to specific events
- Drop entire events that the question is about

The author of the fixture decides what to strip, calibrated to the
research question.

### 3.4 `expected-findings.json`

Enumerates what the agent must recover. Computed at fixture-creation
time as the diff between the original well-researched tree and the
stripped starting tree, then reviewed and pruned by the author.

```json
{
  "findings": [
    {
      "id": "f1",
      "type": "relationship",
      "description": "John Smith's father is Robert Smith",
      "details": {
        "subject_person": "John Smith (PID ABCD-123)",
        "relation": "parent",
        "target_person": {
          "name": "Robert Smith",
          "birth": "~1820 Virginia"
        }
      },
      "supporting_sources": [
        "1850 US Census, Augusta County VA, household of Robert Smith"
      ],
      "required": true
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Finding ID, local to this fixture (e.g., `f1`, `f2`) |
| `type` | enum | yes | `relationship` / `fact` / `person` / `source` |
| `description` | string | yes | Plain-language description of the finding |
| `details` | object | yes | Structured data — shape varies by `type` |
| `polarity` | enum | no | `recover` (default) or `avoid` — see §3.4.1. Omit for normal recall findings |
| `supporting_sources` | array of strings | no | Source citations from the original tree that support this finding, for the judge to reference (not strict-matched) |
| `required` | boolean | yes | `true` = missing this finding fails the test; `false` = bonus |

Most findings should be `required: true` for v1. The `false` lever
exists for cases where the author is unsure whether a finding is
truly part of the answer.

#### 3.4.1 Negative findings (`polarity: "avoid"`)

A normal finding asks "did the agent recover this?" A **negative**
finding asks "did the agent correctly *decline* to assert this?" — it
names a plausible-but-wrong candidate the agent should **not** conclude.
This is how the benchmark tests restraint from over-claiming, the
failure mode that matters most in genealogy (a wrong parent silently
corrupts an entire upstream tree).

- Set `polarity: "avoid"` and write the `description` to state the
  thing the agent must not conclude (e.g. "The agent should NOT conclude
  that John's father is the *other* Robert Smith of Rockingham County —
  the evidence does not support it").
- For an `avoid` finding, the judge scores `matched: "true"` when the
  agent **correctly avoided** the wrong candidate (it's absent from the
  tree, or present only as an explicitly unresolved/rejected
  hypothesis), and `matched: "false"` when the agent over-claimed it.
- Authoring a negative fixture from a PID: the *cheapest* form strips a
  fact that live FamilySearch genuinely cannot support, where the right
  behavior is the agent declining to assert it. A harder, more realistic
  form uses a person whose relatives are easily confused with similarly-
  named others. Author the realistic ones as you can; start with the
  cheap form.

A fixture may mix `recover` and `avoid` findings. At least one negative
fixture should exist in the suite so over-claiming is sampled (§1).

### 3.5 `README.md`

Human notes. Required content:

- The source PID and confirmation that the person is deceased (FS
  ToS — see §10)
- What was removed from the starting tree and why
- The author's expected difficulty and any notes that would help
  someone reviewing a failed run

---

## 4. Fixture Tags

Every fixture's `tags` object carries at least three dimensions so
the suite isn't N variations of the same shape:

| Tag | Examples |
|-----|----------|
| `question_type` | `parents`, `siblings`, `children`, `spouse`, `birth_date`, `death_date`, `birthplace`, `occupation` |
| `era` | Decade (`1850s`) or century (`19c`) |
| `geography` | Country (`US`) or US state/county (`US-VA`, `US-NY-Albany`) |

Authors may add more tag dimensions as the suite grows
(`record_type`, `ambiguity_level`, etc.). The roll-up report (§9)
groups results by each dimension.

---

## 5. Entry Point: The `/research` Skill

E2E tests invoke the agent via the same entry point a production
user would type: the `/research` skill. The harness sends a single
user message of the form:

```
/research --autonomous <researcher_question>
```

The `--autonomous` flag instructs the skill body to proceed without
pausing for the user. No test-mode system prompt is added; the
e2e test exercises the production code path.

`/research` is specified separately. For the contract that matters
here:

- It primes the agent on the GPS workflow (question-selection →
  research-plan → search-records → record-extraction →
  conflict-resolution → proof-conclusion, iterating as needed)
- It instructs the agent to read `research.json` and decide the
  next sub-skill based on state
- Under `--autonomous`, it does not pause for clarifying questions

---

## 6. Execution Pipeline

1. Harness loads fixture, builds a fresh temp project directory.
2. Copies `starting-research.json` and `starting-tree.gedcomx.json`
   into the temp dir. Mirrors `packages/engine/plugin/skills/` into
   `.claude/skills/` so the agent can invoke them.
3. Invokes the Claude Agent SDK with:
   - `cwd` = temp dir
   - User message = `/research --autonomous <researcher_question>`
   - Allowed tools = all real MCP tools + `Read`, `Write`, `Edit`,
     `Glob`, `Grep`, `Skill`
   - Real MCP server (not the mock used by unit evals). FS auth
     comes from `~/.familysearch-mcp/tokens.json` on the host.
   - Models pinned per `fixture.json::model.agent`.
4. Harness monitors the SDK message stream and periodically reads
   `research.json` to detect the completion signal.
5. Stops on whichever fires first:

   | Signal | `stop_reason` value | Condition |
   |--------|---------------------|-----------|
   | Project completed | `completed` | `research.json::project.status == "completed"` |
   | Inactivity | `inactivity` | No tool calls or messages for `caps.inactivity_seconds` |
   | Wall-clock cap | `timeout` | Elapsed time > `caps.wall_clock_seconds` |
   | Tool-call cap | `tool_cap` | Total tool calls > `caps.tool_calls` |
   | Turn cap | `max_turns` | SDK turn count > `caps.max_turns` |
   | Cost cap | `cost_cap` | Cumulative cost > `caps.max_cost_usd` |
   | SDK natural end | `natural_end` | `stop_reason="end_turn"` with no tool calls |
   | Harness error | `error` | Unhandled exception in the harness or SDK |

6. **Regardless of which signal fired**, the harness reads the final
   `tree.gedcomx.json` and `research.json` from the temp dir.
7. The judge runs (§7).
8. Results are persisted under
   `eval/runlogs/e2e/<test-id>/run-<timestamp>.*` and committed.

---

## 7. Grading

### 7.1 Judge Contract

The judge is a single LLM call against a committed prompt at
`eval/harness/e2e/judge_prompt.md`. Inputs:

- `researcher_question` (string)
- `expected_findings` (array, from `expected-findings.json`)
- `final_tree` (the agent's final `tree.gedcomx.json`)
- `final_research` (the agent's final `research.json` — only its
  `proof_summaries` are used, for the proof-quality axis)

The judge grades **two axes**:

- **Recall (the verdict).** For each finding, decide whether
  `final_tree` contains a semantic equivalent — tolerant of differing
  source IDs, date/place formatting, note wording, and person
  identifier variation (the agent may have created a new person record
  for "Robert Smith" rather than matching a hinted one). Recall is
  graded **from the tree only**: a finding that appears only in
  `proof_summaries` and not in the tree does not count.
- **Proof quality (advisory).** Grade the soundness of the agent's
  written proof statement (`proof_summaries`) for the question:
  exhaustiveness of search, conflict resolution, independent
  corroboration vs. single source, and whether the declared `tier`
  matches the evidence. This is a 1–3 score (or `null` when no proof
  summary exists). It **never gates the verdict** — recall is the
  objective axis, proof quality the subjective one, and we do not let
  the shakier signal flip the firmer one.

**Judge model.** The default is Opus (`claude-opus-4-8`) — semantic
equivalence of persons / dates / places is the core judgment, and a
smaller judge is weakest there. The judge runs once per fixture and
e2e is periodic, so judge cost is negligible. A fixture may override
the model via `fixture.json::model.judge` (e.g. a cheaper model for a
deliberate sweep); the default lives in `judge.py`, not hardcoded.

**Output is structured and fail-loud.** The judge model is constrained
to the §7.2 schema via the Messages API structured-output format, so the
response is valid JSON by construction. The harness then validates the
required keys and **raises rather than coerces** on any violation — there
is no best-effort fallback that could let a malformed verdict "parse"
into a silently wrong result.

**Recall is graded from the tree — the tree is the deliverable.** If the
agent recovered the answer but recorded it only in `research.json`
`proof_summaries` (or on a stub person the judge can't associate with
the principal), the recall verdict counts it a miss. Landing the answer
in the tree is an explicit success criterion of the GPS flow. (The
proof statement is still read — but for the *proof-quality* axis, not to
rescue recall.) `interpret-e2e-result` flags a recorded-elsewhere case
as an *agent* failure to act on, not a judge bug to ignore.

### 7.2 Judge Output

```json
{
  "per_finding": [
    {
      "finding_id": "f1",
      "matched": "true" | "partial" | "false",
      "agent_evidence": "<which tree element supports the match>",
      "notes": "<short rationale>"
    }
  ],
  "recall_required": 0.75,
  "recall_total": 0.67,
  "verdict": "pass" | "partial" | "fail",
  "rationale": "<one paragraph overall justification of the recall verdict>",
  "proof_quality": {
    "score": 1 | 2 | 3 | null,
    "exhaustiveness": "yes" | "partial" | "no" | "na",
    "conflicts_addressed": "yes" | "partial" | "no" | "na",
    "corroboration": "independent" | "single_source" | "na",
    "tier_appropriate": "yes" | "no" | "na",
    "rationale": "<short justification of the proof-quality score>"
  }
}
```

| Field | Description |
|-------|-------------|
| `per_finding[]` | One entry per `expected_findings` entry |
| `matched` | `true` if recovered, `partial` if some details match but key facts diverge, `false` if absent |
| `agent_evidence` | Pointer into `final_tree` showing where the match was found (free text) |
| `recall_required` | Fraction of `required: true` findings that matched (treat `partial` as 0.5) |
| `recall_total` | Fraction across all findings |
| `verdict` | `pass` if all required matched; `partial` if some required matched (or matched/partial); `fail` if none |
| `rationale` | Free-text summary |

### 7.3 Variance and Calibration

Single run per test. Pass rates will jitter run-to-run from LLM
non-determinism; do not over-interpret small deltas in aggregate
trends.

Before the suite grows beyond the first fixture, sanity-check the
judge prompt against the first run trace: if the judge's verdict
diverges from what eyeballing the transcript would say, fix the
prompt before adding more tests.

---

## 8. Result Artifacts

Per run, under `eval/runlogs/e2e/<test-id>/`:

| File | Content |
|------|---------|
| `run-<timestamp>.json` | Structured result: `verdict`, `stop_reason`, `judge_output`, `usage` (tokens / cost / wall-clock), and a `tool_calls` array — each entry `{ tool, args, response_summary }` |
| `run-<timestamp>.transcript.md` | Human-readable transcript of the agent's turns |
| `run-<timestamp>.final-tree.gedcomx.json` | The agent's final tree (input to the judge) |
| `run-<timestamp>.final-research.json` | The agent's final `research.json` |

All four files are committed. To investigate a regression — a test
that previously passed and now fails — diff the old and new
`tool_calls` arrays: each entry's `response_summary` captures the FS
result inline, so collection-hit changes, hint-count shifts, or
record-visibility changes show up directly.

---

## 9. Roll-up Report

At the end of a multi-fixture `run_e2e.py --tag <tag>` invocation,
the harness prints a console summary covering the runs:

```
E2E suite: 7/10 passed, 2 partial, 1 fail
  by question_type:  parents 4/5  siblings 2/3  birth_date 1/2
  by era:            1800s 3/4    1850s 3/4    1900s 1/2
  by geography:      US 5/7       UK 2/3
  avg cost: $3.40 / run     avg wall-clock: 28 min / run
  total cost: $34            total wall-clock: 4h 40min
```

Single function reading the just-written runlogs. No dashboard, no
database. The console output is also the artifact stakeholders see.

---

## 10. Privacy

All fixtures use deceased-person data only. FamilySearch's terms
permit this for FS-sponsored work, which covers this project. Each
fixture's `README.md` states the PID and confirms the person is
deceased. No additional anonymization for v1.

---

## 11. Variance from Live APIs

E2E tests make real FamilySearch API calls. Sources of variance:

- FS re-indexes records — a record findable today may not be
  findable tomorrow, or new records may appear
- Search ranking shifts cause the agent to find records in different
  orders
- Hint quality and visibility evolve

This variance is accepted as a tradeoff for testing against real
data. When a passing test starts failing, first diff the new
`tool_calls` against the last passing run (§8) to distinguish a
genuine agent or skill regression from upstream FS drift before
acting.

---

## 12. Out of Scope (v1)

- Mocking MCP for e2e tests — live calls only
- Full GPS-proof grading with human verification — the proof-quality
  axis (§7) is a single rubric-graded score, not the multi-layer
  human-verified grading of `gps-test-spec.md`
- CI integration of the *live run* — e2e runs are too expensive to gate
  PRs. (A cheap artifact check does run in CI; see §14.)
- Multi-run statistical scoring (N=3) — single run, accepted noise.
  **At project start this is a deliberate "good enough to catch the big
  issues" call, not a permanent one.** Because N=1 + live-FS drift
  (§11) means a single pass→fail flip often can't be cleanly
  attributed, the benchmark reports a **qualitative capability
  picture, not a trend line** — do not quote run-to-run deltas as
  signal. Revisit N=3 on a small tracking subset if a defensible trend
  number is needed later.
- Aggregate trend dashboards across historical runs — manual review
  of committed runlogs is the v1 review surface

---

## 13. Relationship to Other Specs

| Spec | Relationship |
|------|--------------|
| `unit-test-spec.md` | Complementary: unit tests cover skills in isolation with mocked MCP; e2e covers the full autonomous flow with live MCP |
| `gps-test-spec.md` | Different testing approach for the same goal: tests derived from published GPS proof statements, with multi-layer grading and human verification. Held for future work; not active in v1 |
| `research-schema-spec.md` | Defines the shape of `starting-research.json` |
| `simplified-gedcomx-spec.md` | Defines the shape of `starting-tree.gedcomx.json` |
| `eval/CLAUDE.md` | Eval-framework conventions; this spec is the e2e layer |

---

## 14. Fixture Validity Gate

A fixture that the agent can never solve is worthless: every failure is
a false negative on agent capability. Stripping completeness (the
linter, §5 of the testing guide) proves the answer *isn't already in the
starting tree*, but not that it is *recoverable from live FamilySearch*.
The only thing that proves recoverability is a real run that recovered
the findings.

**Rule: a fixture is not landable until at least one committed run log
under `eval/runlogs/e2e/<slug>/` has `verdict: pass` for it.** For a
fixture that is *entirely* negative findings (`polarity: "avoid"`),
"pass" still means the agent behaved correctly — it declined the wrong
candidates — so the same rule holds.

This is enforced two ways:

- **Documentation requirement** — the author runs the fixture for real
  and commits the passing run log alongside it (testing guide §5,
  first-time-setup step 6).
- **CI artifact check** (cheap, no live run) — a PR that adds a
  `eval/tests/e2e/<slug>/` must also add a committed
  `eval/runlogs/e2e/<slug>/run-*.json` with `verdict: pass`. This runs
  in CI because it only reads committed files; it does **not** trigger a
  live e2e run (those stay out of CI per §12).
