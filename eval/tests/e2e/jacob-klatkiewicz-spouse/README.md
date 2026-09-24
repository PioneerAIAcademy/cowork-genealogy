# Jacob Klatkiewicz — son Stanislaus baptised 1886 at Ceradz, Posen

**Source PID:** `LDZR-XPT`
**Jacob Klatkiewicz is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 21 June 1827 at Garaschewo, baptised 1 July 1827 at Gluschin, Posen; died and buried at Runkeln/Rumianek, Posen West.

## Research question

> Is the Stanislaus Klatkwicz baptised 2 May 1886 at Ceradz, Posen the son of Jacob Klatkiewicz and Hedwig Kurek that the tree records as born in 1884 at Rumianek?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `LDZR-XPT` with relatives). Nothing was
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

**Resolved: ANSWERABLE, BUT DIFFERENTLY** (outcome (b)) — adjudicated
2026-09-24 from issue #2315. The hint record is real and correctly matched to
this family; what it documents is the son the tree **already has**, with a
birth date the tree gets wrong by two years. `expected-findings.json` now
carries a corrected `required` finding naming `LDZR-PH7`, paired with an
`avoid` finding so no second wife is created.

### What decided it

The hint index entry and the register page behind it disagree, and the
register wins on both points.

| | Tree (`LDZR-PH7`) | Index entry | Register, entry 44 |
|---|---|---|---|
| Name | Stanislaw | Stanislaus | Stanislaus |
| Born | 1884 | 30 Apr 1886 | **30 Apr 1886, 4pm** |
| Place | Rumianek | *Ceradz* | **Rumianek** |
| Mother | Hedvirgis **Kurek** | Hedvigis **Rurek** | Hedvigis **Kurek** |

**The places were never in conflict.** The index records Ceradz because that
is the parish church where the baptism happened; the register's *Locus
Nativitatis* column gives the village, and it reads Rumianek — the same
village the tree gives. The "two years and fifteen kilometres apart" framing
in the original draft was an artefact of reading the index alone.

**The mother is Kurek, not Rurek.** The register is unambiguous. The
`adds_spouse` flag is exactly the red herring the draft suspected, confirmed
from the page rather than assumed.

**The index corroborates that without appeal to the image.** On this same
entry the index spells the surname `Klatkwicz` for both child and father,
dropping the `ie` the tree carries on all five Klatkiewicz persons. So `Rurek`
is not an isolated oddity asked to be accepted on one scan reading: it is the
second error on one line, by one indexer. The page carries more of the same —
`Dwczarczak` (for Owczarczak), `Pichswiak`, `Lzeszak` — among the 17 entries
FamilySearch indexes from it.

That noise cuts both ways and is recorded here for the next reader: it is
evidence for the index-error reading, and it is also a caution for anyone
calibrating a transcription against this page under Step 1a, since a mismatch
there may mean the indexed side is wrong rather than the reading.

**One limit of the `avoid` finding, stated rather than hidden.** `f2` rules out
adding "Rurek" to `LDZR-FTC`'s names in the tree, which is a *grading*
constraint and not genealogical advice — recording a source's name variant on
the person is ordinarily right. The avoid guard matches on names alone and
exempts only the fixture's subject (`LDZR-XPT`), so an alternate name on the
wife is indistinguishable from a newly created second wife and force-fails the
finding. No edit to this fixture can separate the two cases; the variant is
therefore recorded in `research.json` instead.

**The 1886 child did not die in infancy.** The entry carries a later marginal
annotation: *"Iniit matr. 11.2.15. Posnan. S. Adalb. cum Ant. Matuszak"* — he
married on 11 February 1915 at St Adalbert's, Poznań. So no name-reuse
scenario is needed to explain a single surviving Stanislaw in the tree.

**`LDZR-PH7` carries no source at all** (`person_read --sources` returns an
empty list), and Jacob himself carries exactly one — his own 1827 baptism.
The tree's "1884" rests on nothing.

### What was searched and came up empty

The disconfirming check for the two-sons reading is an elder Stanislaus who
died before April 1886. He does not exist in this register:

- **1884, complete (entries 1-93)** — the tree's own claimed year. No
  Klatkiewicz baptism of any kind.
