# Jean-Baptiste Cupis — burial in May 1788, Montreuil, France

**Source PID:** `K642-XP9`
**Jean-Baptiste Cupis is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Christened 23 November 1711 in Brussels, son of Ferdinand-Joseph Cupis and Marie-Anne De Smedt; the tree gives his death as 30 April 1788 with no place and carries no burial. Married Constance Dufour in 1729 in Belgium.

## Research question

> When and where was Jean-Baptiste Cupis buried? He was the son of Ferdinand-Joseph Cupis and Marie-Anne De Smedt, was christened in Brussels on 23 November 1711, married Constance Dufour in 1729, and died on 30 April 1788.

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `K642-XP9` with relatives). Nothing was
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

**Resolved 2026-10-12 (#3326): true match.** The hint record
`ark:/61903/1:1:DRKL-YZMM` ("France, Seine-Saint-Denis, Parish and Civil
Registration, 1523-1932") is the burial of tree person K642-XP9, and f1 stands
as drafted. The hint came from `filtered-list-samples-3.csv` row 3,
`hint-samples.csv` row 68, flags `adds_birth,adds_burial`, confidence 3.

**Retrieval.** All of it used the `packages/engine/mcp-server/dev/try-*.ts`
scripts against live FamilySearch, not familysearch.org by hand:
`try-person-read K642-XP9`, `try-record-read` on the hint and on three
neighbouring entries, a `try-record-search` of collection 3241307 for 1788
Montreuil deaths, and `try-image-transcribe` on the page.

**Baseline.** The live tree person carries no record sources at all, so the
hint does not re-index anything already attached. The tree gives christening
23 Nov 1711 in Brussels and death 30 Apr 1788 with no place. It has no burial.

**What decided it: the index alone.**
- **Name.** The entry indexes "Jean Baptiste de Cupis", male. The noble
  particle fits a family the tree itself identifies through his sister Marie
  Anne De Cupis De Camargo, the dancer La Camargo.
- **Death date.** Death 30 Apr 1788, burial 1 May 1788. The death date is
  exactly the tree's.
- **Age.** A computed birth year of 1710, about a year off the tree's 1711
  christening. That is the usual error in an age at death.
- **The confounder.** The only in-tree confounder, his son Jean Baptiste
  Cupis (`MHT2-X6G`), is ruled out by the index's age. A son of the 1729
  marriage could not have been about 78 in 1788.
- **Place.** The record states the parish of Montreuil itself, "cette
  paroisse", and the image is catalogued as "Montreuil, Seine, France". So
  the event place is Montreuil-sous-Bois, which lies today in
  Seine-Saint-Denis. That is the town f1 names, in modern jurisdiction, so f1's
  place stands. A burial near Paris also fits a family whose son François was
  born in Paris in 1732.
- **The `adds_birth` flag.** It is an indexing artefact. The 1710 is computed
  from the age at death, and nobody should replace the christening with it.

**Image reading: failed calibration, discarded.** The page image
`ark:/61903/3:1:3Q9M-CSLZ-X9KW-2` was transcribed with `image_transcribe`.
Before using it, three other entries on the same image that the index already
holds were compared on the burial fields: name, burial and death date, age, and
spouse or parents.
- **Match.** François Thomas Cornu (`1:1:DRKP-95N2`, buried 23 Apr 1788, aged
  41, wife Marie Denise Gabrielle Beausse) matched.
- **Mismatch.** Jean François Doucet (`1:1:DRKP-95W2`, buried 25 Apr 1788)
  did not. The index names his mother Marie Antoinette **Carme** and the
  transcription reads **Cornu**.
- **Spelling variant.** Nicolas Robert Lardin (`1:1:DRKP-95MM`) differed only
  in the spelling of his wife's surname, Laizier against Laissier.

One of the checks differs, so everything the transcription read from the page
is discarded, and `image_basis` is not set. For the record only, and **not
relied on**: the discarded transcription has the act giving age 78, "en sa
maison rue Marchande", and witnesses who were bourgeois de Paris, with no wife
or child named. Nothing in it contradicts the index.

**What an agent must find.** The burial on 1 May 1788 at Montreuil, the day
after the 30 April death, from the parish register entry above.

**How this call was made.** The evidence was retrieved and the verdict drawn by
Claude Code, at the direction of the assigned genealogist (@Emruthwill).
