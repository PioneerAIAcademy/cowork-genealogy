# Julius Edlund Eilertsen — a 1910 union with Anne Kathrine Edvardsen

**Source PID:** `GDCS-WYY`
**Julius Edlund Eilertsen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 24 February 1889, baptised 7 March 1889 at Steigen, Nordland; resident at Ledingen in 1900; death not recorded in the tree.

## Research question

> Did Julius Edlund Eilertsen of Leines, Steigen marry Anne Kathrine Edvardsen on 15 August 1910 — a year before the 1911 marriage to Petrine Elisabeth Edisdatter the tree records?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GDCS-WYY` with relatives). Nothing was
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

**RESOLVED — TRUE MATCH (Outcome a).** The hint is correct: Julius Edlund
Eilertsen (`GDCS-WYY`) married **Anne Kathrine Edvardsen** (b. 1893, Steigen, of
Leines, daughter of Edvard Johansen/Johannessen) on **15 August 1910 in Bodø**.
Hint record: `ark:/61903/1:1:68WM-Q2DG`.

**The man is certain and the 1910 event is the marriage, not banns.** The record's
Julius Edmund Eilertsen (b. 1889 Leines, father Eilert Johan Jensen) is the tree's
Julius Edlund Eilertsen (b. 24 Feb 1889, baptised Steigen, father Eilert Johan
Jensen) — Edlund/Edmund is one letter, the rest exact. The **Bodø marriage
register page was examined** (`ark:/61903/3:1:3QHK-Q3P5-YK5F`): its header reads
"Aar 1910, **D. I Ægteskab Indtraadte**" (marriages contracted), and entry No. 37,
dated 15/8 1910, records Julius Edmund Eilertsen (Fisker, Leines) and Anne Kathrine
Edvardsen, both **1st marriage**, banns column **"ikke lysning"** (married by
licence, without banns). So this is the `vielse` itself — not `forlovelse` or
`lysning`.

**Corroboration from a second parish register (also examined).** The couple's
Leiranger (Steigen) home-parish register (`ark:/61903/1:1:68WM-2WVL`, image
`ark:/61903/3:1:3QHV-13P5-1SS8`) records the same couple with the remark
**"ægteviet i Bodø kirke, attest 16/8"** (married in Bodø church, certificate
16 Aug). FamilySearch indexes that entry under **1911** only because the home
parish back-recorded the Bodø marriage in a later section of its book — the same
page back-records other 1910 Bodø marriages (e.g. Martin Torkildsen, who is
entry 36 in the 1910 Bodø register). The marriage date is 15 August 1910. A third
index, `ark:/61903/1:1:68WM-Z75R`, is a parallel-register copy of the same 1910
Bodø marriage. The independent corroboration is `68WM-2WVL` (Leiranger) and
`68WM-Z75R` (parallel register). The third supporting source is the hint
record's own page scan (`3:1:3QHK-Q3P5-YK5F`), read directly rather than taken
from its index — better evidence than the index, but not a second record.

**The tree's competing 1911/Petrine marriage is unsourced.** Julius's live page
carries only three sources — two 1889 baptisms (`687B-9PF2`, `687Y-T7V9`) and the
1900 census (`DJ6F-6Q2M`), none a marriage record — so the `1911` Couple fact with
Petrine Elisabeth Edisdatter (`GDJ3-R2L`) has no source behind it. The only
*sourced* marriage for Julius is the 1910 union with Anne Kathrine. (The impossible
Julius→Emil Knutsen link, Emil b. 1898, likewise shows the cluster's parent links
are unvetted.) These are live-tree defects; they were **not** edited as part of
this adjudication, and the hint was not attached.

**Searches.** "Norway, Church Books, 1797-1958" marriage 1909–1912 for Julius
Eilertsen returned the three indexings above; a broad Anne Kathrine Edvardsen
(b. 1891–1895) search found no death/burial 1910–1912 for the bride (a 1899-death
Anne Kathrine Edvardsdtr is a different child, b. 1892 Nord-Trøndelag; a 1914
Bergen baptism naming an "Anna Kathrine Edvardsen" is a different couple, husband
"Julius Pedersen Eidelund"). Retrieval was tool-assisted (MCP `record_read`,
`record_search`, `person_read`, `source_attachments`, and `image_transcribe`);
the two Bodø and Leiranger register images were actually examined, and all other
evidence is indexed. The identity judgement is the genealogist's.
