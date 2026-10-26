# Lucia Skora — parents named on an 1807 Przecław baptism

**Source PID:** `LHBJ-WSN`
**Lucia Skora is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries an undated Death fact and no birth or baptism. She married Laurentius Skrzypek on 12 November 1832; six children of the couple were baptised at Przecław (then Galicia, now Podkarpackie, Poland) between 1833 and 1846, and she appears as their mother, indexed as Skora, Skura, Skara and Skóra, and again as godmother in 1851 and 1856. The tree names no parents for her.

## Research question

> Who were the parents of Lucia Skora, who married Laurentius Skrzypek on 12 November 1832 and bore him six children baptised at Przecław, Poland, between 1833 and 1846?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `LHBJ-WSN` with relatives). Nothing was
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

**Resolved: TRUE MATCH** (adjudicated 2026-10-26; index-based, `image_basis: false`).
Retrieval was tool-assisted (MCP `record_read` / `record_search` / `catalog_search` /
`image_search` against live FamilySearch, plus web lookups); the identity
judgement is the genealogists'.

**What the FamilySearch index establishes (facts).** The hinted baptism
(`ark:/61903/1:1:X54T-461`) records **Lucia Skora, baptised 13 November 1807 at
Przecław**, daughter of **Antonius Skora and Elisabeth Skrownionka** (the hinted
index's spelling; two further indexes of the *same* event, `6VQK-F3N3` and
`6V3J-2YZ3`, spell the mother **Skowronionka** and add residence "house 18" — a
spelling variant of one woman, not a second identity).
Independent records establish the subject's life events: her daughter **Hedvigis
Maron** was baptised 11 Oct 1829 naming the mother Lucia Skora (`X57Q-7X5`); her
first husband **Mathias (Maciej) Maron died 5 March 1832**, buried Przecław
(`6V3H-ZYBY`); she is named as mother of the **Skrzypek children 1833–1846**; and a
daughter's **1856 marriage** names the couple Laurentii Skrzypek + Luciae Skora
(`6V3Z-T2P1`, an attached tree source).

**What is inference (not stated in any single record).** No record directly ties
the Skrzypek-children's mother, or the 1832 Skrzypek bride, to the 1807 baptism —
none states her parents, birth date, or age. The identification rests on three
inferences: (a) the Maron-wife Lucia Skora is the Skrzypek-mother Lucia Skora — from
the shared name, the single parish, and the widow-remarriage timing (husband dies
March 1832, remarriage November 1832); (b) she was **born ~1807** — from her
childbearing span (a daughter in 1829, children to 1846); and (c) she is specifically
the 1807-baptised Lucia — because that is the only Lucia Skora baptism found in the
index for the window, whose parents are then taken as hers.

**Search scope.** The "only one baptism" point is **index-bounded, not exhaustive**:
a single FamilySearch index search (given name Lucia; surname Skora/Skóra; Przecław,
Mielec, Podkarpackie; baptism 1803–1813) returned **no competing Lucia Skora
baptism**. But it searches only FamilySearch-indexed records; an unindexed baptism,
one indexed under a markedly different name/place spelling (she is recorded variably
as Skura/Skara/Skóra, and the place is standardised two ways, Przecław-Rzeszów vs
Przecław-Mielec), or one outside the window would not appear — and these registers
are only partially indexed (the marriage index omits the 1832 Skrzypek entry).

**Distinguished from the older Lucia Skóra.** A published transcription records a
**1792** Przecław marriage of Maciej Maroń × Lucja Skóra (bride b. ~1771, also a
daughter of an Antoni Skóra + Elżbieta Skowron). She is **excluded as the subject**
by childbearing age (she would be ~62–75 during the subject's 1833–1846 births), and
the subject's first husband Mathias Maron (b. ~1805) is a different, younger man than
the 1792 groom. That 1792 record is **not** used as evidence for the subject's
parents.

**Limitations.** This is an index-based identification partly by elimination;
`image_basis` is false. The **12 November 1832 Skrzypek–Skóra marriage entry** — the
record that would state the bride's age, parents, and widow status directly —
**could not be read**: its register images in **both** filmed copies (image groups
`7997601` and `4645864`) returned **HTTP 403** (access restricted to a FamilySearch
Center / Affiliate Library), so **Step 1a calibration was not performed and the entry
was not examined**. A reported **Geneteka** index of an 1829 Maroń–Skóra marriage
naming the parents **could not be verified** (its results are JavaScript-loaded and
were not retrievable; its Przecław marriage coverage appears to begin ~1843). A
**second genealogist concurred** that the FamilySearch records support the
identification; that opinion is **corroboration** and did not involve examining the
inaccessible marriage images.

**Net.** On the FamilySearch index — a single matching 1807 baptism, the Maron
first-marriage chain anchored by the 5 March 1832 death, the Skrzypek remarriage
timing, and the childbearing-age exclusion of the older Lucia — the hint is accepted
as a **true match**: Lucia Skora's parents were Antonius Skora and Elisabeth
Skrownionka (the hinted record's spelling; the duplicate indexes spell the mother
Skowronionka). The direct 1832-marriage confirmation remains unread (access-restricted).
**This conclusion must be revisited if the original 1832 marriage record becomes
available and contradicts the identification.**
