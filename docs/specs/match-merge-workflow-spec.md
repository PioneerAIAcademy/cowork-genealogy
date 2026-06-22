# Match + Merge Workflow — Spec

> **Status:** Draft v1 (2026-06-21). A single, combined spec for the
> end-to-end **match + merge** workflow: matching a multi-person record (e.g. a
> census household) to people in `tree.gedcomx.json`, gating the merge on both
> *identity* and *coherence*, then folding the record into the tree. It
> **coordinates existing skills** rather than re-architecting them, and it
> **owns one new MCP capability** — a *merge-mode* (pre-merge, "what-if")
> warnings entry point — plus the data-model additions that capability needs.
>
> This spec is the source of truth for the cross-skill contract. For the
> internal behavior of each step it **references** the existing specs:
> `merge-gedcomx-spec.md`, `person-warnings-tool-spec.md`,
> `same-person-tool-spec.md`, `match-by-id-tools-spec.md`,
> `source-attachments-tool-spec.md`, `research-schema-spec.md`,
> `simplified-gedcomx-spec.md`, and the skill specs under
> `packages/engine/plugin/skills/`.
>
> Warnings behavior is ported from FamilySearch's `MobWarnings.java` (attached
> to Issue #250 as the authoritative reference). §7 and §16 map every ported
> check back to it.

The goal is one reviewable description of how a found record becomes correct
tree data. The worked example throughout (§3) is a census record listing John,
Susan, Bill, and Mary, merged into a tree holding John, Susan, and William.

---

## 1. Why this exists

Today the record→tree flow is real but **distributed across skills with no
single contract**: `search-records` triages, `record-extraction` extracts,
`person-evidence` matches, `proof-conclusion` decides, the `merge_*` tools
execute, and `check-warnings` runs *after* the write. Two things are missing:

1. **No coherence check before a merge is committed.** `person_warnings` only
   evaluates a single anchor already in the tree. There is no way to ask "what
   impossibilities would this merge introduce?" before persisting. The
   `MobWarnings.java` merge-mode checks — most importantly `hasSameCensus` —
   are not ported.
2. **No household-level matching contract.** Matching is per-person and
   pairwise; nothing enforces that the assigned pairs form a coherent family,
   and the relatives that `same_person` and the warnings both rely on are not
   assembled to a defined shape.

This spec closes both gaps **within the existing pipeline split**. It does not
add a new skill (see §5.0) and does not change `merge_record_into_tree`.

---

## 2. Scope

**In scope:**
- The cross-skill orchestration contract for match + merge (§5).
- The two-gate model: identity + coherence (§6).
- The new merge-mode warnings primitive (§7) and the data-model additions it
  requires (§8).
- The matching-mob assembly used by both `same_person` and the warnings (§9).
- The skill updates needed to wire all of the above (§5.0).

**Out of scope (referenced, not re-specified):**
- The internal behavior of `search-records`, `record-extraction`,
  `proof-conclusion`, `tree-edit`, `merge_record_into_tree`,
  `merge_tree_persons` — owned by their existing specs/skills.
- Selective field-level merge tooling and `tree_edit` source-write operations
  (§14).
- Per-sibling relative-mobs — deliberately deferred, matching `warnings.java`
  (§7.2, §14).

---

## 3. The canonical scenario

> We are researching **John**, his wife **Susan**, and their child **William**,
> all present in `tree.gedcomx.json`. We find a **census record** listing
> **John**, **Susan**, **Bill**, and **Mary**. We want to update John, Susan,
> and William with the census information and add **Mary** as a new child.

Expected pairing:

```
merges = [
  [ "<treeJohn>",    "<censusJohn>"  ],   // focus ↔ focus
  [ "<treeSusan>",   "<censusSusan>" ],   // spouse ↔ spouse
  [ "<treeWilliam>", "<censusBill>"  ],   // child ↔ child (nickname identity)
  [ "<stubMary>",    "<censusMary>"  ],   // NEW person, stub-first (§4)
]
```

