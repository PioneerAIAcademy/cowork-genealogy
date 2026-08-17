# `project_context` — compact project-state projection — Spec

> **Status:** New (2026-07-12, extractor state diet). The read-side companion
> of the structured writer tools (`research_append`, `tree_edit`): where those
> removed "re-serialize large JSON to write," this removes "re-read large JSON
> to think." One call returns the judgment-relevant projection of
> `research.json` + `tree.gedcomx.json`; the caller never opens either file.

```
project_context({ projectPath }) -> compact projection (read-only)
```

---

## 1. Why this exists

The record-extractor agent runs in a fresh context per delegation and used to
open with a full read of `research.json` and `tree.gedcomx.json` — both of
which grow monotonically over a session. On capped e2e runs (~10 extractor
delegations per run) those fresh-context re-reads dominated cost: the
cruz-corona run made **143 `Read` calls** and hit **$19.12** against a $15
cap; 3 of 5 e2e runs hit the cap. Every mechanical lookup the reads served
has moved into the writer tools (source-reuse detection into
`research_append` §3.4.1; the §5d household sequence into `tree_edit`
`add_household_children`); what remains is a small set of **judgment
context** facts:

- which questions are open (to fill `extracted_for_question_ids`);
- which tree persons exist, their preferred names/genders, and which `S`
  entries they already cite (the alternate-name rule: a record persona that
  IS an existing tree person under a variant spelling);
- which sources exist, per repository, covering which `record_id`s (to
  narrate reuse and route refinement requests);
- the project status.

That projection is a few hundred tokens where the raw files are tens of
thousands. This tool computes it host-side.

## 2. The tool

```typescript
project_context({ projectPath: string })
```

Read-only: opens `research.json` and `tree.gedcomx.json`, writes nothing,
never creates a `.bak`. Not a validator — malformed *entries* are skipped
defensively rather than reported (only an unreadable/unparseable file is an
error); `validate_research_schema` remains the diagnosis tool.

### 2.1 Return value

