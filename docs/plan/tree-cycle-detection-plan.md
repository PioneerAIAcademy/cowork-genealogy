# Tree cycle detection in the validator — plan

> **Status:** Proposed — not started. Authored 2026-07-24 from a review of
> `DigitalArchivst/Open-Genealogy` (external repo, cloned and read directly).
> No implementation branch yet.
> **Goal:** catch a person recorded as their own ancestor — a real,
> source-agnostic tree-integrity invariant nothing in this codebase checks
> today.

## 1. Why (verified, not assumed)

`validateGedcomx` (`packages/engine/mcp-server/src/validation/validator.ts:1191-1328`)
checks that every `ParentChild.parent`/`.child` and `Couple.person1`/`.person2`
reference an existing person id (the `addError(..., "not found in persons")`
calls at lines 1287-1310), but it builds no ancestor/descendant adjacency
and runs no traversal. Nothing — not this validator, not the legacy healer
in `tree-sanitize.ts` — checks whether a person appears in their own
ancestor chain.

Open-Genealogy's GEDCOM builder (`gedcom_builder.py`) runs exactly this
check before ever writing a file: a DFS over parent chains flags
`CYCLE_DETECTED` (verified by reading the function body, ~lines 864-907),
and a separate pass (`auto_repair_pointers()`, ~lines 939-987) reconciles
bidirectional pointer mismatches (a child's family pointer naming a family
that doesn't list them back).

This is a source-agnostic data-integrity invariant, not something specific
to GEDCOM export: a bad `merge_tree_persons` call, a manual `tree_edit`
mistake, or a subtle record-extraction/person-evidence linking error could
in principle produce a cycle in our own tree, and nothing today would catch
it.

## 2. Design

- Add a cycle-detection pass in (or called from) `validateGedcomx`: build a
  `parent → [children]` (or `child → [parents]`) adjacency map from
  `relationships[]` entries where `type === "ParentChild"`, then run a
  DFS/iterative-deepening check from each person for whether they appear in
  their own ancestor chain. Report via the existing `addError(report, path,
  ...)` mechanism already used for the dangling-reference checks in the
  same function — same reporting path, no new plumbing.
- This is a **reject**, not a **heal**: a cycle is a data-integrity bug, not
  a legacy shape to migrate, so it belongs in `validator.ts` (which rejects
  at the tool boundary) rather than `tree-sanitize.ts` (which heals
  pre-existing documents written before a shape was closed).
- Cost: a DFS from every node is `O(n·d)` for `n` persons of ancestor-depth
  `d` — trivial at genealogy-project scale (hundreds to low thousands of
  persons). No need for a cleverer algorithm.

**Out of scope for v1 (verify before building, don't assume away):**
Open-Genealogy's bidirectional-pointer auto-repair fixes a class of bug that
exists because GEDCOM's `FAMC`/`FAMS` are two separate pointers that can go
out of sync. Our simplified-GedcomX has no equivalent separate pointer
pair — `ParentChild`/`Couple` relationship entries are the single source of
truth for both directions, so this bug class may simply not exist in our
shape. Confirm this at implementation time (§4.1) rather than assuming it;
if it turns out our shape *can* go inconsistent some other way, that's a
second, separate change — don't bundle an unverified assumption into this
plan's scope.

## 3. Changes by area

- `packages/engine/mcp-server/src/validation/validator.ts` — new
  cycle-detection pass in/near `validateGedcomx`.
- Check whether tree-shape/validator invariants are documented in an
  existing spec (e.g. `docs/specs/simplified-gedcomx-spec.md` or
  `docs/specs/merge-gedcomx-spec.md`) that should gain a line about this
  invariant — confirm the right doc at implementation time rather than
  guessing here.
- Tests: a fixture `tree.gedcomx.json` with an induced 2- and 3-generation
  cycle, alongside validator.ts's existing test suite (locate it at
  implementation time rather than assuming a path).

## 4. Decisions

1. **Can our `ParentChild`/`Couple` shape go bidirectionally inconsistent
   the way GEDCOM's `FAMC`/`FAMS` can?** *(proposed: no — single-source-of-
   truth relationships avoid the whole bug class. Confirm during
   implementation; if wrong, scope a follow-up rather than assume it away.)*
2. **Where the DFS lives** — inside `validateGedcomx` directly vs. a
   separate exported helper it calls. Implementer's call; no reason to
   decide now.

## 5. Sequencing

1. Cycle-detection pass + test fixtures.
2. Confirm or rule out the bidirectional-consistency question (decision 1);
   scope a follow-up plan only if it turns out to be real.