Note every census persona is **paired** — including Mary, who is created as a
stub first so the merge folds into her rather than carrying her in unpaired
(§4, §5.3). `merge_record_into_tree`'s unpaired carry-in is not used in this
workflow.

---

## 4. Architecture & invariants

- **Coordinate the existing GPS split.** `person-evidence` matches,
  `proof-conclusion` decides, the `merge_*` tools execute. We add the coherence
  gate and the matching contract; we do not collapse or fast-path the split.
  The split is the false-positive-merge guardrail and the coherence gate
  reinforces it.
- **Two orthogonal gates (§6).** *Identity:* "are these the same person?"
  *Coherence:* "does the merged result contain impossibilities?" Both must pass
  (or be explicitly overridden) before a merge is written.
- **stub-first + always-pair.** A record persona with no tree match is created
  as a stub by `person-evidence` (so its assertions can be linked), then merged
  as a *paired* entry. This gives exactly one owner of person creation
  (person-evidence) and removes the duplicate-person path that unpaired
  carry-in would create.
- **Premature-identity constraint.** Extracted assertions stay **unattached**
  (keyed by `record_id` + `record_role`) until `person-evidence` links them.
  Extraction never guesses identity. (Honors the `subject_person_id` concern in
  `docs/gps/skills-convo.md`.)
- **Host/VM split.** Matching (`same_person`), the merge tools, and the new
  merge-mode warnings are **MCP tools** (host). Skills orchestrate them; they
  never compute matches or warnings in the VM.
- **Recovery, not undo (§12).** A research project is a single run; the
  recovery model for a bad merge is "start over." Backups (`*.bak`) are
  retained for accidents but there is no merge receipt / programmatic unmerge.

---

## 5. The pipeline

### 5.0 Skills impacted (no new skills)

| Skill | Change | Magnitude |
|---|---|---|
| `person-evidence` | Household-matching contract (§5.3, §9): assemble the matching mob, cross-person consistency check, emit the `merges` pair-set, stub-first + always-pair. | **Largest** |
| `proof-conclusion` | Insert the coherence gate (§5.4, §6): run the merge-mode warnings dry-run before `merge_record_into_tree`; apply error-block / warning-advisory; drive tiered HITL. Add the merge-mode warnings tool to `allowed-tools`. | **Large** |
| `check-warnings` | Update the "does NOT cover merge-mode" caveat; document the new pre-merge capability. Remains the post-merge *final-mode* owner. | Small |
| `tree-edit` | Doc tweak: in this workflow merges are always-paired; "unpaired carry-in" note becomes "for direct tree-edit use outside the pipeline." | Small |
| `search-records`, `record-extraction`, `research` | Referenced unchanged; verify routing only. | None/minimal |

**Ownership call:** `proof-conclusion` invokes the merge-mode warnings dry-run
directly (it already owns the merge decision and calls `merge_record_into_tree`).
`check-warnings` stays the post-merge guardrail. This keeps `check-warnings` a
one-line update rather than a new invocation path.

### 5.1 search-records *(reference)*

Triage results with `same_person`; check `source_attachments` to detect records
already attached; `record_read` to fetch full simplified GedcomX for the
chosen record. Unchanged.

### 5.2 record-extraction *(reference)*

Extract assertions for **all** personas in the record (John, Susan, Bill, Mary)
into `research.json`, **unattached** (keyed by `record_id` + `record_role`).
Unchanged.

### 5.3 person-evidence — household matching *(new contract)*

The matching step produces the `merges` pair-set. For each record persona:

1. **Assemble the matching mob** for both sides per §9 (focus + parents +
   spouses + children + siblings, capped). The record side comes from the
   record's simplified GedcomX; the tree side from `tree.gedcomx.json`.
