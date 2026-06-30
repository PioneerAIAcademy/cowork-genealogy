# `research_append` — research.json section writer — Spec

> **Status:** New (2026-06-19). The broader sibling of the **shipped**
> `research_log_append` (`research-log-editor-spec.md`). That tool owns the one
> append-only section (`log[]` + its sidecars); this one owns the **other**
> mutable `research.json` sections — sources, assertions, person_evidence,
> questions, plans, conflicts, hypotheses, known_holdings, timelines. It is the
> single largest remaining hand-edited-JSON surface in the skill catalog and the
> home for the state-coupling invariants the skill-determinism audit surfaced.
> The log was split out and shipped first because of its two-file atomic write +
> sidecar integrity; the machinery it proved (id assignment, validate-before-
> persist, atomic write, compact return) is reused wholesale here.

```
research_append({ projectPath, section, op, entry | entryId + fields }) -> compact summary
```

One tool with a `section` + `op` discriminator. The LLM supplies the analytical
content (the assertion's value, the conflict's weighing, the question text); the
tool assigns the section's id, enforces the schema and the cross-field invariants,
preserves the supersede-not-delete rule structurally, and does the validate-before-
persist atomic write.

---

## 1. Why this exists

Per `research-schema-spec.md:143`: *"Append-only sections (`log`) are never
rewritten. All other sections allow field updates but skills must preserve IDs and
never delete entries — supersede with a status field instead."* Today every one of
those "all other sections" is written **by hand** across ~8 skills, each ending in
the re-serialize-and-revalidate loop this tool direction exists to kill:

- **Id allocation by hand** — every section uses a prefix + next-number id
  (`src_`, `a_`, `pe_`, `q_`, `pl_`, `pli_`, `c_`, `h_`, `t_`, `kh_`); the LLM
  computes "next available" and can collide or skip.
- **Supersede-not-delete is prose, not structure** — `person_evidence` revision
  sets `superseded_by` on the old entry (`research-schema-spec.md:431`); a stray
  delete breaks the audit trail. Only a tool can make it structural.
- **Cross-field invariants are prose the LLM must remember** — and the validator
  already hard-fails on them after the fact: `exhaustive_declaration` requires
  `log_entry_ids` non-empty and `stop_criteria` non-null when `declared`
  (`validator.ts:417–424`); a fact conflict needs ≥2 `competing_assertion_ids`,
  identity ≥1 (`validator.ts:607–611`); a `ruled_out` hypothesis needs
  `ruled_out_reason` (`validator.ts:637–638`). Enforcing these *before* the write
  turns "validation failure, fix, re-serialize" into "rejected with a clear error,
  nothing written."
- **Multi-entry / multi-file writes re-serialize large JSON** — `record-extraction`
  writes a source + many assertions and is told to "write first persona, then
  Edit-append the rest" — the same large-JSON failure mode the log tool removed.

---

## 2. Evidence base (seen directly)

| Fact | Source |
|------|--------|
| Section ownership + mutability table ("Mutable; never delete, supersede with status") | `docs/specs/research-schema-spec.md:131–143` |
| Only `log` is append-only; all other sections allow field updates, preserve ids, never delete | `research-schema-spec.md:134, 143, 291` |
| `person_evidence` revision sets `superseded_by`, never deletes | `research-schema-spec.md:427, 431` |
| `plans`: re-plan creates a new plan, old one set `superseded`; search skills update only `items[].status` | `research-schema-spec.md:133, 265` |
| id prefixes per section | `src/validation/validator.ts` `ID_PREFIXES` (`src_/a_/pe_/q_/pl_/pli_/c_/h_/t_/kh_`) |
| Coupling invariants already validated post-hoc | `validator.ts:417–424` (exhaustive_declaration), `:607–611` (conflict), `:637–638` (hypothesis) |
| The shipped append template: id/timestamp assignment, validate-before-persist, atomic write, compact return, camelCase→snake_case | `src/tools/research-log-append.ts`, `research-log-editor-spec.md` |
| Shared write layer | `src/utils/project-io.ts` (`atomicWriteJson`), `src/validation/validator.ts` (`validateParsed`) |

---

## 3. The tool

