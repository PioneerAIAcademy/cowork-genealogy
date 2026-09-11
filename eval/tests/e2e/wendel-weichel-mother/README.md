# Wendel Weichel — mother Josefine, in the 1926 Saskatchewan census household

**Source PID:** `G8Q5-BJ1`
**Wendel Weichel is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1912; died 1980, buried at Odessa, Saskatchewan.

## Research question

> Who were the parents of Wendel Weichel (b. 1912, d. 1980, Odessa, Saskatchewan) — in particular his mother, whom the tree does not name?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `G8Q5-BJ1` with relatives). Nothing was
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

**Resolved 2026-09-09: true match.** The hint record
(`ark:/61903/1:1:QP51-QH2Y`, *Canada, Prairie Provinces, Census, 1926*) is
Wendel Weichel's family of origin, and it names the mother the tree does not:
**Josefine**, b. 7 September 1891 in Russia.

**What decided it.** The identification rests on the tree side as much as the
record side, which is what lifts it above an index-only match. Wendel's tree
already carries his wife **Rosa K Deis** (`GQB7-212`) with a 1926 residence in
**Weyburn No. 67** — the identical census subdistrict as the hinted household,
recorded independently of this hint. The household profile matches the subject
exactly: Russian-born, German-surnamed, immigrated 1924, which is the same
population as Wendel's own AHSGR (Germans-from-Russia) obituary source.
"Windelin" in the census is the full form of "Wendel", and the census's 1913
against the tree's 1912 is ordinary census age slop. Wendel's only two attached
sources are Find a Grave (`ark:/61903/1:1:QVGH-T5TF`) and that AHSGR obituary
(`ark:/61903/1:1:QVSQ-YZ8Y`), so this hint is genuinely new evidence and not a
re-indexing of something he already has.

**The surname split is an indexing artifact, not a real one.** The index spells
the parents *Weishel* and every child *Weichel* within the one household. Read
on the image, the enumerator's hand is one consistent surname throughout; the
two spellings are the indexer's error. The findings therefore give the family
as **Weichel** and note the *Weishel* index spelling in parentheses, so an agent
quoting the index verbatim still matches.

The household schedule spans two images, cited here so the reading above can be
checked: `ark:/61903/3:1:3Q9M-C395-G92G-2` and
`ark:/61903/3:1:3Q9M-C395-G9GQ-F`. Both are the original 1926 census schedule
for Weyburn No. 67; the index entries the fixture hands the agent
(`ark:/61903/1:1:QP51-QH2Y`, Wendel's person entry) and the household record
the graded run cited (`ark:/61903/1:2:QTM1-JBYT`) are FamilySearch's indexed
transcript of those pages, not the pages themselves. An agent is not expected
to open the images — no finding scores on the surname spelling — but a reviewer
checking the artifact claim needs them.

**The census Jacob fills the placeholder — he does not compete with it.** The
tree's father `GX6M-5HT` is an unnamed placeholder (surname "Weichel", a bare
Death fact) already linked as Wendel's parent. That placeholder *is* the census's
Jacob. An agent that answers "the tree's unnamed father is Jacob Weichel"
is correct, and `f2` says so explicitly; an agent that adds a second, competing
father person has got it wrong.

**Finding shape, and why.** The research question asks for the parents "in
particular his mother", so `f1` is mother-only and is the sole `required: true`
finding — that is the bar the judge holds the agent to. The father's name
(`f2`), the 1926 residence and 1924 immigration (`f3`), and the four siblings
(`f4`) are all `required: false` bonuses. Splitting the father out of `f1`
matters mechanically as well as editorially: under spec §3.4.2 only `link`
components score on a relationship finding, so a bundled mother+father finding
would have scored `partial` for an agent that recovered the mother perfectly
and left the placeholder father unnamed.

**Her maiden name is Reiss, and her birth date is 7 September 1891.** The
Find a Grave memorial at Odessa, Saskatchewan (memorial no. 116369692,
`ark:/61903/1:1:QVGH-T5TC`) records her as **Josephine Reiss Weichel**, b. 7
September 1891, d. 27 January 1974 — buried in the same plot as Wendel, his
wife Rose K. Deis Weichel, and Stanley Weichel. "Reiss Weichel" is the Find a
Grave convention of maiden name followed by married name. `f1` carries the 7
September 1891 date; the 1926 census's "about 1892" is an enumerator's age
figure and the weaker of the two.

Note the evidential weight before leaning on it: the Find a Grave *Index* is a
**derivative** source — FamilySearch's index of a volunteer-submitted memorial,
whose dates are secondary and whose underlying memorial image has not been
examined. It is good enough to prefer over a census age, not good enough to
call the birth date proved. Under spec §3.4.2 a linked person's own birth date
is a `detail` component and does not score, so an agent that recovers only the
census's "about 1892" still matches `f1`.

**Immigration place corrected post-run.** The Immigration fact on the mother
carried the indexed destination "Wellburn, Thames Centre, Middlesex, Ontario,
Canada", and that reading was standardised: the fact's `standard_place`
resolved to "Thames Centre Township, Middlesex, Ontario, Canada", so a place
authority value — not only the display string — places her immigration in the
wrong province. That is a transcription error: the original manifest image
(`ark:/61903/3:1:3Q9M-C34W-PRCN`) reads "Odessa, Sask.", and the
`research.json` assertion `a_011` already records the corrected place —
**Odessa, Francis No. 127, Saskatchewan, Canada** — with the transcription
error noted. The tree fact was never re-synced to the assertion during the run.
Immigration place is not a graded component of any finding, so this does not
affect the run's grade.

It is left uncorrected deliberately. Josefine exists only as local person `I1`
in this run's `tree.gedcomx.json` — the agent created her, and she carries no
FamilySearch PID, so there is no upstream tree fact to re-sync (nor any tool
here that writes to FamilySearch: `tree_edit` and `tree_correct` write the
project file only). The one place the stale value survives is the frozen run
artifact under `eval/runlogs/e2e/`, and editing that would misrepresent what
the run produced — the `.ann.json` beside it is a blind human grade of exactly
those outputs. The corrected place lives in `a_011`, which is where a reader
should take it from.

**What has not been found.** No record examined names Josefine's own parents,
and no European baptismal register for Selz (the Black Sea German colony near
Odessa the family emigrated from) was reachable through FamilySearch. Both are
outside this fixture's question and are not graded.
