# Georg Gajdosch — wife Catharina and daughter Anna (b. 1718, Lidečko)

**Source PID:** `K69J-F7Y`
**Georg Gajdosch is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1690, Lidečko, Vsetín, Moravia; death not recorded in the tree.

## Research question

> Did Georg Gajdosch of Lidečko, Moravia have a daughter Anna, baptised 22 April 1718 — and was her mother named Catharina rather than the Dorothea the tree records as his wife?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `K69J-F7Y` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: FALSE MATCH** (outcome (c)) — adjudicated 2026-09-16 from issue
#2300. The hint record is a real baptism, correctly indexed; it simply belongs
to a different man. `expected-findings.json` now carries an `avoid` finding
naming the claim the agent must not make, paired with a `required` finding for
the documented negative.

### What decided it

Two baptisms eight days apart, in the same index, with the same father's name
and different mothers:

| Baptism | Child | Father | Mother | Ark |
|---|---|---|---|---|
| 26 Oct 1714 | Joannes | Georg Gajdosch | **Dorothea** | `1:1:FMS8-XF3` |
| 3 Nov 1714 | Martin | Georg Gajdosch | **Catharina** | `1:1:FMS8-6GC` |

No woman bears children eight days apart, so these are two couples, not one —
and for the same reason they cannot be successive wives of one man. Lidečko
held two contemporaneous Georg Gajdosch households, which the original draft
listed as its third reading and which is entirely ordinary for an early-modern
Moravian parish.

Sorting the collection's eight Gajdosch baptisms of 1714-1733 by mother splits
them cleanly, with no overlap and no gap that wants explaining:

- **Georg × Dorothea** — Joannes 1714. That is all.
- **Georg × Catharina** — Martin 1714, **Anna 22 Apr 1718** (the hint),
  Catharina 1722, Joannes 1724, Zuzana 1729, Katerina 1731, Tomas 1733 — an
  unbroken run at normal spacing.

The tree person `K69J-F7Y` hangs on one source only: the 1714 Joannes entry,
the Dorothea one (`sources[0]`, `ark:/61903/1:1:FMS8-XFQ`). So the 1718 Anna
baptism documents the *other* Georg. The tree's Dorothea is not refuted by the
hint, and the agent should not replace her with Catharina.

### What was searched and came up empty

- **A substitute daughter.** Collection 1784129 (Czech Republic, Births and
  Baptisms, 1637-1889), children of Georg Gajdosch and Dorothea, full
  collection range: returns Joannes 1714 and nothing else. There is no other
  Anna to put in the hint's place, which is what makes this outcome (c) rather
  than (b).
- **A marriage record.** No Georg Gajdosch marriage appears in indexed Czech
  Republic collections for 1700-1740, so neither union can be dated or ordered
  from a marriage entry.
- **The parish register images.** Collection 1784129 is index-only ("Index to
  selected Czech baptisms") with no images attached, so the Lidečko register —
  the record that would settle one Georg or two from the original hand — was
  not reachable by this path. **Everything above rests on a single derivative
  index.** A reviewer with film-level access to the Lidečko books could
  strengthen or overturn it, and that is the one open door left.

### Correction to the issue body

Issue #2300 offers as its first cheap check: "open FMS8-XFQ and see whether it
names a mother at all — if the 1714 entry names no mother, Dorothea is
unsourced and there is no conflict, only a name to add." It **does** name her.
Dorothea is sourced by that entry, the conflict is real, and what resolves it
is the eight-day gap rather than a silent index. The same check is quoted on
the other cards in this batch; it is not a safe shortcut.

### Provenance

Record retrieval used `packages/engine/mcp-server/dev/try-*.ts` against live
FamilySearch, per the decision recorded on issue #2300 (option A) and in
`docs/specs/e2e-test-spec.md` §3.6. The identity judgement was a human call,
not a tool output.
