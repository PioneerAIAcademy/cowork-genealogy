# Elizabeth Geach — siblings (1820s-1830s Licking County, Ohio)

**Source PID:** `273D-F9Z`
**Elizabeth Geach is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
17 August 1822, Washington, Ohio; died 6 September 1895, Union
Township, Licking County, Ohio.

## Research question

> Who were the siblings of Elizabeth Geach, daughter of Peter Geach and
> Rebecca (Benjamin) Geach of Licking County, Ohio?

## What was removed from the starting tree

- Removed person 96JS-JVT: Thomas Geach
- Removed person GC63-1RG: Nancy Geach
- Removed person L18N-3DX: Jacob D Geach
- Removed person LHX5-NVH: Mary Geach
- Removed person LJGK-63S: William W Geach
- Removed relationship R19 (ParentChild KGYQ-8BZ/96JS-JVT): cascaded from a removed person
- Removed relationship R20 (ParentChild KGYQ-D3V/96JS-JVT): cascaded from a removed person
- Removed relationship R21 (ParentChild KGYQ-8BZ/LHX5-NVH): cascaded from a removed person
- Removed relationship R22 (ParentChild KGYQ-D3V/LHX5-NVH): cascaded from a removed person
- Removed relationship R23 (ParentChild KGYQ-8BZ/GC63-1RG): cascaded from a removed person
- Removed relationship R24 (ParentChild KGYQ-D3V/GC63-1RG): cascaded from a removed person
- Removed relationship R25 (ParentChild KGYQ-8BZ/L18N-3DX): cascaded from a removed person
- Removed relationship R26 (ParentChild KGYQ-D3V/L18N-3DX): cascaded from a removed person
- Removed relationship R27 (ParentChild KGYQ-8BZ/LJGK-63S): cascaded from a removed person
- Removed relationship R28 (ParentChild KGYQ-D3V/LJGK-63S): cascaded from a removed person

Elizabeth's parents, Peter Geach (`KGYQ-8BZ`) and Rebecca Geach
(`KGYQ-D3V`), are **retained** in the starting tree (already an
established finding from the sibling `elizabeth-geach-parents` fixture,
merged to `main` in PR #617) — this fixture isolates the *siblings*
question rather than re-testing parentage.

## Expected difficulty

medium — All five siblings are named in a single already-located
document: the same 1836 Licking County Court of Common Pleas probate
petition for the estate of the intestate Peter Geach that the
`elizabeth-geach-parents` fixture's proof rests on. The agent does not
need to rediscover the document from scratch context (Peter and Rebecca
are already the tree's established parents, a strong search anchor), but
must extract **five** new persons and their relationships from one
source rather than confirm two already-anchored identities — a
different, and more tree-editing-heavy, skill path than the parents
fixture.

## Notes for reviewers

- **Required findings** are all five sibling identities: Jacob (f1),
  Mary (f2), Thomas (f3), William (f4), and Nancy (f5) Geach. All five
  are named together in the same probate petition, so the primary risk
  is the agent recovering some but not all — e.g. stopping after two or
  three names, or mis-splitting OCR variants in the transcript ("Thomas
  Jack"/"Thomas Goach" for Thomas Geach, "Nancy Beach" for Nancy Geach).
- **Verified recoverable 2026-07-10** via live `record_search` /
  `fulltext_search`: an indexed marriage-record search for the *parents'*
  couple found nothing usable, but a full-text search for
  `+Geach +Elizabeth +Rebecca` (no place/date filters) surfaces the
  probate petition as the first result. Filtering by `recordPlace1`/
  `recordPlace2` (Ohio/Licking) or a year range on this query produced
  **false nils** — the same false-nil pattern already documented in
  `elizabeth-geach-parents`' notes for this collection.
- Precise birth years for the siblings (Jacob ~1818, Mary ~1824,
  Thomas ~1827, William ~1830, Nancy ~1833) come from the FamilySearch
  tree, not the probate itself (which only says all six are "minors" in
  1836); they are given as approximate context in
  `expected-findings.json`, not as a required finding — credit the
  sibling *identity/relationship*, not an exact birth year match.
- Peter and Rebecca's own tree facts (tax records, marriage, deaths) are
  unchanged from `elizabeth-geach-parents` and remain in the starting
  tree as search anchors.
