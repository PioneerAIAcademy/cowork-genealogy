# Daniel Cook — wife and sons' 1850 census (1820s–1850s)

**Source PID:** `KWJT-3ZB`
**Daniel Cook is deceased** (b. 15 Dec 1798, d. 5 Feb 1875). (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> Who was Daniel Cook's wife, and what do the family's 1850 census entries show about his sons David and Isaac?

## What was removed from the starting tree

- Removed **Mary Maria Fuller** (b. about 9 May 1798, New Brunswick) — Daniel Cook's wife — entirely, along with the `Couple` relationship between them and all eleven `ParentChild` relationships linking her to their children. The children themselves, and their own facts, were left in place; only Mary Maria Fuller's side of each parent link went with her.
- Removed Daniel Cook's own duplicate `Marriage` fact (the couple's shared marriage fact on relationship R1 already carries the same 1820 date/place; leaving Daniel's copy in place would have left the marriage answer visible on his own record even with Mary Maria Fuller gone).
- Removed **David Cook**'s 1850 Census fact (Great Salt Lake, Utah Territory).
- Removed **Isaac Cook**'s 1850 Census fact (Great Salt Lake, Utah Territory).
- Redacted every remaining mention of Mary Maria Fuller by name, since removing her person record and Daniel's `Marriage` fact still left the answer readable elsewhere:
  - Person `KWJT-3ZB`, fact `87ef2dce-279a-4264-9a0c-751bedc238d4` (`LifeSketch`) — dropped the sentence stating he married her and her birth date, dropped her name from "The Daniel & Mary Maria Cook family", and dropped her name from the closing death sentence. Daniel's own vitals and the rest of the narrative (LDS conversion, migration west, arrival in Utah, his own death) are untouched.
  - Person `KWNT-MX6` (daughter Hannah), fact `270e5305-ee1f-46f7-8d60-03177cd59142` (`LifeSketch`) — dropped "and Mary Maria Fuller" from the sentence naming her parents; the rest of Hannah's sketch (her own marriage, children, 1880/1910 census detail) is untouched.
  - Four tree-level `sources` entries whose **titles** named her directly — sources are never cascaded by `strip`, so removing her person record didn't touch these: `MM9C-TQ3` and `9NZ7-LH5` ("... Daniel Cook and Mary Fuller Family Pioneer Travel" → "... Daniel Cook Family Pioneer Travel"), `MM32-XP8` (the 1820 marriage-record source: "Daniel Cook and Mary Maria Fuller-U.S. and International Marriage Records..." → "Daniel Cook-U.S. and International Marriage Records..." — kept as a findable marriage-record source, just without naming who he married), and `QLT9-71W` ("... My Grandparents Daniel Cook and Mary M. Fuller" → "... My Grandparents Daniel Cook"). None of these facts/sources carry a `sources` back-reference in this tree (nothing in the starting tree does — an unrelated data-fidelity gap, not specific to this fixture), so the redaction is title/value text only.
- Kept intact: Daniel Cook's own vitals, all eleven children as persons with their remaining facts, and his own parents (L6KS-9PW, LCTY-WSJ) and their relationship to him.

## Expected difficulty

Medium — the marriage is independently corroborable via a named marriage-record source in the live data ("U.S. and International Marriage Records, 1560-1900"), a reasonably direct path once the agent searches for Daniel Cook's spouse. The two census facts require finding the family's 1850 household in Great Salt Lake, Utah Territory and confirming both sons appear in it — a single census search should surface both if the agent looks at the whole household rather than one person at a time.

## Notes for reviewers

Regression fixture for issue #1473 (forget-and-rederive strips relationships and never restores them from the records it then finds). The reported bug: a real forget-and-rederive run on this same PID, asked to forget information before 1850 and re-derive Daniel Cook's birth, over-removed (his wife and children's facts went with it) and under-restored (records found while researching the birth named those same people, but the removals were never reasserted). This fixture reproduces that shape at a scale a benchmark run can grade — the starting tree already reflects the over-broad removal (wife gone, two sons' census facts gone) — and requires ordinary research (not the forget-and-rederive skill itself) to put all three back. A pass demonstrates that research recovers what a prior removal took, not only the one fact a researcher explicitly asked about.

While authoring this fixture, live snapshotting of this PID surfaced two independent tooling defects, filed separately and not exercised by this fixture: `research.json` schema drift blocking `tree_forget` outright (#1572), and `tree_forget` removing a fact from every person that happens to share its id rather than only the requested owner — confirmed on this exact PID, where FamilySearch returns the identical fact id for six different people's Birth facts (#1574). The unstripped tree also needed two hand-fixes before `strip`/`validate` would accept it: a `blessing` fact type recapitalized to `Blessing`, and a garbled `1851+Census+of+...` type relabeled `Census` — both on people (Mary Maria Fuller, Lydia Churchill) unrelated to this fixture's findings, and Mary Maria Fuller's is moot regardless since she is stripped entirely. Several dozen duplicate fact ids elsewhere in the tree (same cause as #1574) were mechanically re-keyed with `-dup2`/`-dup3`/... suffixes to satisfy `strip`'s uniqueness precondition; none of the renamed ids belong to this fixture's three findings.

**Review fix (2026-08-13):** a review on the PR caught that finding f1's answer was still readable in the starting tree even after Mary Maria Fuller's person record was removed — two `LifeSketch` facts (on Daniel himself and on daughter Hannah) narrated the marriage and her identity in plain prose, so an agent could pass f1 by reading a note instead of researching a record, which defeats the point of a #1473 regression test. Fixing only the two sentences the review quoted turned out to be incomplete: Daniel's `LifeSketch` still named her twice more ("The Daniel & Mary Maria Cook family", and her death sentence beside his), and a broader sweep of the whole starting tree for "Maria"/"Fuller" additionally turned up four **source titles** naming her directly — sources aren't cascaded when a person is stripped, so removing her person record never touched them. All of it is redacted now (see above); a repeat sweep of the full tree for both name fragments comes back empty. f2 and f3 were never affected.