```typescript
research_append({
  projectPath: string,
  section:
    | "sources" | "assertions" | "person_evidence"
    | "questions" | "plans" | "plan_items"
    | "conflicts" | "hypotheses" | "known_holdings" | "timelines",
  op: "append" | "update",

  // op = "append": a new entry WITHOUT its id (the tool assigns the prefix id).
  entry?: object,

  // op = "update": target an existing entry by id and supply the fields to change.
  entryId?: string,          // e.g. "c_003" — must match `section`'s prefix
  fields?: object,           // shallow-merged onto the existing entry; ids immutable

  // plan_items append/update target their parent plan:
  planId?: string,           // required for section = "plan_items"
})
```

camelCase at the boundary; the entry/fields are already the snake_case persisted
shape (the skill writes simplified project JSON directly). The tool renames any
camelCase convenience fields the same way `research_log_append` does.

### 3.1 Semantics

- **`append`** — assign the next `<prefix>NNN` id above the section's current max
  (max + 1, never count + 1), set any tool-owned timestamps (`created`), append to
  the section array (or, for `plan_items`, to `plans[planId].items`), validate,
  persist. Returns the assigned id.
- **`update`** — locate the entry by `entryId`, shallow-merge `fields`, **preserving
  the id and never removing the entry**. A status transition (e.g. a plan →
  `superseded`, a question → `resolved`) is an `update`. There is **no delete op** —
  the supersede-not-delete rule is structural (`research-schema-spec.md:143`).
- **`update` on the `project` singleton** — `project` is one object, not a list, so
  it has no id and no `append`: `op:"update"` shallow-merges `fields` (restricted to
  `allowedFields: ["status"]`) onto `research.project`, and the tool stamps
  `project.updated` (iso_date). `proof-conclusion` Step 8 uses this to set
  `project.status: "completed"`. The return's `entryId` echoes the section name
  (`"project"`). Making another field settable later = extend `allowedFields`.

### 3.2 Return value (compact — never echoes the section)

```typescript
{
  ok: true,
  section: string,
  op: "append" | "update",
  entryId: string,                 // assigned (append) or echoed (update)
  filesWritten: ["research.json"],
  validation: { valid: true, warnings: string[] },
}
// on failure: { ok: false, errors: string[] } — nothing written
```

### 3.3 Batch form (`ops`) — persist a whole record in one call

To persist many entries at once (e.g. a record's source + every assertion + its
person-evidence links), pass an optional `ops` array instead of the top-level
`section`/`op`/`entry`/`entryId`/`fields`/`planId` (which are ignored when `ops`
is present). Each op is the same per-op shape the single form takes:

```typescript
research_append({
  projectPath,
  ops: [
    { section: "sources",         op: "append", entry: {...} },
    { section: "assertions",      op: "append", entry: {...} },   // one op per assertion/persona
    { section: "person_evidence", op: "append", entry: {...} },   // one op per link
    { section: "assertions",      op: "update", entryId: "a_012", fields: {...} },
    { section: "plan_items",      op: "append", entry: {...}, planId: "pl_001" },
  ],
})
// → { ok: true, results: [{ section, op, entryId }, ...], filesWritten: ["research.json"], validation }
// on failure: { ok: false, errors: ["ops[<i>]: <msg>"] } — nothing written
```

Semantics — heterogeneous ops chosen over a homogeneous `entries` array because the
skills' natural unit of work (one record / household / plan) spans multiple sections,
and the single-call form already dispatches per-op on `section`, so heterogeneity is
no more expensive (decision: `docs/plan/e2e-research-runtime-speedup-plan.md` §6 Q1):

- **All-or-nothing.** Every op is applied to one in-memory `research`, the **whole
  document is validated once**, and `research.json` is written **once**. Any op's
  precondition failure (§5) or a final validation failure writes **nothing** and
  returns `{ ok: false, errors }`.
- **Per-op error indexing.** A precondition failure on op *i* (an `applyOne` check —
  bad section, missing field, the §5 invariants enforced in-loop) returns its
  message(s) prefixed `ops[<i>]: …`, so the caller can fix one row without losing the
  rest. A failure caught only by the **final whole-document validation** (e.g. a
  cross-section reference, or a §5 rule the validator owns such as the fact-conflict
  competing-count) is reported with its `research.json/…` path instead, since it is
  not attributable to a single op in the loop.
