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
  - merge_tree_persons
  - merge_record_into_tree
  - person_record_matches
  - person_person_matches
---

# Tree Edit

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — resolve with `place_search` / `place_search_all` and record the `standardPlace` (and `standard_place` on persisted facts/assertions/events).

Handles direct modifications to `tree.gedcomx.json` — the simplified
GedcomX deliverable. This skill covers two main use cases:

1. **Ad-hoc corrections:** Fixing typos, updating dates, adding facts
   that don't come through the formal extraction pipeline
2. **Person merging:** Combining two GedcomX persons confirmed to be
   the same individual, with full referential integrity across both
   project files

## References

Load these for detailed guidance on specific topics:

- `references/evidence-grounded-edits.md` — When edits are justified,
  avoiding premature conclusions, source support requirements
- `references/relationship-accuracy.md` — Distinguishing relationship
  types, merge implications, biographical context
- `references/validation-protocol.md` — Post-edit validation steps

## Ad-hoc edits

Each ad-hoc edit is one `tree_edit` call. Supply the content WITHOUT
ids — the tool assigns the next `F`/`N`/`I`/`R` id, swaps the
primary/preferred flag, resolves `standard_place` for any place,
validates the whole project, and writes only `tree.gedcomx.json`. It
returns a compact summary of the assigned ids; on a validation failure
nothing is written and it returns `{ ok: false, errors }` — surface
those errors to the user rather than retrying blindly.

### Adding a fact to a person

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

The tool resolves `standard_place` from `place` automatically. If the
fact should be the primary of its type, set `primary: true` in `fact` —
the tool clears `primary` from any existing fact of the same type.

### Correcting a value

Use `update_fact` (by `factId`), `update_name` (by `nameId`), or
`update_person` (gender/ark) and pass only the fields to change:
- Change given name: `tree_edit({ ..., operation: "update_name",
  personId, nameId, name: { given: "Margaret" } })`
- Fix birth year: `tree_edit({ ..., operation: "update_fact",
  personId, factId, fact: { date: "1849" } })`
- Correct a place: pass the new `place` in `fact` for `update_fact` —
  the tool re-resolves `standard_place`

### Adding a person

```
tree_edit({
  projectPath: "<absolute-path-to-project-directory>",
  operation: "add_person",
  person: {
    gender: "Female",
    names: [{ preferred: true, given: "Margaret", surname: "Flynn", type: "BirthName" }]
  }
})
```

The tool assigns a synthetic `I` id and the `N` name id. Omit `ark` for
a synthesized stub.

### Adding a relationship

```
tree_edit({
  projectPath: "<absolute-path-to-project-directory>",
  operation: "add_relationship",
  relationship: {
    type: "ParentChild",
    parent: "KWCJ-RN4",
    child: "I8",
    sources: [{ ref: "S4", page: "Will Book 12, p. 247" }]
  }
})
```

Use `parent`/`child` for ParentChild, `person1`/`person2` for Couple;
the endpoints must be existing person ids.

### Removing concluded data (tier downgrade)

When proof-conclusion revises a tier downward to `not_proved` or
`disproved`, remove the previously concluded fact or relationship:

```
tree_edit({ projectPath: "<absolute-path-to-project-directory>", operation: "remove", factId: "F8" })
```

Pass exactly one of `factId` or `relationshipId`. This is the ONE case
where removing data from tree.gedcomx.json is permitted (the conclusion
was withdrawn); `remove` never deletes a person — duplicate persons are
collapsed via `merge_tree_persons`.

## Person merging

When proof-conclusion confirms two GedcomX persons are the same
individual, this skill executes the merge. This is a mechanical
data operation — proof-conclusion made the analytical decision. The
merge tool does all the clerical work (folding names/facts, repointing
relationships, repointing every research.json reference, removing the
collapsed person); your job is to pick the survivor and confirm the
pairs.

**Survivor-selection convention.** Keep the person with:
- The FamilySearch ID (if one has it and the other is a synthetic
  stub), or
- The most complete data, or
- The ID referenced by `project.subject_person_ids`

### Collapsing two persons already in the tree

When both people are already in `tree.gedcomx.json` (e.g. two father
records that were never merged), call `merge_tree_persons` with
`[survivorId, collapsedId]` pairs:

```
merge_tree_persons({
  projectPath: "<absolute-path-to-project-directory>",
  merges: [["KWCJ-RN7", "I5"]]
})
```

The survivor (`KWCJ-RN7`) is kept; the collapsed person (`I5`) folds
into it (names/facts merged, never discarded) and is removed;
relationships are repointed; and every research.json reference to the
collapsed id (subject persons, person_evidence, timelines,
known_holdings) is repointed to the survivor. Both files are written
both-or-neither and not returned — narrate from the compact summary
(the per-pair name/fact counts and `researchRefsUpdated`).

### Folding a record candidate into the tree

When the data to merge comes from a `record_read` candidate (after
deciding via `same_person` / proof reasoning which record persons match
tree persons), call `merge_record_into_tree` with the candidate's
simplified GedcomX and `[treeId, candidateId]` pairs:

```
merge_record_into_tree({
  projectPath: "<absolute-path-to-project-directory>",
  candidateGedcomx: <the `gedcomx` field of the record_read result>,
  merges: [["KWCJ-RN7", "p1"]]
})
```

The tree person survives; the candidate folds into it; unpaired
candidate persons are carried in as new relatives with fresh ids
(reported in `newRelatives`). research.json is not modified by this
call.

