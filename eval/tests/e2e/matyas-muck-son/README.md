# Muck Mátyás — second son named András (b. 1881)

**Source PID:** `97M5-6H8`
**Mátyás Muck is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
25 August 1844, Bikács, Tolna, Hungary; died 31 December 1921, Bikács, Tolna, Hungary.

## Research question

> Did Mátyás Muck and his first wife Erzsébet Wolf of Bikács, Tolna, Hungary have a second son named András, baptized about 1881, after their first son András died in infancy in 1873?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `97M5-6H8` with relatives). Nothing was
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

**Resolved: true match (2026-07-31).** This fixture came from a hint batch (`filtered-list-samples.csv` row 19, flag `adds_son`, confidence 3) in which roughly half the hint records are false matches; this one holds up, but only after resolving a genuine identity conflict and an image-navigation trap — see below. The hint record — FamilySearch derivative index ARK `1:1:VJRW-GQR` / `1:1:VJRW-GQY` (`GQR` is the father-person node within it) — points to entry #44 in "Hungary, Reformed Church Christenings, 1624-1895," a baptism naming child **András Muck**, father **Mátyás Muck** (occupation "földmíves," farmer), and mother **Erzsébet Farkas**. "Farkas" is the literal Hungarian translation of "Wolf," a specific and distinctive linguistic clue tying this entry to Erzsébet **Wolf**, Mátyás's first wife (married 1866, until her death in 1900). The entry's own handwritten date is **19 October 1887 (christened 22 October)** and its place is **Bikács**, house 37 — Mátyás Muck's own birth and death village, and the father's stated occupation (farmer) matches his profile too. The record states the family's faith as **Evangelical**, despite being cataloged in FamilySearch's "Reformed Church Christenings" collection — evidently a mixed-denomination register, not evidence of a different family. Witnesses named: Siegel Jergely & Blazs Erzsébet, and Wirth Pál (farmer) & Mart Éva.

**FamilySearch's derivative index for this record is unreliable on multiple fields, and the underlying image ARK is a navigation trap.** The index gives the place as **Bogyiszló** (the entry itself says Bikács — Bogyiszló is the parish seat, of which Bikács is a filial congregation) and, it turns out, the *year* as well: the entry's own image, `ark:/61903/3:1:9392-9ZVZ-X`, is not a single page but a multi-image film/register — the correct page (entries 40, 44, 45, headed **1887**) only resolves at image index **`i=112`** within collection/group `1858355`. Opening the bare ARK without that index lands on a *different* page of the same film (entries 26–37, headed 1881, Bogyiszló-only, no Bikács mention) — which is what produced an earlier, incorrect "1881" resolution for this fixture, and separately caused the first scored e2e run of this fixture to read the wrong page entirely (its `image_transcribe` call used the bare ARK with no `i=` parameter) and land on a weaker "Probable" tier. The correct page was confirmed by two independently-taken screenshots of the disambiguated image.

**Identity conflict, resolved:** two automated re-reads of the image, plus a re-read of the neighboring 1873 entry for comparison, returned the father's given name as "Mihály" rather than "Mátyás," and one read mangled the surname into something closer to "Mench." This was resolved in favor of **Mátyás** by comparing letterforms against unambiguous "Mátyás" instances by the same scribe elsewhere on the same page, plus an independent instance in the couple's already-sourced 1874 baptism of daughter Éva — both matching entry #44's rendering. A same-village "Muck Mihály" household is real but is a different family. Automated OCR/image-reading passes on this record were unreliable in more than one way (identity misreads, and the image-index navigation trap above) — a careful direct read of the correctly-disambiguated image is what actually settled both.

The tree already has a son named **András Muck**, born 5 February 1873 and died 1 April 1873 (in infancy); a previously-unattached Reformed Church christening record for that same 1873 András (ARK `1:1:VJRW-KJZ`, same collection, same parents' names, same place) independently corroborates that this record set belongs to this exact family. Taken together, the family named a second son András after the one who died in infancy — the same necronym pattern documented in the committed `heinrich-dewus-children-death` fixture. `expected-findings.json`'s finding matches the original hint transcription's identification; the date (1887, not "about 1881") and place (Bikács, not Bogyiszló) are corrected from the unreliable index.

*(Earlier review passes on this fixture concluded, in turn: a false match describing a father "Mátyás Misch" (a misreading this adjudication also encountered before resolving in favor of Mátyás); a true match with the date wrongly left at 1881; and a "correction" back to 1881 based on the wrong page of a multi-image ARK. All were superseded before landing. If this fixture is ever re-run, use image index `i=112` explicitly when reading `ark:/61903/3:1:9392-9ZVZ-X`, or the same wrong-page trap will likely recur.)*

**2026-08-03 — known-hard, currently unsolvable autonomously; expect it to keep failing.** The image-index bug above was fixed in `image_transcribe`/`image_read` (`arkToImageUrl` now forwards `i=`/`cc=`/`groupId=` when the caller's `ark` is a full URL carrying them). That fix only helps when a human supplies the full page URL. Two consecutive scored e2e runs *after* the fix landed both converged on the same wrong page (entries 26–37, not entry 44) anyway, because `record_read`'s output for this record only ever gives the agent the bare ARK — no query context to forward, confirmed live. Neither run tried `image_search` as an alternative route to an unambiguous `imageId`. This is now a confirmed capability gap (tracked in issue #1205), not a fixture-authoring problem — the fixture's answer (`expected-findings.json`) is correct; the current tool chain simply cannot autonomously disambiguate this specific multi-image record without a human-supplied URL. Don't spend further scored runs on this fixture expecting a pass until that gap is closed; a fail here is expected and informative, not a regression.