Wire-side **camelCase** (a tool output, not a persisted document — the
repo's identifier-casing rule):

```typescript
{
  ok: true,
  projectStatus: string | null,          // research.project.status
  openQuestions: [{
    id: string,                          // q_*
    question: string,                    // truncated to ≤140 chars (139 + "…")
  }],
  questionStatuses: [{                   // ADVISORY — see below. One per question,
    id: string,                          //   including resolved ones.
    state: "framed" | "planned" | "searching"
         | "evidence-gathered" | "concluded" | "critiqued",
    nextStep: string | null,             // null = nothing outstanding
    openConflictIds: string[],           // unresolved conflicts bearing on it
  }],
  persons: [{
    id: string,                          // I id (or FS id)
    name: string | null,                 // preferred names entry, "Given Surname"
    gender: string | null,
    sourceRefs: string[],                // distinct S ids cited anywhere on the person
  }],
  sources: [{
    id: string,                          // src_*
    repository: string | null,
    gedcomxSourceDescriptionId: string | null,
    recordIds: string[],                 // distinct record_id values across its assertions
    assertionCount: number,              // assertions with source_id = this id
  }],
}
// on failure: { ok: false, errors: string[] }
```

Projection rules:

- **`openQuestions`** — every `research.questions[]` entry whose `status` is
  not `resolved` (i.e. `open`, `in_progress`, `exhaustive_declared`), in
  array order. `question` text over 140 characters is truncated to 139 + a
  `…` (the id is the handle; the text is a reminder, not the record).
- **`persons`** — every `tree.persons[]` entry, in array order. `name` is
  the `preferred: true` names entry (first names entry when none is
  flagged), rendered `given surname` (whichever parts exist; `null` when the
  person has no names). `sourceRefs` collects the distinct `ref` values of
  every source reference on the person — person-level `sources`, each
  fact's `sources`, and each name's `sources` — in first-seen order.
- **`sources`** — every `research.sources[]` entry, in array order.
  `recordIds` are the distinct `record_id` values (verbatim, first-seen
  order) across `research.assertions[]` entries whose `source_id` is this
  source's id; `assertionCount` counts those assertions.
- **`projectStatus`** — `research.project.status`, `null` when absent.

The tree is read as-is (no `sanitizeTree` healing pass — a read-only
projection must not imply a migration); traversal is defensive, skipping
non-object entries.

### 2.2 `questionStatuses` — advisory, and deliberately not a gate

Per **question**, never per project: a project holds several questions at
several states at once, so any single project-wide phase is wrong on arrival.

The ladder is monotonic on what was **produced**, not on tidiness — a question
with a proof summary is `concluded` even if its plan is thin, because the
artifact is what every downstream check joins on.

| state | reached when |
|---|---|
| `framed` | the question exists, no plan references it |
| `planned` | a plan carries `question_id` = this question |
| `searching` | a log entry names one of that plan's items |
| `evidence-gathered` | an assertion lists it in `extracted_for_question_ids` |
| `concluded` | a proof summary carries `question_id` = this question |
| `critiqued` | every such summary has a live `proof-critique` evaluation |

`nextStep` orders by what blocks what: an unresolved conflict outranks a missing
critique, which outranks a missing resolve, which outranks a missing summary. A
superseded verdict does not count — a replacement is itself present and satisfies
the join; if nothing replaced it, the critique no longer stands.

**`critiqued` is the last rung of the ladder, not the end of the work.** The
ladder tracks what was *produced*, and the `resolved` write produces nothing, so
it has no rung of its own — but it is still outstanding, and it is the transition
no skill body claims. A question that is `critiqued` and not yet resolved reports
that resolve as its next step. `nextStep` is null only when the question is both
`critiqued` and resolved.

**Nothing gates on this field, and that is the design.** `research_append`
computes its completion preconditions independently, so this can never be the
reason a write is refused. Two consequences worth stating so they are not
"tidied" later:

- It reports the same condition the completion gate refuses on **and** the
  resolved-with-no-proof-summary case that gate deliberately lets pass. Advising
  on more than is enforced is correct here: a prompt costs nothing when wrong.
- Because it cannot refuse, it cannot cause an availability regression, which is
  what makes it safe to ship ahead of the experiment measuring whether it changes
  routing at all. A state machine that could *deny* activity would have to infer
  intent the document does not carry.

The same predicates were first written against the committed e2e corpus, where
they reproduced an independent count of the completion gate's population to
within two runs.

## 3. Decisions recorded

- **A projection, not a query language.** One fixed shape, no field
  selectors — the consumer is one agent prompt, and a stable shape is what
  lets that prompt say "check `persons[].sourceRefs`". *Rejected:* jq-style
  path parameters (open-ended context cost, un-promptable).
- **No assertion bodies.** Per-assertion detail (values, classifications) is
  deliberately excluded — it is exactly the growing payload the diet
  removes. Refinement flows get the specific `a_` ids from the delegating
  caller, who holds file access.
- **camelCase output.** This is an MCP wire surface. The snake_case source
  fields (`gedcomx_source_description_id`, `record_id`) are renamed at the
  boundary like every other tool.

## 4. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `research.json` / `tree.gedcomx.json` missing or invalid JSON | `{ ok: false, errors }` |
| empty project (no questions/persons/sources) | `ok: true` with empty arrays |
| question with a >140-char text | truncated to 139 chars + `…` |
| person with no names / no preferred flag | `name` falls back to the first names entry, else `null` |
| assertions whose `source_id` matches no source | ignored (the validator reports dangling refs, not this tool) |

## 5. Test plan (vitest)

- **populated project** — projection correctness: open-vs-resolved question
  filtering; preferred-name rendering; `sourceRefs` unioned (distinct) across
  person/fact/name references; per-source `recordIds` (distinct, verbatim)
  and `assertionCount`; `projectStatus` echoed.
- **empty project** — empty arrays, `ok: true`.
- **truncation** — a 200-char question comes back at 140 chars ending in `…`;
  a 140-char question is untouched.
- **missing file** — `{ ok: false, errors }`.

## 6. Consumers / wiring

Standard MCP tool: `src/tools/project-context.ts`, schema in
`allToolSchemas` (`src/tool-schemas.ts`), dispatch in `src/index.ts`, name in
`manifest.json` (packaging drift test enforces parity). Registered as a
**live tool** in the eval harness (`eval/harness/harness/mock_mcp.py`
`LIVE_TOOLS`) with a real input-schema mirror — it is a deterministic
function of workspace state, so a fixture cannot honestly answer it.

Consumer: the `record-extractor` agent (one call per invocation, replacing
its up-front file reads — its `tools:` list holds `project_context` and no
`Read`). Future extraction-adjacent agents should reuse this projection
rather than re-reading project files.
