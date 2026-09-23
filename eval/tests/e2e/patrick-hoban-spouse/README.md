# Patrick Hoban — a wife Ellen and a son Thomas Dee (m. 1895, Halifax)

**Source PID:** `KK3W-WLT`
**Patrick Hoban is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1836, Halifax, Nova Scotia, to Richard Hobin and Margaret Kilfoyle of County Kilkenny; resident at Halifax in 1868 and 1881; death not recorded in the tree.

## Research question

> Was the Patrick whose son Thomas Dee married Bessie Butler at Halifax in 1895 the same man as Patrick Hoban (b. 1836), and was his wife an Ellen?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KK3W-WLT` with relatives). Nothing was
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

**RESOLVED — FALSE MATCH (Outcome 3).** The hint
(`ark:/61903/1:1:F2GT-LYK`, "Canada, Marriages, 1661-1949", the father
persona in the 1895 Thomas Dee-Bessie Butler marriage) does **not** belong to
Patrick Hoban `KK3W-WLT`. It matched on a first name, a city, and a son named
Thomas born within a year or two — and nothing else.

**What decided it.** The hinted groom is Thomas **Dee**, born 1874 at Halifax,
whose parents appear only as bare forenames "Patrick" and "Ellen". His own birth
record — Canada, Nova Scotia, Births, 1864-1877, `ark:/61903/1:1:F26H-XH5` —
names him Thomas A. Dee, born 8 October 1874 at Halifax, son of **Patrick Dee**
and **Ellen Callahan**, corroborated by his baptism (`ark:/61903/1:1:XLPP-H96`,
"Thomas Alexander Dee", October 1874). Independent searches surfaced the whole
family: a documented **Patrick Dee x Ellen Callahan/Callaghan** household of
Halifax (marriages in NS Marriages 1864-1918, NS Church Records, NS Vital
Records and Canada Marriages 1661-1949; children Thomas A., Mary E., Frances and
Patrick Reginald Dee in NS Births 1864-1877 and NS Births and Baptisms). So the
1895 marriage's "Patrick and Ellen" are Patrick Dee and Ellen Callaghan.
FamilySearch's own tree already keeps them separate: the hint persona
`F2GT-LYK` and the Patrick Dee x Ellen Callaghan marriage (`KMLR-1S6`) attach to
tree person `LYB7-7BR` (Patrick Dee), and the groom's birth/baptism attach to
`LRPZ-92D` (Thomas Dee) — neither is a Hoban PID.

Patrick Hoban's own records disagree with the hint on every discriminator except
the given name and city: his wife is **Catherine Donovan**, married 18 November
1867 at Halifax (`ark:/61903/1:1:DX6P-6YT2`), and his son named Thomas is
**Thomas Patrick Hobin** `KK3W-WLP`, born 11 February 1873
(`ark:/61903/1:1:F264-DXS`) — surname Hobin, mother Catherine, born 1873 not
1874. Thomas Patrick Hobin is confirmed alive in the 1881 census in Patrick
Hobin's own household; his adult fate is not conclusively traced beyond 1881, but
that is immaterial — the 1895 groom is independently identified as Thomas A. Dee.

**What was searched and came up empty.** A search of the Nova Scotia marriage,
birth, church and census collections for a Patrick-and-Ellen household at Halifax
returns the Dee/Callaghan family, not the Hoban/Donovan one; no record makes
Patrick Hoban (b. 1836) the father of the 1895 groom or gives him a wife named
Ellen. An absent "Ellen" on the tree does not by itself rule out a second wife,
but the affirmative Dee family accounts for both "Patrick" and "Ellen" as a
different couple, closing that gap.

**Retrieval method.** Record retrieval was tool-assisted — done in a Claude Code
session using the genealogy MCP read tools (`record_read`, `record_search`,
`person_read`, `source_attachments`) against live FamilySearch. No original
register image was examined; all evidence is from indexed records. The identity
judgement (that the hint is a false match) is the genealogist's.

Note for the corpus: the batch CSV labels this row Ireland. Every record is Nova
Scotian; Ireland is where the subject's parents were born (County Kilkenny), and
the fixture is tagged CA-NS.