- **Intra-batch id assignment.** Ids are assigned in array order, each scanning the
  live in-memory document, so consecutive appends to a section get consecutive ids.
  A later op **may reference an id created by an earlier op** via that id's
  predictable `<prefix>NNN` (e.g. append the source as op #1, then an assertion op
  carries `source_id: "src_001"`). A later op **may NOT `update`** an id created
  earlier in the same batch — `append` assigns the id internally, so it cannot be
  named for an in-batch update; do that update in a follow-up call.
- **No-op ops** (e.g. re-declaring an already-exhaustive question) do not mutate; a
  batch of only no-ops writes nothing (`filesWritten: []`). `results` still echoes a
  row for every op (no-ops included), and any per-op no-op note is surfaced in
  `validation.warnings`; the `results` rows do not themselves flag which op was a no-op.
- **Section invariants (§5) hold across the batch** — e.g. two `append`s of an active
  plan for the same question in one batch are rejected at the second op, because the
  first is already in the live `research.plans` when the second's invariant runs.

The **persisted shape is byte-identical** to the single-op form; `ops` changes only
the number of write calls, so no `research.json` schema, validator, web-mirror, or
fixture change is required (the reason batching is low-risk).

---

## 4. Persistence — validate-before-persist, atomic, single-file

Mirrors `research_log_append` minus the sidecar:

1. Read `research.json` (and `tree.gedcomx.json`, for the cross-file checks
   `validateParsed` runs).
2. Apply the `append`/`update` in memory — id assignment, field merge, tool-owned
   timestamps.
3. **Enforce the section invariants (§5) as preconditions.** A violation returns
   `{ ok: false, errors }` and writes nothing — the same verdict the validator
   would give, but *before* the write.
4. **Validate** with `validateParsed(research, tree, { projectPath })`. If invalid →
   write nothing.
5. Commit `research.json` with `atomicWriteJson`.

Only `research.json` is written. No `.bak` (this section, unlike the irreversible
merges, is append/supersede with full history-in-file — the GPS audit trail is the
recovery mechanism; consistent with `research_log_append`).

---

## 5. State-coupling invariants enforced as preconditions

