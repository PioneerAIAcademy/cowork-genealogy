# Mary E McAndrew — additional son John (b. 1873, Detroit)

**Source PID:** `G13G-P68`
**Mary E McAndrew is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
12 July 1848, New Brunswick, Canada; died 31 March 1925, Detroit,
Wayne, Michigan.

## Research question

> Did Mary E. McAndrew (G13G-P68) and her husband John Mogan of
> Detroit have any children besides the five already in the tree?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-10, PID `G13G-P68` with relatives). It already
contains five children of Mary and John Mogan — Thomas Frank (b. 1876),
John Vincent (b. 1879), Anna Irene (b. 1884), Edward Lawrence (b. 1885),
and Mary L. (b. 1888) — and the hinted sixth child does not appear.
Nothing was stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — "Mary Morgan" and "John Morgan" are extremely common names in
1870s Detroit, the tree family is recorded under the variant **Mogan**
(records for this family use Morgan and Mogan interchangeably — see the
attached-sources list on the subject), and the agent must distinguish a
genuine additional son from a false hint while the couple's known
children begin only in 1876.

## Notes for reviewers

**Resolved: FALSE MATCH (outcome c).** The hinted record — Michigan,
Births and Christenings, 1775-1995: John A Morgan, born 6 March 1873,
Detroit, parents John Morgan and Mary Morgan
([ark:/61903/1:1:F4RF-FV9](https://www.familysearch.org/ark:/61903/1:1:F4RF-FV9)) —
is **not** a child of Mary E. McAndrew (G13G-P68) and John Mogan. The
research found positive contradicting evidence, not merely an empty
search:

- **The 1873 birth already belongs to a different family.** John A
  Morgan (PID `9NJ7-Z6L`) is attributed in the FamilySearch tree to a
  separate couple — John Morgan (`9NJ7-Z6R`, born Ireland) and Mary
  Morgan (`9NJ7-Z61`). That couple's *only* source is the birth record
  itself, the signature of an auto-generated parent stub created when
  the record was first attached.
- **The record is too sparse to override the established family.** It
  names the parents only as "John Morgan" and "Mary Morgan" — no maiden
  name, age, birthplace, or address. John/Mary Morgan were extremely
  common names in 1870s Detroit, and nothing on the record ties it to
  the Mogan/McAndrew household.
- **The child is absent from Mary's documented family.** Mary's 24
  attached sources consistently name her husband as John Mogan and
  document the five known children (Thomas Frank 1876, John Vincent
  1879, Anna Irene 1884, Edward Lawrence 1885, Mary L. 1888). John A
  Morgan (b. 1873) appears in none of them, including the family's 1880
  and 1900 census households.

Because the false match is grounded in another couple's record rather
than a same-named coincidence, the earlier ambiguity — two sons named
John, or an early/conflicting record for John Vincent (b. 1879) — does
not arise: the 1873 birth is simply a different family's son.
`expected-findings.json` accordingly carries a `"polarity": "avoid"`
guard naming the 1873 John A Morgan birth (spec §3.4.1 — the harness
mechanically fails a run whose final tree contains the avoided claim)
paired with a `required` negative-conclusion finding: no sixth child of
Mary and John Mogan can be established, and the hint record was rejected.
