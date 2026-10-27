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

**Resolved: FALSE MATCH** (adjudicated 2026-10-27; index/tree-based. `image_basis` left unset — no register page image was read or calibrated in this resolution.)

**Verdict.** FamilySearch's hint attached the mother persona on a 1900 Bojnice baptism to the subject (`LJTH-GRX`), but that "Maria Vázsan" is a different, younger woman. The hint is a false match.

**What the index and tree establish (tool-assisted retrieval: `record_read`, `person_read`, `record_search`, `source_attachments`).**
- The hint record — the 9 Jun 1900 Bojnice baptism of Maria Czibula (`ark:/61903/1:1:QVNW-6T7D`; mother persona `ark:/61903/1:1:QVNW-6T7X`) — indexes the mother only as "Maria Vázsan", with **no age and no parents**.
- That mother persona is already attached on FamilySearch to tree person **`LJT8-8L5`**, not to the subject.
- `LJT8-8L5` is **Maria Vázsan, born 20 Oct 1869 at Bojnice** (`ark:/61903/1:1:QVNW-69C8`), **daughter of Ferencz (Franciscus) Vázsan and Julianna Hoffmann** — a different parentage and generation from the subject. She married **Joannes (János) Czibula** (`LJT8-8LP`) on **21 November 1893**, and the couple's children — János (1894), Josephus (1895), Stephanus (1897) and **Maria (9 Jun 1900, the hint child)** — form a coherent run at one household.
- The subject (`LJTH-GRX`) is **Maria Vázsan, baptised 10 Jan 1853 at Bojnice, daughter of Ignatius Vázsan and Anna Prividzer**; her only attached source is her own baptism, and she carries no spouse or children in the tree.

**Independent genealogist research (not from the tools above).** The researcher found that the **1893 marriage record** names the bride as **20 years old and the daughter of Ferencz Vázsan** — confirming she is the younger Maria, not the 1853 subject — and connected the younger Mária and János to the four children baptised 1894–1900. (The marriage's stated age ~20 implies a birth about 1873; the baptismal index gives 1869. The two differ by a few years but both place her a generation after the subject and name Ferencz, not Ignatius, as her father.)

**No image basis.** This resolution does **not** rest on reading the original register page images, and **no same-page calibration was performed**; the false match is settled by the index and tree records above. `image_basis` is left unset (indexes alone settled it), and the disproving ARKs in `expected-findings.json` are index (`1:1:`) records.

**Why no substitute answer.** A bounded index search for the subject's own marriage (Maria Vázsan, Bojnice, 1869–1895) and children (mother Maria Vázsan, Bojnice, 1872–1894) returned many results — "Maria Vázsan" is a common name in this parish (32 marriage and 462 mother-name hits) — but **none is identifiable as the 1853 subject**: the dated bride candidates have different parents (e.g. daughters of Caspari or Josephi Vázsan), and child baptisms do not index the mother's parents. The search is index-bounded and the name is common, so this is "no record found identifiable as hers," not proof that none exists. Outcome: false match, no findable substitute.

**Revisit** if the subject's own marriage, or a child's baptism naming her parents (Ignatius Vázsan / Anna Prividzer), is later found — which would convert this to a different-answer outcome.
