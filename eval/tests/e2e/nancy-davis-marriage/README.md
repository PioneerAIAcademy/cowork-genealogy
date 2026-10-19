# Nancy Davis — marriage in May 1868, Newton County, Missouri

**Source PID:** `LJK2-JBH`
**Nancy Davis is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1837 in Bradley County, Tennessee; the tree carries an undated Death fact. Living in Neosho, Newton County, Missouri in 1850. The tree gives her a husband, William James Brewer (born 1 January 1844, Waynesboro, Tennessee; died 3 March 1925, Dallas, Texas), with no marriage fact, and two daughters, Mary (1858) and Sarah (1860) Moreland, both born in Tennessee.

## Research question

> When and where did Nancy Davis, born about 1837 in Bradley County, Tennessee, and living in Neosho, Newton County, Missouri in 1850, marry William James Brewer?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `LJK2-JBH` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: OUTCOME 2 (the answer is something else — the tree links the wrong
woman to Brewer).** The hint is a real 1868 marriage, but it does not belong to
the tree person `LJK2-JBH`. **`LJK2-JBH` and Brewer's actual wife are two
distinct people**; the hint is a **false match** for `LJK2-JBH`, and the correct
person is identifiable. The findings reward recovering that distinction,
following the `adelaida-martinez-mother` precedent (two `required` findings).

**The two people:**

- **`LJK2-JBH` — Nancy Davis, born about 1837 in Tennessee.** Her only own
  source is the 1850 census (`ark:/61903/1:1:MDZF-Q7C`, household of Thomas J.
  Davis at Neosho, Newton County) — the origin of the tree's 1837 Bradley
  County birth. The Moreland daughters on her (Mary 1858, Sarah 1860, both born
  Tennessee) fit this 1837-Tennessee woman and a non-Brewer (Moreland) husband.
  She is **wrongly coupled to William James Brewer** in the tree and carries no
  1853-Missouri evidence of her own.
- **Brewer's actual wife — Nancy Angelina Davis (`L8YY-CBX`), born 4 May 1853
  in Missouri.** A distinct, well-sourced tree person who **already holds** the
  12 May 1868 Newton County marriage (bride personas `ark:/61903/1:1:V28T-J7T`,
  `ark:/61903/1:1:6XNV-J1ZQ`), the Brewer children, and her own census personas
  — the 1860 census (`ark:/61903/1:1:MHZ1-XC1`, indexed "Angeline Davis"), the
  1870 census (`ark:/61903/1:1:MXLB-P9R`; Nancy A. b. 1853 Missouri), the 1880
  census (`ark:/61903/1:1:M66Z-BVH`, indexed "Lina Brewer"), and the 1900 census
  (`ark:/61903/1:1:M3L5-BTK`; Nancy A. b. May 1853 Missouri, marriage 1868) —
  plus her 1904 death records (e.g. `ark:/61903/1:1:K3SF-DKR`; she died
  9 January 1904 in Eastland, Texas). Her parents are Phillip Rayburn Davis and
  Mary Ann Ingram, not Thomas J. Davis. (The household/head personas of those
  censuses — e.g. `MXLB-P95` in 1870, `M3L5-BTV` in 1900 — belong to William
  James Brewer, not to Nancy.)

**What decided it (index + census, not the register).** Neither marriage index
(`ark:/61903/1:1:V28T-J7T` / `ark:/61903/1:1:V28T-J7R`,
`ark:/61903/1:1:6XNV-J1Z3`) carries the bride's age or parents. Brewer's
censuses give his wife as born about 1853 in Missouri, and a woman born about
1853 cannot be the Nancy born about 1837 in Tennessee enumerated in the 1850
census — so these are two people. The 1868 marriage and the whole Brewer
household are already attached to `L8YY-CBX`, confirming she — not `LJK2-JBH` —
is Brewer's 1868 bride. This is **not** outcome 1 (the hint is not
`LJK2-JBH`'s) and **not** outcome 3 (the marriage is real and its true owner,
`L8YY-CBX`, is findable).

**The original register entry could not be examined (`image_basis: false`).**
The original 1868 Newton County marriage-register entry — reportedly in
volume 2-A — is unavailable for examination: its FamilySearch page image
(`ark:/61903/3:1:3QS7-998M-Y8G2`, Newton County 1867–1872) returned **HTTP
403** on every authorized fetch (`image_transcribe` with the FamilySearch
token), and that access problem is **not resolved**. No archive or county
office was contacted, so this records only that the image route was
inaccessible — not that the original is lost. **No original-register field was
inspected**, and nothing here claims the register records the bride's age,
parental consent, or any other decisive detail. The identification instead
rests on the marriage **index** (Nancy Angeline Davis and William James
Brewer — also recorded as William Bremer — married 12 May 1868, Newton
County) together with the corroborating **1860, 1870, 1880, and 1900 censuses
and Nancy Angelina Davis's 1904 death records** attached to `L8YY-CBX`, which
identify `L8YY-CBX` (b. ~1853 Missouri) as Brewer's wife rather than
`LJK2-JBH` (b. ~1837 Tennessee). `image_basis` stays **false**, and no Step 1a
image calibration was performed or is relied upon.

**Retrieval** was read-only via the MCP `record_read` and `person_read` tools
(and an `image_transcribe` attempt on the register image, which returned 403)
against live FamilySearch; the identity judgement is the genealogist's.