These are today prose rules repeated across skills (some 3×) precisely because they
are easy to violate by hand. As tool preconditions they become structural (the
audit's recommendation #5):

| Section / op | Invariant (reject if violated) | Source |
|--------------|-------------------------------|--------|
| `conflicts` append (fact) | ≥2 `competing_assertion_ids`; identity ≥1 | `validator.ts:607–611` |
| `conflicts` update → `resolved` | `independence_analysis`, `weighing_analysis`, `resolution_rationale` all set; `preferred_assertion_id` ∈ `competing_assertion_ids` | audit; `validator.ts` NULLABLE set |
| `hypotheses` update → `ruled_out`/`status: ruled_out` | `ruled_out_reason` non-empty | `validator.ts:637–638` |
| `questions` update → `exhaustive_declared` | `exhaustive_declaration.declared` true ⇒ `log_entry_ids` non-empty and `stop_criteria` non-null; a re-declare on an already-declared question is a **no-op short-circuit** (don't overwrite a settled GPS Component-1 record) | `validator.ts:417–424` + audit |
| `plans` append | at most **one active plan per question** — a second `active` plan for the same `question_id` is rejected | audit; `research-schema-spec.md:265` |
| `person_evidence` revision | revision is an `append` of the new entry **plus** an `update` setting `superseded_by` on the old one; never a field-overwrite-in-place that loses the prior link | `research-schema-spec.md:427–431` |
| any section | `entry` for `append` must NOT carry an `id`; `update` must NOT change the `id` or the entry's prefix | `research-schema-spec.md:101` |

The LLM still makes every substantive decision and supplies the fields — the tool
only refuses to persist a structurally incoherent combination.

---

## 6. Decisions recorded

- **One tool with `section` + `op`, not per-section tools.** Same rationale as
  `tree_edit` and the repo's "generic tools with parameters, not one per endpoint"
  rule: all sections share the read → apply → enforce → validate → write pipeline;
  only the id prefix, field shape, and invariant set differ, and those are data
  (a per-section table), not separate code paths. *Rejected:* `append_assertion`,
  `append_conflict`, … (10+ near-identical tools).
- **`append` + `update`, no `delete`.** The schema forbids deletion outside `log`'s
  append-only model; supersede-via-status is the only "removal." Encoding that as
  "there is no delete op" makes the rule unbreakable.
- **Name kept as `research_append`** despite also doing `update`, to match the
  established reference in the project memory and `research-log-editor-spec.md:268`.
  The `op` discriminator carries the append-vs-update distinction; rename to
  `research_write` is a cosmetic option for the implementor.
- **Field shapes are referenced, not re-specified.** `research-schema-spec.md` §5 is
  the source of truth for each section's required fields, enums, and id prefix
  (and `validator.ts` is its executable form). This spec defines the tool's
  *mechanical contract* and the *invariants*, not a second copy of the field tables —
  the same "trust the existing source of truth" stance the merge spec takes toward
  the shipped core.

---

## 7. Scope & phasing

**In scope:** the mutable `research.json` sections listed in §3 (the
`research-schema-spec.md:131–143` ownership table minus `log`).

**Suggested phase 1** (highest frequency, unblocks the most skill rewrites):
`sources`, `assertions`, `person_evidence` (the `record-extraction` /
`assertion-classification` / `person-evidence` write paths — the multi-entry
re-serialize hazard). **Phase 2:** `questions`, `plans`/`plan_items`, `conflicts`,
`hypotheses` (the status-transition + invariant sections). **Phase 3 / deferred:**
`timelines` (its *build* — supersede-filter + chronological sort + gap/impossibility
analysis — is a richer "timeline-build" operation the audit flagged separately; the
plain entry write fits here, the computed build may warrant its own tool),
`proof_summaries`, `evaluations`, and `project`/`researcher_profile` skeleton
(written once by `init-project`).

**Out of scope:** `log[]` + sidecars (shipped: `research_log_append`);
`tree.gedcomx.json` (the merge tools + `tree_edit`, `tree-edit-tool-spec.md`).

---

## 8. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `projectPath` missing/invalid `research.json` or `tree.gedcomx.json` | input error; write nothing |
| `op: append` with an `entry` that carries an `id` | input error (the tool assigns ids) |
| `op: update` with an `entryId` not found in `section` (or wrong prefix) | staleness error; write nothing |
| `op: update` `fields` attempting to change `id` | input error |
| `section: plan_items` without a resolvable `planId` | input error |
| A §5 invariant violated | input error with the specific rule; write nothing |
| Resulting `research.json` fails `validateParsed` | write nothing; `{ ok: false, errors }` |

---

## 9. Test plan (vitest)

- **append assigns max + 1 id** per section prefix; gap-tolerant (`a_001..a_003, a_009 → a_010`).
- **append validates** — a malformed assertion is rejected, nothing written.
- **update preserves id + supersede** — setting `superseded_by` on the old
  `person_evidence` entry while appending the new one; old entry never removed.
- **status transition** — question → `exhaustive_declared` rejected when
  `log_entry_ids` empty; accepted when satisfied; re-declare is a no-op.
- **conflict invariants** — fact conflict with <2 competing rejected; resolve
  without `weighing_analysis` rejected.
- **hypothesis** — `ruled_out` without reason rejected.
- **one-active-plan** — a second active plan for a question rejected.
- **plan_items** — appended into the right parent plan's `items`.
- **append-only enforced** — there is no delete op; an update never shrinks an array.
- **camelCase→snake_case** — persisted entry uses snake_case keys.
- **atomicity** — a validation failure leaves `research.json` byte-unchanged.

---

## 10. Consumers / wiring

Standard MCP tool: `src/tools/research-append.ts`, schema in `allToolSchemas`,
dispatch in `src/index.ts`, name in `manifest.json` (packaging drift test enforces
parity). Reuses `atomicWriteJson` + `validateParsed`; share the per-prefix max-id
helper with `tree_edit`/the merge core (lift `maxIdNum` to a shared util).

Consumers — the skills whose hand-written section writes it replaces:
`record-extraction` (sources + assertions), `assertion-classification` (classification
field updates), `person-evidence` (`pe_` links + supersede), `conflict-resolution`
(conflict append + resolve), `hypothesis-tracking`, `research-exhaustiveness`
(exhaustive_declaration), `question-selection`/`research-plan` (questions, plans,
plan-items), `proof-conclusion` (question resolution). Their SKILL.md rewrites are a
follow-up (companion to `skill-rewrites-for-persistence-tools-spec.md`), not part of
this tool's landing.