2. **Score with `same_person`** (`gedcomx1/primaryId1` = record persona + its
   mob; `gedcomx2/primaryId2` = candidate tree person + its mob). The tool
   forwards the relatives unchanged (§9); the FS algorithm uses them.
3. **Apply the match-threshold policy** (existing person-evidence policy) to map
   score → `speculative | probable | confident`.
4. **Cross-person consistency check.** After all personas are tentatively
   paired, verify the pair-set forms a coherent family: a matched person's
   spouse/parent/child should map to the counterpart's, or be flagged. This
   catches independent-pairwise incoherence (John↔treeJohn but Susan↔a
   *different* tree woman) that no single `same_person` call sees.
5. **stub-first creation.** A persona with no acceptable match (Mary) is created
   via `tree_edit add_person`; its extracted assertions are linked to the stub.
   It then enters `merges` as a **paired** entry (`[stubId, candidateId]`).

Output: the `merges` pair-set + per-pair confidence, handed to
`proof-conclusion`. person-evidence still creates LINKS, never merges.

### 5.4 Coherence gate *(NEW)*

Before any write, `proof-conclusion` runs the merge-mode warnings dry-run (§7)
on the proposed `merges`. The dry-run merges in memory and persists nothing.
Results feed the gate in §6.

### 5.5 proof-conclusion — identity decision

At `probable`+ identity confidence, write concluded facts/relationships via
`tree_edit`, ensure cited sources have GedcomX `S` entries. Then proceed to the
coherence gate result (§6) before executing the merge.

### 5.6 Merge execution

`merge_record_into_tree({ projectPath, candidateGedcomx, merges })` with the
always-paired `merges`. The tree persons survive; census personas fold in
(whole-fold, §15). Mary's stub receives the census-Mary facts.

### 5.7 Post-merge

Run `check-warnings` (final mode) on each affected anchor; verify
`research.json` reference integrity. (`merge_record_into_tree` validates before
persisting and writes nothing on error — `merge-gedcomx-spec.md` §10.)

---

## 6. Gate semantics

A merge is written only when **both** gates pass (or coherence is explicitly
overridden).

**Identity gate** (unchanged): person-evidence match-threshold policy +
`proof-conclusion` at `probable` or higher.

**Coherence gate** (new): the merge-mode warnings dry-run (§7).
- `severity: "error"` → **blocks**. Errors are biological/temporal
  impossibilities; a merge that introduces one signals either a wrong match or a
  bad record. Clearing requires explicit user confirmation **with the
  impossibility shown**, and the override is logged.
- `severity: "warning"` → **advisory**. Improbable-but-possible; surfaced, never
  blocking.

**Ordering:** identity → coherence → write. A coherence `error` is fed back as a
reason to **revisit identity**, not merely dismissed — `hasSameCensus` in
particular is strong evidence the pairing is wrong.

**Tiered human-in-the-loop:**
- Both gates clean → **plan-level confirm** only: "Merge census John/Susan/Bill
  into your John/Susan/William, add Mary as a new child — confirm?" No fact-diff
  burden.
- Any `warning` fires **or** any pair's match score is low → **escalate**: show
  the specific flag / weak pair and the affected facts, and require an explicit
  clear.

---

## 7. Merge-mode warnings primitive

The analog of `MobWarnings.getWarnings(targetMob, candidateMob, mergedMob,
isFinalWarnings)` (`warnings.java`). The current TS port
(`packages/engine/mcp-server/src/tools/person-warnings.ts`) implements only the
single-anchor *final* path; this section specifies the merge-mode path.

### 7.1 Three-mob entry point

The entry point takes **target, candidate, and merged** — not just merged.
Several checks compare target vs candidate *separately*:
`hasSameCensus`, `hasEventsOutsideLifespanFar/Near`,
`missingFactsAndRelatives(target) || missingFactsAndRelatives(candidate)`, and
the `!hasSameMarriageDate(target, candidate)` guard on
`birthLikeRangeGreaterThan8` / `birthRangeGreaterThan3`. The earlier
"merge in memory, check the merged mob" sketch was insufficient.

