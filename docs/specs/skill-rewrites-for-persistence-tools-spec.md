# Skill rewrites for the structured-persistence tools — Spec

> **Status:** New (2026-06-19). Companion to the four structured-persistence
> tool work items (`validate-project-refactor-spec.md`, `merge-gedcomx-spec.md`
> §5b, `research-log-editor-spec.md`, `search-result-staging-spec.md`). Those
> shipped the **tools**; this spec covers the **skill rewrites** that switch the
> consuming skills from hand-done persistence to those tool calls. Deliberately
> split out so the tools could land and be unit-tested in isolation first.

The MCP tools now exist and are unit-tested:

| Tool | Replaces hand-work in |
|------|------------------------|
| `merge_record_into_tree`, `merge_tree_persons` | `tree-edit` "Person merging" |
| `research_log_append` | the log + sidecar write in `search-records`, `search-full-text`, `search-external-sites`, `record-extraction` |
| `record_search` / `fulltext_search` new optional `projectPath` (returns a `staged` handle) | the sidecar-payload write in `search-records`, `search-full-text` |

This spec is the contract for editing the **`SKILL.md` files and their
`references/`** to call those tools. No MCP-server code changes here.

---

## 1. Why this exists

The hand-done versions are the error-prone clerical work the tools were built to
remove: a hand-merge that can miss a reference or collide ids, and a hand-written
log + sidecar whose `returned_count` integrity and `results_ref`↔`log_id`↔filename
wiring the LLM has to get right, with a documented large-payload failure mode
("write in ~40-result chunks"). Each rewrite deletes that mechanical guidance and
replaces it with one tool call; the skill keeps only the **analytical** decisions
(who merges, was the outcome negative, what to put in `query`/`notes`).

A latent correctness win comes for free: the current `tree-edit` merge protocol
(SKILL.md "Step 3") repoints only `subject_person_ids`, `person_evidence`, and
`timelines` — it **omits `known_holdings.relates_to_person_ids`**.
`merge_tree_persons` repoints all four (driven by the shared `PERSON_ID_REF_FIELDS`
walker), so the rewrite closes that gap.

---

## 2. Scope

In scope: editing these skill folders under `packages/engine/plugin/skills/`:

- `tree-edit/SKILL.md`
- `search-records/SKILL.md` + `search-records/references/research-log-protocol.md`
- `search-full-text/SKILL.md` + its `research-log-protocol.md`
- `search-external-sites/SKILL.md` + its `research-log-protocol.md`
- `record-extraction/SKILL.md` + its `research-log-protocol.md`

Out of scope: the MCP tools themselves (shipped), and any skill that only *reads*
the log/tree. The four `research-log-protocol.md` copies are duplicated per the
repo's "no shared SKILL.md reference loading" rule (CLAUDE.md) — each must be
edited; they are not symlinked.

---

## 3. `tree-edit` — rewrite "Person merging"

Replace the hand protocol (current SKILL.md Steps 1–5, names/facts/relationships
dedup + research-ref edit + delete + log) with a **tool selection** step:

- **Folding a candidate record just read with `record_read` into the tree** →
  call **`merge_record_into_tree`** with `{ projectPath, candidateGedcomx, merges }`,
  where `merges` is `[treeId, candidateId]` pairs the skill chose (via `same_person`
  / proof-conclusion). It writes only `tree.gedcomx.json`.
- **Collapsing two persons already in the tree** (e.g. two father records that
  turn out to be the same) → call **`merge_tree_persons`** with
  `{ projectPath, merges }` (`[survivorId, collapsedId]` pairs). It rewrites
  `tree.gedcomx.json` and repoints every `research.json` person-id reference.

The skill **no longer**: dedups names/facts by hand, repoints relationships,
hand-edits `research.json` refs, deletes the deprecated person, or calls
`validate_research_schema` (the tool validates structurally before persisting and
writes nothing on failure). The skill **still**:

- makes the analytical merge decision (which ids pair) — the tool never decides who
  is the same person;
- narrates from the tool's compact summary (per-pair name/fact counts, new-relative
  ids, `researchRefsUpdated`) without ever holding the merged tree;
