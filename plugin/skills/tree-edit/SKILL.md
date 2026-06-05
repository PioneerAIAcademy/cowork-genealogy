---
name: tree-edit
model: claude-sonnet-4-6
description: Handles direct edits to tree.gedcomx.json — adding facts,
  correcting values, creating persons, adding relationships, merging
  two persons confirmed to be the same individual, verifying that the
  tree already reflects a known fact (no-op confirmation), checking
  what records FamilySearch has matched or attached to a tree person,
  and checking whether a tree person has possible duplicates that may
  need merging.
  Use when the user says "correct this name", "change birth year", "add
  occupation", "merge these two persons", "fix this fact", "add a
  relationship", "this person's name is wrong", "verify the tree
  reflects this", "check the tree", "make sure the tree shows", "confirm
  this fact is in the tree", "what records are attached to this person",
  "what hints does FamilySearch have for this person", "check record
  matches for", "find possible duplicates for", "are there duplicate
  persons for", "check for merge candidates", when proof-conclusion
  requests a person merge after confirming identity, or when the user
  needs to make a direct correction or verification against the tree
  file. Do NOT use when the user wants to search records (use
  search-records), wants to write a conclusion (use proof-conclusion),
  or wants to link assertions to persons (use person-evidence).
allowed-tools:
  - place_search
  - validate_research_schema
  - person_record_matches
  - person_person_matches
---

# Tree Edit

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

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

### Adding a fact to a person

```json
{
  "id": "F8",
  "type": "Occupation",
  "date": "1870",
  "place": "Schuylkill County, Pennsylvania",
  "standard_place": "Schuylkill, Pennsylvania, United States",
  "sources": [{ "ref": "S2", "page": "1870 Census, dwelling 201" }]
}
```

Add to the person's `facts` array. Generate the next available `F`
prefix ID. Whenever you set a fact's `place`, also set `standard_place`:
call `place_search({ placeName: "<place>" })` and use the first result's
`standardPlace` field (leave it null if nothing resolves). If the fact should be the primary of its type, add
`"primary": true` (and remove `primary` from any existing fact of
the same type on this person).

### Correcting a value

Find the field to correct and update it. Examples:
- Change given name: update `names[].given`
- Fix birth year: update `facts[].date` where `type: "Birth"`
- Correct a place: update `facts[].place` **and** re-resolve
  `facts[].standard_place` via `place_search` (or set it null if the new
  place doesn't resolve)

### Adding a person

Create a new person entry. Use synthetic IDs (`I` prefix + next
number) for locally created persons:

```json
{
  "id": "I8",
  "gender": "Female",
  "names": [
    {
      "id": "N8",
      "preferred": true,
      "given": "Margaret",
      "surname": "Flynn",
      "type": "BirthName"
    }
  ]
}
```

### Adding a relationship

```json
{
  "id": "R5",
  "type": "ParentChild",
  "parent": "KWCJ-RN4",
  "child": "I8",
  "sources": [{ "ref": "S4", "page": "Will Book 12, p. 247" }]
}
```

Use `parent`/`child` for ParentChild, `person1`/`person2` for Couple.

### Removing concluded data (tier downgrade)

When proof-conclusion revises a tier downward to `not_proved` or
`disproved`, remove the previously concluded facts/relationships:
- Delete the fact or relationship entry from the array
- This is the ONE case where deletion from tree.gedcomx.json is
  permitted (the conclusion was withdrawn)

## Person merging

When proof-conclusion confirms two GedcomX persons are the same
individual, this skill executes the merge. This is a mechanical
data operation — proof-conclusion made the analytical decision.

### Merge protocol

**Input:** Two person IDs — the "keep" person (the one that survives)
and the "deprecated" person (the one being merged away).

Convention: Keep the person with:
- The FamilySearch ID (if one has it and the other is a synthetic
  stub), or
- The most complete data, or
- The ID referenced by `project.subject_person_ids`

**Step 1: Merge person data**

Combine into the "keep" person:
- **Names:** Add any names from the deprecated person that don't
  already exist on the keep person. Preserve `preferred` on the
  keep person's primary name.
- **Facts:** Add any facts from the deprecated person that aren't
  duplicates. If both have a Birth fact with different values, keep
  the one from the proof conclusion (the concluded value). Generate
  new `F` IDs for merged facts if there would be collisions.
- **Source references:** Merge source ref arrays on shared facts.
  Don't duplicate identical source references.

**Step 2: Update relationships**

For every relationship in `tree.gedcomx.json` that references the
deprecated person ID:
- Replace `parent`, `child`, `person1`, or `person2` with the keep
  person ID
- Remove duplicate relationships (if the same parent-child pair now
  exists twice)

**Step 3: Update research.json references**

Scan research.json and update every reference to the deprecated
person ID:

| Section | Field to update |
|---------|----------------|
| `project` | `subject_person_ids` — replace deprecated ID with keep ID |
| `person_evidence` | `person_id` — replace deprecated ID with keep ID |
| `timelines` | `person_ids` — replace deprecated ID with keep ID |

**Step 4: Remove the deprecated person**

Delete the deprecated person from `tree.gedcomx.json` `persons[]`.

**Step 5: Log the merge**

The merge itself is tracked by the proof_summary that triggered it.
No separate log entry is needed — the proof conclusion's narrative
documents why the merge happened.

### Merge example

**Merge I5 (stub: "James Flynn") into KWCJ-RN7 (FamilySearch:
"James Patrick Flynn"):**

1. I5 has: name "James Flynn", no facts
2. KWCJ-RN7 has: name "James Patrick Flynn", Birth 1848 Ireland
3. Keep KWCJ-RN7 (has FamilySearch ID and more data)
4. I5's name "James Flynn" is a subset of KWCJ-RN7's name — don't
   add a duplicate
5. Update any relationships referencing I5 → KWCJ-RN7
6. Update person_evidence entries: pe_009 (person_id: "I5") →
   pe_009 (person_id: "KWCJ-RN7")
7. Update timelines: t_002 (person_ids: ["I5"]) →
   t_002 (person_ids: ["KWCJ-RN7"])
8. Delete I5 from persons[]

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

After ANY edit (ad-hoc or merge), call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting. Merges are complex enough that validation errors are
possible — check carefully.

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
- **Update ALL references.** Missing a reference creates a broken
  foreign key. After merging, run validate-schema — it will catch
  any references to the deleted person.
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

**Writes:** persons, relationships, names, and facts directly in
`tree.gedcomx.json` (the concluded-tree file). Operates by GedcomX
id — `I1`, `R1`, `F1`, etc.

**On repeat invocation:** edits in place by id. If a person, relationship,
or fact with the requested id already exists, updates its fields
rather than creating a duplicate.

**Do not duplicate:** never add a second person record for the same
individual. If the user is editing a person already in
`tree.gedcomx.json` (by `I…` id or by name match), update that
person in place. Same for relationships and facts.