- **1885, complete (entries 1-113)** — none.
- **1883, entries 52-119** — none. The volume *opens* at 1883 entry 52; the
  earlier part of that year is in the predecessor film, `008015866_010`
  (Ceradz, 1858-1883), which was not searched.

Image group **008024989**, images 00006-00023 inclusive, read page by page.
Several Stanislaus baptisms fall in that span, including some at Rumianek — to
Plick, Horonski and Napieralski among others. None to Jacob. The pages were
read to answer one question, "is there a Klatkiewicz here", so no Stanislaus
tally is asserted: anyone wanting a count should derive it rather than inherit
one from this paragraph.

One positive find from the same sweep: **1885 entry 101** (November) records
*"Jacob Klatkiewicz ż Rum[ianek]"* standing as godfather to a Bogucki child.
He was living at Rumianek five months before the 1886 birth, in the very year
between the tree's claim and the register's record.

### On the father's age

Jacob was born 21 June 1827 (baptised 1 July 1827 at Gluschin, Posen Ost), so
he was 58 at this birth. That is late but unremarkable, and the register gives
no competing Jacob: no second Jacob Klatkiewicz appears anywhere in the
1883-1885 pages. The wife's age remains unestablished — the tree gives her
none, and the baptism register does not record parents' ages.

### Step 1a image-reading calibration

Required by the Step 1a calibration rule (`docs/e2e-testing-guide.md`). Every
reading asserted here was made by eye from the scans, which the rule covers
explicitly — it names "you reading the scan by eye" alongside the automated
readers.

Two other entries indexed by FamilySearch from the same image
(`3:1:3Q9M-CSXV-6JG3`) were read from the register and compared:

| | index | register | |
|---|---|---|---|
| `1:1:6FZ9-65VY` child | Antonius Waniewski | Antonius Waniewski | match |
| father | Franciscus Waniewski | Franciscus Waniewski | match |
| mother | Agnes Rakowska | Agnes Rakowska | match |
| born / baptised | 18 May / 18 May 1886 | 18 May / 18 May 1886 | match |
| `1:1:6FZ9-KW58` child | Joannes Stachowiak | Joannes Stachowiak | match |
| father | Michael Stachowiak | Michael Stachowiak | match |
| mother | Josepha Szymankiewicz | Josepha Szymankiewicz | match |
| born / baptised | 11 May / 23 May 1886 | 11 May / 23 May 1886 | match |

**Both match, so the reading is licensed for those fields**, and `Rurek` stands
as an index error rather than a misreading: the same eye that read `Kurek` on
entry 44 read two neighbouring entries exactly as the index holds them.

**What the pass does not cover, stated rather than assumed.** Clause 2 licenses
*those fields* — child, father, mother, date — and clause 4 excludes farm,
residence and occupation outright. Two readings here sit outside that grant:

- **`Rumianek` from the *Locus Nativitatis* column.** No index field was
  compared against it; the index's place is Ceradz, the parish of baptism, a
  different column. It is corroborated instead by the starting tree, which
  independently records Rumianek as `LDZR-PH7`'s birthplace — the one element of
  the tree's entry this resolution does *not* correct.
- **The marginal marriage annotation** (11 Feb 1915, Poznań St Adalbert's). A
  marriage date, place and spouse are none of the four compared fields, so the
  calibration says nothing about it. It is offered as the reason no name-reuse
  scenario is needed, not as a graded claim, and no finding depends on it.

The 1883-85 sweep for absent Klatkiewicz baptisms rests on child and father
names, which are compared fields, so it is within the grant.

**Caution for the next reader.** This page's index is visibly noisy —
`Klatkwicz`, `Dwczarczak` (for Owczarczak), `Lzeszak` among its 17 indexed
entries. The two entries above were chosen *because* their indexed names are
clean and plausible. Calibrating against one of the garbled ones could have
failed the check on the index's error rather than the reader's, and the rule as
written has no provision for that: it has a clause for too *few* indexed entries
and none for unreliable ones.

### Provenance

Record retrieval used `packages/engine/mcp-server/dev/try-*.ts` against live
FamilySearch, per the option-A decision in `docs/specs/e2e-test-spec.md` §3.6.
The identity judgement was a human call, not a tool output. The register pages
were read from the scans directly; OCR was not relied on for any reading
asserted here.
