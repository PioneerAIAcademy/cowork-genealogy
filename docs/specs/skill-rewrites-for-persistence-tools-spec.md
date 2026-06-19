# Skill rewrites for the structured-persistence + deterministic tools — Spec

> **Status:** Consolidated (2026-06-19). Supersedes the wave-1-only draft of this
> file. Now covers **both** migration waves, organized **by skill** so every
> `SKILL.md` is rewritten **once** even when both waves touch it. (Filename is
> historical — the scope is all the migration tools, not just persistence.)
>
> **Do this after the tools land**, not before — a rewrite is only as stable as
> the tool contract it targets, and the contracts are now shipped:
> - **Wave 1** (on `main`, #397): `merge_record_into_tree`, `merge_tree_persons`,
>   `research_log_append`, and the `record_search`/`fulltext_search` `projectPath`
>   staging + shared write layer.
> - **Wave 2** (branch `deterministic-skill-tools`, PR #400): `convert_calendar`,
>   `tree_edit`, `research_append`.

This is the contract for editing the **`SKILL.md` files and their `references/`**
to call those tools instead of hand-editing JSON / doing arithmetic by hand. No
MCP-server code changes here.

---

## 1. Why this exists

Every consuming skill ends its write path with the same anti-pattern: *hand-assemble
JSON (or compute arithmetic) → call `validate_research_schema` → fix errors →
re-serialize the whole file*. The tools replace that clerical seam with one call
that takes the judgment as input and does the mechanical work (id assignment,
validation-before-persist, atomic write, supersede-not-delete, calendar
arithmetic). The skill keeps every analytical decision. A determinism audit of all
26 skills found the hand-work concentrated in exactly the skills below;
`check-warnings` is already migrated (it calls `person_warnings`).

---

## 2. The tools each rewrite targets

| Tool | Wave | Replaces (hand-work) |
|------|------|----------------------|
| `merge_tree_persons` / `merge_record_into_tree` | 1 | hand person-merge / folding a record into the tree |
| `research_log_append` (+ `record_search`/`fulltext_search` `projectPath` staging) | 1 | hand log entry + `results/` sidecar + chunking |
| `convert_calendar` | 2 | in-context calendar arithmetic |
| `tree_edit` | 2 | ad-hoc single-entity `tree.gedcomx.json` edits |
| `research_append` | 2 | hand-written `research.json` section entries/updates |

---

## 3. The rewrite pattern (apply to every skill)

1. **Replace the hand-JSON / arithmetic step with the tool call** (the per-skill
   recipes in §4 name the exact call).
2. **Trim the now-obsolete mechanical guidance** from `references/` — sidecar
   mechanics, chunking, id-allocation, the "Update ALL references" cleanups, the
   regime/offset tables (kept only as identification reference).
3. **Drop the post-write `validate_research_schema` call.** Every tool
   validates-before-persist and writes nothing on `{ ok: false, errors }`. Soften
   `references/validation-protocol.md` step 1 accordingly; **keep step 2
   (`check-warnings`)** — genealogical plausibility is not structural.
4. **Keep the judgment** — the analytical decisions the tool takes as input.
5. **Add the recovery fallback** where relevant (e.g. a TTL-expired
   `staged.resultsRef` → re-run the search; surface `{ ok: false }` rather than
   retrying blindly).
6. **Update frontmatter `allowed-tools`** — add the new tool(s); `validate_research_schema`
   may be dropped where it was only the post-write backstop.
7. **Verify** per the layered testing guides (Inspector → Claude Code → Cowork).

---

## 4. Per-skill rewrites

### 4.1 `tree-edit` — BOTH waves (rewrite once)
- **Wave 1 — "Person merging" (Steps 1–5 + the worked example):** replace the
  whole hand protocol with `merge_tree_persons({ projectPath, merges })`
  (`[survivorId, collapsedId]` pairs) — or `merge_record_into_tree({ projectPath,
  candidateGedcomx, merges })` when folding a `record_read` candidate. Narrate from
  the tool's compact summary; the tool repoints all four `research.json` person-id
  refs (closing the hand protocol's `known_holdings` gap).
- **Wave 2 — "Ad-hoc edits":** each subsection → a `tree_edit` operation —
  `add_fact` / `update_fact` / `add_name` / `update_name` / `update_person` /
  `add_person` / `add_relationship` / `remove` (facts/relationships only). The tool
  assigns ids, swaps primary/preferred, and auto-resolves `standard_place`.
- **Trim:** the merge worked-example; `relationship-accuracy.md` post-merge cleanup
  list; "Update ALL references" and "edits in place by id" from Important rules /
  Re-invocation. **Keep:** survivor-selection convention, "merges are irreversible /
  confirm pairs when identity is uncertain," "ad-hoc edits should be rare," and
  **running `check-warnings` after every edit/merge.**

### 4.2 `search-records`, `search-full-text`, `search-external-sites` — Wave 1 (+ a wave-2 touch)
- **The search call:** add `projectPath` to `record_search` / `fulltext_search`;
  the response gains a `staged` handle.
- **Retain + log:** delete the hand sidecar-write and the verify-count step; call
  `research_log_append({ projectPath, planItemId, tool, query, outcome,
  resultsExamined, resultsAvailable, notes, stagedResultsRef: staged.resultsRef })`.
  `search-external-sites` passes `tool: "external_site"` + `externalSite` and **no**
  `stagedResultsRef` (no sidecar ever; it appends twice per loop — URL-generated then
  capture-received).
- **Wave-2 touch — plan-item status (Step 6/7/9):** route the `plans[].items[].status`
  mutation through `research_append({ section: "plan_items", op: "update", planId,
  entryId, fields: { status } })`.
- **Trim:** the four `references/research-log-protocol.md` sidecar/chunking copies and
  the post-write validate guidance. **Recovery:** a TTL-expired `staged.resultsRef`
  → re-run the search (cheap, re-stages).

### 4.3 `record-extraction` — BOTH waves (rewrite once)
- **Wave 1 — Step 4:** route the `user_provided` log entry through
  `research_log_append` (nil sidecar), and when the source came from a staged
  `record_search`, pass `staged.resultsRef`.
- **Wave 2 — Steps 1/3/5a:** `research_append({ section: "sources", op: "append" })`
  for the `src_` entry, then one `research_append({ section: "assertions", op:
  "append" })` per assertion (including negative assertions) — the tool assigns each
  id and validates each, removing the "write first persona, then Edit-append the
  rest" chunking dance.
- **Trim:** the sidecar/log-protocol references; the by-hand "next available id"
  guidance; the post-write validate step. **Keep:** all extraction judgment (BCG
  objectivity, one-fact-per-assertion, classification values, source-reuse decision).

### 4.4 `convert-dates` — Wave 2 (the cleanest consumer)
- Replace the "deterministic arithmetic you perform in context" paragraph and the
  Step-3 hand-arithmetic bullets with one `convert_calendar({ date, corrections })`
  call, requesting **only** the corrections the user asked for (the "answer only the
  question asked" rule is now structural). Narrate from `applied[].rule` / `notes[]`
  / `converted`.
- **Trim:** none of the regime tables — **keep** them and `references/calendar-conflicts.md`
  as the identification reference (deciding *which* corrections apply stays the LLM's
  judgment). Output-only behavior unchanged (the tool writes nothing).

### 4.5 `conflict-resolution` — Wave 2
- **Create (Step 2):** `research_append({ section: "conflicts", op: "append" })`.
  **Resolve (Steps 3–5):** `research_append({ section: "conflicts", op: "update",
  entryId, fields: { independence_analysis, weighing_analysis, resolution_rationale,
  preferred_assertion_id, status: "resolved" } })` — the tool enforces the
  resolved-completeness + `preferred ∈ competing` invariants.
- **Calendar artifact check (Step 4):** call `convert_calendar` (read
  `applied[].offsetDays`) for the expected offset instead of computing 10/11/12/13 by
  hand. **Keep** `references/historical-contradictions.md` and the weighing judgment.

### 4.6 `assertion-classification` — Wave 2
- **Step 6:** `research_append({ section: "assertions", op: "update", entryId,
  fields: { information_quality, informant, informant_proximity, evidence_type, … } })`
  — never `append` (this skill only refines). The immutable-field list becomes
  structural (you only pass classification fields). **Keep** `references/three-layer-model.md`
  in full (pure classification judgment).

### 4.7 `person-evidence` — Wave 2 (two tools)
- **Step 4 link:** `research_append({ section: "person_evidence", op: "append" })`.
- **Step 5 stub person:** `tree_edit({ operation: "add_person" })` (tool allocates
  the synthetic `I`/`N` ids).
- **Step 6 revision:** two calls — `append` the corrected `pe_` link, then `update`
  the old entry's `superseded_by` (never delete).

### 4.8 `hypothesis-tracking` — Wave 2
- **Create:** `research_append({ section: "hypotheses", op: "append" })`. **Update /
  status transitions (active → supported / ruled_out):** `op: "update"` with the
  status + (for ruled_out) `ruled_out: true, ruled_out_reason` (validator enforces
  the reason). The Step-3 age arithmetic stays plain LLM reasoning.

### 4.9 `research-exhaustiveness` — Wave 2
- **Steps 4/5:** `research_append({ section: "questions", op: "update", entryId,
  fields: { status: "exhaustive_declared", exhaustive_declaration: { declared,
  log_entry_ids, stop_criteria } } })`. Early termination → `declared: false` form.
  Re-declaring an already-declared question is a structural no-op. **Keep**
  `references/research-exhaustiveness.md` in full.

### 4.10 `question-selection` — Wave 2
- **Step 4:** `research_append({ section: "questions", op: "append" })`. **Supersede:**
  `op: "update"` setting `status: "superseded"` (preserves the id; never delete).

### 4.11 `research-plan` — Wave 2
- **Step 5:** `research_append({ section: "plans", op: "append" })` for the plan
  shell, then `research_append({ section: "plan_items", op: "append", planId })` per
  item. **Re-plan (Step 6):** `op: "update"` on the old plan → `status: "superseded"`
  (at most one active plan per question — the tool enforces it).

### 4.12 `proof-conclusion` — BOTH waves (rewrite once)
- **Wave 2 — Step 5:** `research_append({ section: "proof_summaries", op: "append" })`.
- **Wave 2 — Step 6 tree updates (tier ≥ probable):** route each through `tree_edit`
  (add source / `add_fact` / `update_fact`); a tier-downgrade removal →
  `tree_edit({ operation: "remove", factId | relationshipId })`.
- **Wave 1 — Step 6 person merging:** `merge_tree_persons` (or `merge_record_into_tree`).
- **Step 7 — DO NOT resolve the question here.** Proof-conclusion deliberately
  does **not** write the `questions` section — marking a question `resolved` (and
  setting `resolved` / `resolution_assertion_ids`) is `question-selection`'s job,
  and `exhaustive_declaration` is `research-exhaustiveness`'s. Leave §7 ("Do not
  modify the question") intact. (An earlier draft of this spec wrongly listed a
  `research_append` questions-update here — that reverses the skill's standing
  ownership boundary and must not be applied.)
- **Trim:** Step 6's hand S-entry field table and the manual primary swap; the
  post-write validate step.
- **Known limits (leave hand-done):** the `S` source-description entry in
  `tree.gedcomx.json` (Step 6) — `tree_edit` has no source operation yet, so the
  source write stays by hand; and `project.status` (Step 8) — `research_append`
  has no `project` section yet (§5 gap).

---

## 5. Cross-cutting

- **Rewrite both-waves skills once.** `tree-edit`, `record-extraction`, and
  `proof-conclusion` are each touched by both waves — do a single pass per file so
  the `SKILL.md` is edited once (the whole reason this spec is consolidated).
- **Supersede-not-delete coordination.** `question-selection` / `research-plan` /
  `research-exhaustiveness` / `proof-conclusion` all transition `questions` /
  `plans` status via `research_append` `op: "update"`; keep their supersede rules
  aligned (the tool makes deletion structurally impossible).
- **Known gap — `project.status`.** `proof-conclusion` Step 8 sets
  `project.status: "completed"`, but `research_append` has no `project` section yet
  (deferred). Until it does, that one update stays hand-done (or extend
  `research_append` with a `project` single-object section — small follow-up).
- **Known gap — tree source descriptions.** `record-extraction` (the `S` entry)
  and `proof-conclusion` (Step 6 "ensure every cited source has a GedcomX `S`
  entry") write `tree.gedcomx.json` `sources[]`, but `tree_edit` has no source
  operation. Those source writes stay hand-done until `tree_edit` gains
  `add_source` / `update_source` (a small follow-up to the tree-edit tool).
- **`allowed-tools` frontmatter** updated per skill; `validate_research_schema`
  dropped where it was only the post-write backstop (it remains a user-invokable
  audit tool).

---

## 6. Suggested ordering

Wave-2-only, single-tool skills first (lowest risk): `convert-dates`,
`assertion-classification`, `hypothesis-tracking`, `research-exhaustiveness`,
`question-selection`, `research-plan`, `conflict-resolution`. Then the
`research_append`+`tree_edit` skill `person-evidence`. Then the both-waves skills
(`tree-edit`, `record-extraction`, `proof-conclusion`). The three search skills can
go any time (wave-1 dominant). Each skill is an independent, verifiable PR.

---

## 7. Verification (per `docs/*-testing-guide.md`)

For each rewritten skill, in a scratch project: drive the skill, confirm the tool
call replaces the hand-write, the persisted JSON is correct, `validate_research_schema`
is clean, and (for tree/merge skills) `check-warnings` still runs. Confirm the
recovery fallbacks (stale `stagedResultsRef`; `{ ok: false }` errors surfaced).

---

## 8. Non-goals

- No MCP-server code changes (all tools shipped).
- No change to the reverse-lookup provenance model (`log_entry_id` on sources/assertions).
- No new shared-reference mechanism for the duplicated `references/` copies (per CLAUDE.md, they stay duplicated and are each trimmed).
- The `project`-section `research_append` extension (§5 gap) is a separate follow-up.
