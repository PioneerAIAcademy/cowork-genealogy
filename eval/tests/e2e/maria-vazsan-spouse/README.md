# Maria Vázsan — husband and daughter named on a 1900 Bojnice baptism

**Source PID:** `LJTH-GRX`
**Maria Vázsan is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Baptised 10 January 1853 at Bojnice (Hungarian Bajmóc), Prievidza district, Slovakia; the tree carries an undated Death fact. Daughter of Ignatius Vázsan (about 1805–1881) and Anna Prividzer (about 1825–1875). Anna appears twice in the tree, as `LJTH-GRN` and `LJTW-6YB`. The tree also has a half-sister, another Maria Vazsan, baptised in 1832, and seven other siblings and half-siblings baptised at Bojnice from 1835 to 1851. The tree gives her no spouse or children, and her only source is her own baptism.

## Research question

> Whom did Maria Vázsan, baptised 10 January 1853 at Bojnice (Bajmóc), Slovakia, daughter of Ignatius Vázsan and Anna Prividzer, marry, and what children did the marriage produce?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `LJTH-GRX` with relatives). Nothing was
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

**Resolved: FALSE MATCH** (adjudicated 2026-10-27; reassessed 2026-10-28 after review. Index/tree-based; `image_basis` left unset — no register page image was read or calibrated in this resolution.)

**Verdict.** FamilySearch's hint attached the mother persona on a 1900 Bojnice baptism to the subject (`LJTH-GRX`), but that persona belongs to a different, younger woman. The hint is a false match.

### What the index and tree establish (tool-assisted retrieval: `record_read`, `person_read`, `record_search`, `source_attachments`)

- The hint record — the 9 Jun 1900 Bojnice baptism of Maria Czibula (`ark:/61903/1:1:QVNW-6T7D`; mother persona `ark:/61903/1:1:QVNW-6T7X`) — indexes the mother only as "Maria Vázsan", with **no age and no parents**.
- That mother persona is attached on FamilySearch to tree person **`LJT8-8L5`**, not to the subject (verified via `source_attachments`).
- `LJT8-8L5` is a different, younger woman: her attached 1869 baptism (`ark:/61903/1:1:QVNW-69C8`, indexed under the surname **"Vázan"**) names her as Maria Vázan, **daughter of Franciscus (Ferencz) Vázan and Julianna Hoffmann** — a different parentage and generation from the subject.
- The subject (`LJTH-GRX`) is **Maria Vázsan, baptised 10 Jan 1853 at Bojnice, daughter of Ignatius Vázsan and Anna Prividzer**; her only attached source is her own baptism, and she carries no spouse or children in the tree. She would be 47 at the 1900 baptism.
- Four Czibula children's baptisms index a mother "Maria Vázsan" at one Bojnice household between 1894 and 1900 (`QVNW-D14B` 1894, `QVNW-6XP5` 1895, `QVNW-6HR9` 1897, `QVNW-6T7X` 1900). None of these indexes the mother's parents.

**This settles the false match.** The hint is a bare-name attachment; FamilySearch's own tree places that persona on a different woman of different parentage; and the subject has no corroborating record of a Czibula marriage or child. The subject is ruled out regardless of who the Czibula wife actually was.

### Image-derived claims — not relied on in this resolution

- The 1893 Czibula–Vázsan marriage carries **no FamilySearch index entry**. In the tree it is attached only as a register-page image (`ark:/61903/3:1:33S7-9BRR-2YR`, Bojnice marriage index 1877–1912). Its content — including the bride's stated age and her father's name — was **not read or calibrated** in this investigation under the testing-guide Step 1a same-page rule.
- A reviewer reported that this marriage page lacks the two other indexed entries Step 1a requires to calibrate a reading. This investigation did **not** independently confirm that, so whether a calibrated reading is possible is left open; it was simply not relied on here.
- **The index does not independently connect the 1869 baptism to the Czibula family.** The 1869 baptism names a Maria Vázan, daughter of Franciscus Vázan; the 1894–1900 Czibula baptisms name a mother "Maria Vázsan" with no parents indexed. The link between them is made by the FamilySearch tree (whose basis is the uncalibrated marriage image), not by the index.
- **Age discrepancy, unresolved.** A bride aged ~20 in November 1893 would have been born about 1873, whereas the 1869 baptism gives 1869. This is consistent with the 1869 baptism belonging to a sister rather than the Czibula bride, so the younger Maria Vázsan's identity is **not fully resolved** and the 1869 baptism is not treated here as proof of the bride's identity. It does not affect the false match: born 1869 or 1873, she is a generation after the 1853 subject with different parents.

### Why no substitute answer

A bounded index search for the subject's own marriage (Maria Vázsan, Bojnice, 1869–1895) and children (mother Maria Vázsan, Bojnice, 1872–1894) returned many results — "Maria Vázsan" is a common name in this parish (32 marriage and 462 mother-name hits) — but **none is identifiable as the 1853 subject**: the dated bride candidates have different parents (e.g. daughters of Caspari or Josephi Vázsan), and child baptisms do not index the mother's parents.

One nearer age-fit exists in the index: a Maria Vázsan married to **Joannes Pracsko**, with children baptised at **Brezany** (Prievidza) — e.g. Helena Pracsko, baptised 9 Aug 1883 (`ark:/61903/1:1:QVN4-PQ37`), and Joannes Pracsko, baptised 1880 (`ark:/61903/1:1:QVN4-P4M4`). The subject would be 25–41 across the Brezany births, a better biological fit than the Czibula run. **But this family cannot be identified as the subject either:** the Brezany baptisms do not index the mother's parents, so nothing ties this Maria Vázsan to Ignatius Vázsan and Anna Prividzer. It is a name-and-age near-miss, not a substitute answer. (These records were retrieved independently from the FamilySearch index; no website-session findings are used here.)

The search is index-bounded and the name is common, so this is "no record found identifiable as hers," not proof that none exists.

**Revisit** if the subject's own marriage, or a child's baptism naming her parents (Ignatius Vázsan / Anna Prividzer), is later found — which would convert this to a different-answer outcome.