The merged mob is produced by the existing pure `mergeGedcomx`
(`src/utils/merge-gedcomx.ts`). The entry point wraps target, candidate, and
merged as `Mob`s and runs `calculateWarnings(target, candidate, merged,
isFinalWarnings=false)`.

### 7.2 `calculateNonFinalWarnings` port (merge-only checks)

Run only when `!isFinalWarnings`. Port all 14, **`hasSameCensus` first**:

| # | Check | Inputs | Note |
|---|---|---|---|
| 1 | `hasSameCensus` | target + candidate | Two personas sharing a census collection title cannot be the same person. The strongest census bad-merge signal. Needs collection titles (§8). |
| 2 | `missingSurnames` | merged | |
| 3 | `missingGivenNamesWithoutExactBirthLikeDate` | merged | |
| 4 | `relativesBirthLikeRangeGreaterThan8` | relativeMobs | |
| 5 | `relativesChildBirthRange40` | relativeMobs | |
| 6 | `relativesHasEarlyMarriage14` | relativeMobs | |
| 7 | `relativesTooManyBirthDates2` | relativeMobs | |
| 8 | `relativesTooManyDeathDates2` | relativeMobs | |
| 9 | `relativesHasBurialAfterDeath31` | relativeMobs | |
| 10 | `relativesHasLateMarriage90` | relativeMobs | |
| 11 | `relativesHasEventBeforeBirth365_2` | relativeMobs | |
| 12 | `relativesHasEventAfterDeath1` | relativeMobs | |
| 13 | `relativesHasBurialBeforeDeath` | relativeMobs | |
| 14 | `hasCloseChildChristenings6_30` | merged | |

**Siblings note:** `warnings.java` does **not** build per-sibling relative-mobs
(the sibling lines in `getRelativeMobs` parent/spouse loops are commented out).
Sibling signal lives in the children-as-a-sibling-set duplicate checks
(`similarChildren`, `similarChildrenConflictingDates`, `hasCloseChildBirths`,
`hasCloseChildChristenings`, `childBirthLikeRange`), which the port already has,
plus the siblings inside child-mobs (also present). So no sibling-mob work is
required — the matching gap was the non-final checks above, not siblings.

### 7.3 Final vs non-final gating fix

`warnings.java` gates the §7.2 `relatives*` checks on `!isFinalWarnings` — they
fire only during a merge. The current TS port appears to run several of them
unconditionally in the single-anchor path. The spec requires:
- Single-person/final mode (`person_warnings` today) emits **only** final-mode
  checks (the always-run list + the final-only `similarChildren` /
  `similarSpouses` / `tooManyFathers` / `tooManyMothers` family).
- Merge mode additionally emits the §7.2 set.
- Audit `calculateWarnings` against `warnings.java` during implementation and
  correct any merge-only check leaking into final mode.

### 7.4 MCP surface

**Decision:** expose merge mode as a **new read-only tool** that mirrors
`merge_record_into_tree`'s inputs (so callers reuse the same `candidateGedcomx`
+ `merges` they already hold) and runs the dry-run instead of writing:

```
merge_warnings({ projectPath, candidateGedcomx, merges })
//   merges = [ [treeId, candidateId], ... ]   (same shape as merge_record_into_tree)
//   read-only: builds target/candidate/merged mobs in memory, returns warnings, writes nothing
```

Rationale over adding a `mode`/`candidate` param to `person_warnings`: the
inputs differ fundamentally (a pair-set + a candidate document vs. a single
`personId`), and a separate tool keeps each schema honest. `person_warnings`
remains the single-anchor final-mode tool.

### 7.5 Output shape

```
{
  warningCount: number,
  warnings: [
    {
      scoreType, issueType, severity: "error" | "warning",
      personId, personName,         // who the warning is about (may be a relative or the survivor)
      message,
      factIds?, relatedPersonId?,
      mobRole?: "target" | "candidate" | "merged" | "relative"   // which side surfaced it
    }
  ]
}
```

