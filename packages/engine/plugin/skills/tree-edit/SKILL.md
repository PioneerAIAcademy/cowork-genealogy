---
name: tree-edit
model: claude-sonnet-4-6
description: Direct edits to tree.gedcomx.json — add fact, correct value,
  create person, add relationship, merge two persons (confirmed
  identical via proof-conclusion), verify the tree already reflects a
  known fact (no-op), check FamilySearch record matches/hints, or check
  for possible duplicates. Use when the user says "correct this name",
  "change birth year", "add occupation", "merge these two persons",
  "fix this fact", "add a relationship", "verify the tree reflects
  this", "check the tree", "make sure the tree shows", "confirm this
  fact is in the tree", "what records are attached", "what hints does
  FamilySearch have", "check record matches", "find possible
  duplicates", "check for merge candidates". Do NOT use to search
  records (search-records), write a conclusion (proof-conclusion), link
  assertions to persons (person-evidence), or extract facts from a
  newly-found record (record-extraction — facts flow extraction →
  proof-conclusion → tree).
allowed-tools:
  - place_search
  - place_search_all
  - tree_edit
  - tree_correct
  - merge_tree_persons
  - merge_record_into_tree
  - person_record_matches
  - person_person_matches
---

# Tree Edit

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — resolve with `place_search` / `place_search_all` and record the `standardPlace` (and `standard_place` on persisted facts/assertions/events).

Handles direct modifications to `tree.gedcomx.json`. Two use cases: **ad-hoc corrections** (fixing typos, updating dates, adding facts not from the formal pipeline) and **person merging** (combining two GedcomX persons confirmed identical by proof-conclusion, with full referential integrity across both project files).

## References

- `references/evidence-grounded-edits.md` — When edits are justified, source support requirements
- `references/relationship-accuracy.md` — Relationship types, merge implications

## Ad-hoc edits

Each ad-hoc edit is one tool call: **additions** (`add_*`) go through `tree_edit`; **corrections and removals** (`update_*`, `remove`) go through `tree_correct` — same batched `ops[]`, id rules, validate-on-write, and `.bak` semantics, split only by op authority. Supply content WITHOUT ids — the tool assigns the next `F`/`N`/`I`/`R` id, swaps primary/preferred, resolves `standard_place`, validates the whole project, and writes only `tree.gedcomx.json`. On `{ ok: false, errors }` nothing is written — surface those errors rather than retrying.

**Actually call `tree_edit`/`tree_correct` — do not describe the edit or print a summary of what you "would" write.** The change isn't real until the tool call returns `ok: true`; narrate the result only from that returned summary, never from a fabricated one.

```
tree_edit({
  projectPath: "<absolute-path-to-project-directory>",
  operation: "add_fact",
  personId: "KWCJ-RN4",
  fact: {
    type: "Occupation",
    date: "1870",
    place: "Schuylkill County, Pennsylvania",
    sources: [{ ref: "S2", page: "1870 Census, dwelling 201" }]
  }
})
```

Other additions via `tree_edit`: `add_person` · `add_relationship` · `add_source`. Corrections and removals via **`tree_correct`**: `update_fact` (by `factId`) · `update_name` (by `nameId`) · `update_person` (gender/ark) · `update_source` (by `sourceId`) · `remove` (factId or relationshipId only — the one permitted deletion, when proof-conclusion withdrew a conclusion; never removes a person). For corrections pass only the changed fields — e.g. fix a wrong death date with `tree_correct({ projectPath, operation: "update_fact", personId: "I1", factId: "F2", fact: { date: "1908-03-12" } })`. When something already exists at that id, use `update_*` via `tree_correct` rather than adding a duplicate.

### Writing facts correctly

- **Dates must be GedcomX-parseable.** Write a bare year (`1773`), an ISO date (`1908-03-12`), or a spelled date (`12 March 1908`); record any approximation in the source `page` or your reply, not in the `date` string.
- **Couple-event facts go on the `Couple` relationship, not on a person.** Marriage, Divorce, and other couple events belong in the relationship's `facts` array — supply them in the `add_relationship` call itself: `relationship: { type: "Couple", person1, person2, facts: [{ type: "Marriage", date, place, sources }] }`. A Marriage written as a person `add_fact` misplaces the event. See `references/relationship-accuracy.md`.

## Person merging

When proof-conclusion confirms two persons are the same individual, execute the merge here. The tool does all clerical work (folding names/facts, repointing relationships, repointing every `research.json` reference, removing the collapsed person); your job is to pick the survivor and confirm pairs.

