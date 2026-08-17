# Sármán Rozál — additional daughter Viktoria (b. abt. 1892)

**Source PID:** `P873-TWP`
**Rozál Sármán is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
27 September 1872, Livada, Arad, Romania; died not recorded in the tree.

## Research question

> Did Rozál Sármán and her husband István Juhász of Torontál, Hungary have a daughter named Viktoria, baptized about 1892, in addition to their known daughter Ágnes (b. 1894)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `P873-TWP` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Verdict: FALSE MATCH — reject the hint.** Viktoria Juhász (baptized ~1892,
Kiszombor, Torontál) is **not** an additional daughter of Rozál Sármán
(`P873-TWP`). The hinted baptismal record — Hungary, Catholic Church Records,
1636-1895 (`ark:/61903/1:1:XZ6D-FZY`) — names the child's mother as **Rozál
Száz** ("Rozal Szaz"), not Rozál Sármán. This was confirmed at the manuscript
level: entry 48 on the register image (`ark:/61903/3:1:9Q97-YS8R-ZWF`) reads
the mother's surname as **Száz**, gives a Kiszombor address (house 269) and
godparents (Kóbori Lajos, Szabó Mária) — a different household from the project
subject.

**Why the surname conflict is decisive, not a transcription quirk.** "Száz"
and "Sármán" are two entirely different surnames with **no plausible path
between them** through handwriting or indexing error — they share neither stem
nor sound, and the manuscript letterforms (a short Sz-á-z word, with none of
the r/m/n needed for "Sármán") match the index exactly. The match was triggered
algorithmically by the two fields that *do* agree: the mother's given name
(Rozál) and the husband's name (István Juhász). But **István Juhász was a
common name in 19th-century Torontál**, so the most economical explanation is a
**different couple entirely** — a *Száz* Rozál married to her own István Juhász,
resident in Kiszombor — rather than a married-name variant or a mis-index of
the tree's Sármán. A matching given name plus a common husband name does not
overcome a hard surname conflict.

**What was searched and came up empty.** The one ~1892 Viktoria baptism the
hint surfaces in Hungary, Catholic Church Records, 1636-1895 is this Száz
record; no record in that collection ties a daughter Viktoria to Rozál
*Sármán*. Note that the family's own parish records (Arad county — the tree's
confirmed daughter Ágnes was born 1894 in Zimándudvar) are **not indexed** in
FamilySearch; the disproof therefore rests on directly examining the hinted
Kiszombor record and finding it belongs to another household, not on finding a
positive Sármán record. The tree's documented children of Rozál Sármán and
István Juhász stand as they were — Ágnes (b. 1894) remains the recorded
daughter, with no older sibling Viktoria established.

The fixture therefore expects the agent to **decline** the hint: no daughter
Viktoria added for Rozál Sármán (`polarity: "avoid"`, f1), paired with a
documented negative conclusion (f2).