Mirrors `PersonWarningsResult` (`person-warnings-tool-spec.md`) plus `mobRole`
so the coherence gate can phrase "merging would introduce …".

### 7.6 Invocation

`proof-conclusion` calls `merge_warnings` after the identity gate passes and
before `merge_record_into_tree`. It narrates from the compact result and applies
§6. `check-warnings` is unchanged in role — still the post-merge final-mode pass
(§5.7).

---

## 8. Data-model additions

Each addition updates the **three** places per the repo rule:
`docs/specs/schemas/research.schema.json`, the prose table in
`research-schema-spec.md` / `simplified-gedcomx-spec.md`, and the validator
`packages/engine/mcp-server/src/validation/validator.ts`.

- **Collection titles to the warnings input (for `hasSameCensus`).** The check
  compares the target's source collection title(s) against the candidate's.
  Confirm the simplified format carries source titles on both the tree person
  (its `S` source entries) and the candidate record; if a side lacks a usable
  title, `merge_warnings` accepts them as an explicit side input, and
  `hasSameCensus` degrades to "no match" when titles are absent (never throws).
  Port `MobMergeUtil.TITLE_DELIMITER` splitting and the `"Census"` substring
  test.
- **`EventsOutsideLifespan` helper port.** A separate helper from the
  lifespan>120 check; returns `NEAR_VIOLATION` / `FAR_VIOLATION` comparing
  candidate events against target lifespan. Used by
  `hasEventsOutsideLifespanNear/Far` in the always-run list.

---

## 9. Matching-mob assembly

Used identically for `same_person` (matching) and for building the target /
candidate / relative mobs (warnings).

- **Membership:** focus + parents + spouses + children + **siblings** (siblings
  = children of any of the focus's parents, excluding the focus — the 2-hop set
  `Mob.getSiblings()` already computes, `src/utils/mob.ts`).
- **Cap:** mirror `MAX_CHILDREN_TO_COMPARE = 40` so large families don't bloat
  the payload.
- **Half/full-sibling caveat:** the simplified format can't always distinguish
  co-parentage; include all children of all parents (the FS match algorithm and
  the warnings tolerate this).
- **Tool behavior:** `same_person` is a pass-through (`same-person.ts`,
  `same-person-tool-spec.md` §"Restructuring") — it forwards whatever persons /
  relationships the caller includes and anchors the focus via a
  `sourceDescription`. The assembly is therefore a **caller (person-evidence)**
  responsibility, not a tool change.

---

## 10. Severity catalog (merge-relevant)

**Block (`error`):** `hasSameCensus`, `hasEventAfterDeath1`,
`hasEventBeforeBirth365_2`, `hasChristeningBeforeBirth`, `hasBurialBeforeDeath`,
`hasAgeRangeGreaterThan120`, `hasDeathBeforeChildBirth*`,
`hasEventsOutsideLifespanFar`, `hasChildDeathAfterParentBirth200` — biological/
temporal impossibilities.

**Advise (`warning`):** the parent-age, marriage-timing, too-many-*, similar-*,
close-child, and all `relatives*` / `hasEventsOutsideLifespanNear` checks —
improbable but possible.

The authoritative per-check severities follow
`check-warnings/references/warning-checks.md`; this catalog only fixes the
block/advise split for the gate.

---

## 11. Edge cases & failure modes

- **Re-run / idempotency.** Re-processing a census already merged must be a
  detected no-op, not a duplicate. `source_attachments` (already-attached
  detection) + research-log state drive this; `hasSameCensus` is a backstop.
- **Always-pair → no duplicate persons.** Every census persona is paired
  (matched or stub); unpaired carry-in is not used here (§3, §4).
- **Override logging.** An `error` cleared by the user records the override and
  the shown impossibility.
