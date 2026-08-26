# `tree_diff` tool spec

## Purpose

Given two simplified-GedcomX trees, report what the second added, removed, and
changed relative to the first — persons, per-person facts, and relationships.

Two callers need this and neither can get it from the data alone:

- **The tree-encoding completion gate** (issue #1490) diffs the final
  `tree.gedcomx.json` against the write-once `starting-tree.gedcomx.json` baseline
  to tell a conclusion this session encoded from a fact that was already seeded.
  `research_append` loads only the *current* tree, so without the baseline it has
  no way to make that distinction.
- **The viewer and `project_status`** want the same "what did this session change"
  delta for display.

The tool is the shared, tested implementation both use, so neither re-derives a
diff and gets the relationship landmines wrong.

## Inputs

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `before` | simplified-GedcomX object (`{persons?, relationships?, sources?}`) | yes | The earlier tree, e.g. the baseline. |
| `after` | simplified-GedcomX object | yes | The later tree, e.g. the current tree. |

Both are the snake_case simplified shape. The tool reads `persons[]` and
`relationships[]`; `sources[]` are accepted and ignored (a source-list diff is
not what any caller asks for).

## Output

```
{
  personsAdded:            string[]          // ids present only in `after`
  personsRemoved:          string[]          // ids present only in `before`
  personsChanged:          PersonDelta[]     // same id, facts gained or lost
  relationshipsAdded:      RelationshipDelta[]
  relationshipsRemoved:    RelationshipDelta[]
  personsWithNewStructure: string[]          // union: added persons + persons who
                                             //   gained a fact or a relationship endpoint
}
```

- `PersonDelta = { id, addedFacts, removedFacts }` — facts in one tree not matched
  by content in the other.
- `RelationshipDelta = { key, type, relationship }` — `key` is the endpoint
  identity, `relationship` the full object from the tree it is unique to.

`personsWithNewStructure` is the set a tree-encoding gate asks about: "did this
conclusion's person gain any tree structure this session?"

## Identity rules — the landmines

1. **Persons key on `id`.**
2. **Relationships key on their ENDPOINTS, never on `id`.** A `ParentChild`
   carries `parent`/`child` (directional); a `Couple` carries `person1`/`person2`
   (unordered — sorted before keying). Some seeded trees point a relationship at a
   `PID-TODO` placeholder the agent re-points during the run while keeping the same
   `id`; an id key would read that genuinely re-pointed relationship as unchanged.
   Shared with the merge tool via `relationshipKey`.
3. **A `Marriage`/`Divorce` fact lives on the Couple relationship's `facts[]`,**
   not on a person. An added Couple carrying a Marriage fact is one added
   relationship, not a person-fact change.
4. **Facts key on a content signature** (type + date + place + value); a missing
   field is treated as absent, since `primary`/`preferred` are omit-when-false.

## What it deliberately does not do

- It does not diff relationship *facts* beyond the relationship's add/remove — a
  Marriage date corrected on an already-present Couple is not reported as a change.
  No caller needs that today; add it when one does.
- It does not diff `sources[]`, names, gender, or `ark`.
- It is a **shape** diff, not a semantic one: it reports that a person gained a
  Birth fact, not whether that Birth fact is the one a given conclusion asserts.
  That ambiguity is inherent — a proof summary carries no machine-readable tree
  reference — and is why the tree-encoding gate built on this is a shape match, not
  a foreign key (see the gate's row in `research-append-tool-spec.md`).

## Behaviour

Pure and read-only: it takes both trees as input and touches no file and no
network, so the gate can call it mid-write. It never throws on a malformed tree —
a person with no `id`, or a `null` `relationships`, is skipped, not an error.