- runs **`check-warnings`** after the merge (genealogical-plausibility checks —
  e.g. parent younger than child — are not structural and remain a skill step);
- handles `{ ok: false, errors }` by surfacing the error (e.g. a stale `merges` id
  that no longer exists on disk) rather than retrying blindly.

Note the **recovery** caveat from `merge-gedcomx-spec.md` §5b.2: a merge is
irreversible. The tools write a one-deep `.bak`, but the skill should still confirm
the merge pairs with the user when the identity decision is anything short of
certain.

---

## 4. `search-records` / `search-full-text` — stage + append

Two changes:

1. **Pass `projectPath`** on the `record_search` / `fulltext_search` call. The
   response gains a `staged` handle (`{ resultsRef, returnedCount }` on a hit,
   `null` on a nil search). The model-facing `results[]` are unchanged — staging
   only affects *persistence*, not *triage*.
2. **Replace the hand-written log entry + sidecar** with a single
   **`research_log_append`** call, passing `staged.resultsRef` as `stagedResultsRef`.
   The tool assigns the `log_` id, `performed` timestamp, `results_ref`, and the
   whole sidecar envelope (including a recomputed `returned_count`).

For a **nil search**, omit `stagedResultsRef` (or pass null) — no sidecar is
written, `results_ref` is null.

**Recovery:** if `research_log_append` rejects a `stagedResultsRef` (e.g. the staged
file aged out past its 24h TTL in a long multi-turn session, or the turn died), the
skill re-runs the search — re-staging is cheap. Document this one-line fallback.

---

## 5. `search-external-sites` — append only

External-site searches write **no sidecar**. Replace the hand-written log entry
with `research_log_append` passing `externalSite: { site, urlGenerated,
captureReceived, captureFilename? }` and `tool: "external_site"`; do **not** pass
`stagedResultsRef`. The tool renames to the snake_case `external_site` shape on
persist.

---

## 6. `record-extraction` — append the `user_provided` entry via the tool

`record-extraction` writes a `user_provided` log entry when no search skill logged
the record (`research-log-protocol.md` §"When record-extraction writes log
entries"). Route that write through `research_log_append` as well — typically a nil
sidecar (the record came from the user, not a search), so no `stagedResultsRef`.

---

## 7. Trim the four `research-log-protocol.md` copies

Delete the now-obsolete mechanical guidance from each copy:

- the **"Result sidecar files"** sidecar-writing mechanics, the **"≤40 results /
  ~40-result chunks"** chunking rule, and the **"If retention fails"** fallback —
  the tool counts and writes deterministically or fails the whole append atomically;
- the hand-maintained `returned_count` and the three-way `results_ref`/`log_id`/
  filename wiring — the tool wires all three by construction.

**Keep** the analytical rules: log every search (including nil), what belongs in
`query` / `notes`, when a negative outcome is meaningful, and the append-only
intent (now structurally enforced by the tool). Reframe the section as "call
`research_log_append` with these fields" + the judgment rules.

---

## 8. Verification (manual, layered per `docs/*-testing-guide.md`)

- **tree-edit:** in a scratch project, fold a `record_read` candidate into a focus
  person (`merge_record_into_tree`) and collapse two existing tree persons
  (`merge_tree_persons`); confirm `tree.gedcomx.json` updates, `research.json` refs
  repoint (Mode 2), a `.bak` is written, and the project still validates.
- **search-records / search-full-text:** run a real search with `projectPath`,
  then `research_log_append` with the returned `staged.resultsRef`; confirm the
  `results/<log_id>.json` sidecar appears, `returned_count` matches, the
  `.staging/` file is gone, and `validate_research_schema` is clean.
- **search-external-sites / record-extraction:** confirm the log entry persists in
  snake_case with `results_ref: null` and no sidecar.

---

## 9. Non-goals

- No MCP-server code changes (the tools are shipped and unit-tested).
- No change to the reverse-lookup provenance model — downstream skills still link
  to a log entry via `log_entry_id` on sources/assertions.
- Not a new shared-reference mechanism for the four protocol copies (the per-skill
  duplication stands, per CLAUDE.md).
- No `research_append` for the other `research.json` sections (separate effort).