- **Validation failure.** `merge_record_into_tree` writes nothing on
  `{ ok: false }` (`merge-gedcomx-spec.md` §10).
- **Missing data.** No collection title / no parseable dates → the affected
  check returns no warning silently; the gate never throws on absent data.

---

## 12. Reversibility & recovery

"Recovery, not undo." A project is a single research run; the recovery model for
a wrong merge is **start over**. `*.bak` backups are retained for accidents.
There is no merge receipt and no programmatic unmerge — deliberately, given the
start-over model and the cost of maintaining reversibility metadata.

---

## 13. Testing

- **Unit:** each ported §7.2 check, `hasSameCensus` first (same-census personas
  → blocked); the §7.3 gating fix (final mode must not emit merge-only
  warnings); `EventsOutsideLifespan`.
- **Integration:** the §3 scenario end-to-end — match → coherence gate → merge →
  post-merge warnings — asserting Mary is added once and John/Susan/William are
  updated.
- **e2e:** a fixture under `eval/tests/e2e/` exercising a census-household merge
  with a planted impossibility (verifies the gate blocks).

---

## 14. Out of scope / future

- Selective field-level merge (take only fact X from a candidate) — falls back
  to `tree_edit add_fact` today; no new tool.
- `tree_edit` source-write operations (`add_source` / `update_source`) — still
  hand-done (`skill-rewrites-for-persistence-tools-spec.md`).
- Per-sibling relative-mobs — deferred, matching `warnings.java`.
- Attach-source-only incorporation as a default — rejected in favor of
  whole-fold (§15).

---

## 15. Decisions log

Settled with Dallan over 2026-06-21; recorded so implementation doesn't
re-litigate.

1. **One combined spec** — orchestration + the merge-mode warnings primitive in
   one doc, since the gate is the heart of the workflow.
2. **Two-gate model; errors block.** Identity gate unchanged; coherence gate
   added with `error` → block (override), `warning` → advisory. A coherence
   error is treated as evidence to revisit identity.
3. **Coordinate the existing split** — no new skill, no fast-path, no collapsed
   merge skill (§5.0).
4. **End-to-end as coordination** — the spec owns the new pieces + the
   cross-skill contract and references existing skill specs for internal
   behavior.
5. **stub-first + always-pair** for new persons (Mary); unpaired carry-in unused
   in this workflow.
6. **Tiered HITL** — plan-level confirm when both gates clean; escalate to diff +
   explicit clear on a warning or low match score.
7. **Matching mob = focus + parents + spouses + children + siblings**, capped at
   40; `same_person` forwards relatives, caller assembles them.
8. **Three-mob merge-mode signature** (target + candidate + merged), built on
   `mergeGedcomx`; new read-only `merge_warnings` tool mirroring
   `merge_record_into_tree` inputs.
9. **Whole-fold default** for record incorporation; `tree_edit add_fact` is the
   selective escape hatch.
10. **Recovery, not undo** — start-over recovery model; no merge receipt.

---

## 16. References & `warnings.java` mapping

- Single-anchor / final warnings: `MobWarnings.getFinalWarnings` /
  `calculateFinalWarnings` → existing `person_warnings`
  (`person-warnings-tool-spec.md`).
- Merge warnings: `MobWarnings.getWarnings(target, candidate, merged,
  isFinalWarnings)` → new `merge_warnings` (§7).
- Merge-only checks: `MobWarnings.calculateNonFinalWarnings` → §7.2 (14 checks).
- Relative-mob synthesis: `MobWarnings.getRelativeMobs` →
  `src/utils/mob.ts getRelativeMobs` (parents + spouses + children; no
  sibling-mobs, matching Java).
- The deterministic merge: `mergeGedcomx` (`merge-gedcomx-spec.md`).
- Matching primitive: `same_person` (`same-person-tool-spec.md`).
- Already-attached detection: `source_attachments`
  (`source-attachments-tool-spec.md`).