**Survivor-selection:** prefer the FamilySearch ID over a synthetic stub; otherwise the most complete record; otherwise the id in `project.subject_person_ids`.

- **Both persons in the tree:** call `merge_tree_persons({ projectPath, merges: [[survivorId, collapsedId]] })` — returns a compact summary of folded name/fact counts and `researchRefsUpdated`.
- **Record candidate from `record_read`:** call `merge_record_into_tree({ projectPath, candidateGedcomx: <gedcomx field of record_read result>, merges: [[treeId, candidateId]] })` — unpaired candidate persons carry in as new relatives with fresh ids.

**Once you've picked the survivor and gotten the user's go-ahead, actually call the merge tool — do not stop at a plan or report a merge you haven't executed.** The merge is real only when the tool returns `ok: true`; narrate the folded counts from that returned summary, never from a description of what you intend to do.

On `{ ok: false, errors }` neither tool writes anything — surface the errors.

## Record and duplicate checking

When the user asks what records are attached or what hints exist, call `person_record_matches({ id: "KWCJ-RN4" })` — returns accepted, pending, and rejected matches.

When the user asks about possible duplicates or merge candidates, call `person_person_matches({ id: "KWCJ-RN4" })` — returns possible-duplicate tree persons. This surfaces candidates only; merge decisions still require proof-conclusion.

Both tools require a FamilySearch ID (`4:1:` ARK or bare personId). Synthetic `I`-prefix ids are local stubs — FamilySearch has no match data for them.

## Validation

`tree_edit`, `tree_correct`, `merge_tree_persons`, and `merge_record_into_tree` all validate-before-persist; no separate `validate_research_schema` call is needed. After ANY edit or merge, run **`check-warnings`** to catch genealogical impossibilities the structural validator cannot (impossible dates, relationship loops, etc.).

## Important rules

- **Merges are irreversible in practice.** Present the merge plan and get confirmation before executing: "I will merge I5 (James Flynn, stub) into KWCJ-RN7 (James Patrick Flynn). This will update 3 person_evidence entries and 1 timeline. Proceed?"
- **Only merge when proof-conclusion confirms identity.** The threshold is a `probable` or higher proof_summary confirming the two persons are the same. Never merge on a speculative link or unresolved hypothesis.
- **Preserve the more complete record.** Keep the person with more data and the more authoritative ID (FamilySearch ID > synthetic).
- **Ad-hoc edits should be rare.** Most tree updates come through the formal pipeline (record-extraction → person-evidence → proof-conclusion → tree-edit). Direct edits are for corrections and confirmed merges, not for bypassing the GPS process.

## Decision rules for ambiguous situations

**Conflicting facts during merge:** Keep BOTH facts on the surviving person when no proof conclusion specifies which value is correct, and flag for proof-conclusion to resolve. Do not silently discard either value.

**Relationship type unknown:** When a source shows a person in a household without clarifying the connection (biological, adoptive, step, foster), record the relationship without asserting a specific subtype. Do not default to biological.

**Edit without source support:** Ask the user to identify the source. Typo corrections verifiable against an already-cited source may proceed; otherwise require at least one source reference before writing.

**Relationship threshold not met:** Apply the threshold from `references/relationship-accuracy.md`. If not met, explain what is needed and suggest proof-conclusion first.

**Conflicting evidence not yet resolved:** Do not pick a side. Tell the user to resolve the conflict in proof-conclusion before editing the tree.

**Requested state already satisfied:** If what the user asks for already exists in `tree.gedcomx.json` with the correct value and supporting source, make NO changes. Report: "No edit needed — F1 already reflects this with source S1." Do NOT add `confidence`, `notes`, or any field not in `docs/specs/simplified-gedcomx-spec.md` §4.2 — the audit trail belongs in your reply, not in tree fields.

**Do not duplicate:** If the person, relationship, or fact already exists at an id, use `update_*` (via `tree_correct`) against that id rather than adding a second entry.

## Re-invocation behavior

**Writes:** persons, relationships, names, and facts in `tree.gedcomx.json` via `tree_edit`/`tree_correct` and the merge tools. A person merge additionally repoints every `research.json` reference to the deprecated id — `project.subject_person_ids`, `person_evidence[].person_id`, and `timelines[].person_ids` — onto the surviving person.

**Re-running against existing state:** update in place; never duplicate. If the target person, relationship, or fact already exists at an id, use the matching `update_*` operation (via `tree_correct`) against that id rather than an `add_*`. If the requested value and its supporting source are already present, make no change and report the no-op (see "Requested state already satisfied" above).