Note: this unpaired carry-in is for **direct tree-edit use outside the
match+merge pipeline**. In that pipeline `person-evidence` stubs every
record persona first (always-pair), so `proof-conclusion` passes a fully
paired `merges` set and nothing is carried in unpaired — see
`docs/specs/match-merge-workflow-spec.md` §4.

On a validation failure either merge tool writes nothing and returns
`{ ok: false, errors }` — surface the errors to the user rather than
retrying blindly.

## Record match checking

When the user asks what records are attached or matched to a tree person
(e.g. "what records does FamilySearch have for this person?", "are there
any pending hints for them?"), call `person_record_matches` with the
person's FamilySearch ID:

```
person_record_matches({ id: "KWCJ-RN4" })
```

This returns accepted, pending, and rejected record matches. Use it to:
- Report which records are already attached (`status: "accepted"`)
- Surface pending hints the user should review (`status: "pending"`)
- Show what was already ruled out (`status: "rejected"`)

Only call this tool when the person has a FamilySearch ID (`4:1:` ARK
or bare personId like `"KWCJ-RN4"`). Synthetic IDs (`I` prefix) are
local stubs — FamilySearch has no match data for them.

## Person duplicate checking

When the user asks whether a tree person has duplicates or merge
candidates (e.g. "find possible duplicates for Patrick", "are there
any duplicate persons for KWCJ-RN4?", "check for merge candidates"),
call `person_person_matches` with the person's FamilySearch ID:

```
person_person_matches({ id: "KWCJ-RN4" })
```

This returns possible-duplicate tree persons. Use it to:
- Surface merge candidates for the user to evaluate
- Confirm no duplicates exist before other operations

Only call this when the person has a FamilySearch ID (`4:1:` ARK or
bare personId). Synthetic IDs (`I` prefix) are local stubs with no
FamilySearch tree persona. This tool surfaces candidates only — actual
merge decisions require proof-conclusion confirmation first.

## Validation

`tree_edit`, `merge_tree_persons`, and `merge_record_into_tree` all
validate-before-persist: they write nothing on `{ ok: false, errors }`,
so a separate `validate_research_schema` pass after an edit is no longer
needed. After ANY edit (ad-hoc or merge), run **`check-warnings`** to
catch genealogical impossibilities the structural validator cannot
(married before 12, child born after a parent's death, a merge that put
the same person on both ends of a relationship, etc.). See
`references/validation-protocol.md`.

## Important rules

- **Merges are irreversible in practice.** Double-check before
  executing. Present the merge plan to the user and get confirmation:
  "I will merge I5 (James Flynn, stub) into KWCJ-RN7 (James Patrick
  Flynn). This will update 3 person_evidence entries and 1 timeline.
  Proceed?"
- **Only merge when proof-conclusion confirms identity.** Never
  merge based on a speculative person_evidence link or an unresolved
  hypothesis. The threshold is: proof-conclusion has written a
  conclusion at `probable` or higher confirming the two persons are
  the same.
- **Preserve the more complete record.** When in doubt about which
  person to keep, keep the one with more data and the more
  authoritative ID (FamilySearch ID > synthetic ID).
- **Ad-hoc edits should be rare.** Most tree updates come through
  the formal pipeline (record-extraction → person-evidence →
  proof-conclusion → tree-edit). Direct edits are for corrections
  and merges, not for bypassing the GPS process.

## Decision rules for ambiguous situations

**Conflicting facts during merge:** If both persons have the same
fact type (e.g., two different birth dates) and no proof conclusion
specifies which value is correct, keep BOTH facts on the surviving
person and flag the conflict for proof-conclusion to resolve. Do not
silently discard either value.

**Relationship type unknown:** When a source shows a person in a
household but does not clarify the nature of the connection (biological,
adoptive, step, foster), record the relationship without asserting a
specific subtype. Do not default to biological.

**User requests an edit without source support:** Ask the user to
identify the source. If the edit is a typo correction verifiable against
an already-cited source, proceed. Otherwise, require at least one source
reference before writing to the tree.

**User wants to add a relationship directly:** Apply the threshold from
`references/relationship-accuracy.md` (proof conclusion, direct evidence
from a reliable source, or corroborated indirect evidence). If the
threshold is not met, explain what is needed and suggest using
proof-conclusion first.

**Conflicting evidence not yet resolved:** Do not pick a side. Tell the
user to resolve the conflict in proof-conclusion before editing the tree.

**Requested state already satisfied:** If the user asks to add, verify,
or ensure something that already exists in `tree.gedcomx.json` with the
correct value AND the supporting source, make NO changes. Report
explicitly: "No edit needed — R1 (or F1, P1, etc.) already reflects this
with source S1." Do NOT add `confidence`, `notes`, or any field not
listed in `docs/specs/simplified-gedcomx-spec.md` §4.2 just to "mark"
the verification — the simplified format deliberately omits GedcomX
conclusion metadata (proof tiers live in `research.json`, not on the
tree). The audit trail of the verification belongs in your text reply
to the user, not in tree fields.

## Re-invocation behavior

**Writes:** persons, relationships, names, and facts in
`tree.gedcomx.json` (the concluded-tree file) via `tree_edit` and the
merge tools.

**Do not duplicate:** never add a second person record for the same
individual. If the user is editing a person already in
`tree.gedcomx.json` (by `I…` id or by name match), use an `update_*`
operation against that person's id rather than `add_person`. Same for
relationships and facts — when something with the requested id already
exists, update it in place; do not create a duplicate.
