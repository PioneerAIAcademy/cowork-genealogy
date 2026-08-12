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
- Kept intact: Daniel Cook's own vitals, all eleven children as persons with their remaining facts, and his own parents (L6KS-9PW, LCTY-WSJ) and their relationship to him.

## Expected difficulty

Medium — the marriage is independently corroborable via a named marriage-record source in the live data ("U.S. and International Marriage Records, 1560-1900"), a reasonably direct path once the agent searches for Daniel Cook's spouse. The two census facts require finding the family's 1850 household in Great Salt Lake, Utah Territory and confirming both sons appear in it — a single census search should surface both if the agent looks at the whole household rather than one person at a time.

## Notes for reviewers

Regression fixture for issue #1473 (forget-and-rederive strips relationships and never restores them from the records it then finds). The reported bug: a real forget-and-rederive run on this same PID, asked to forget information before 1850 and re-derive Daniel Cook's birth, over-removed (his wife and children's facts went with it) and under-restored (records found while researching the birth named those same people, but the removals were never reasserted). This fixture reproduces that shape at a scale a benchmark run can grade — the starting tree already reflects the over-broad removal (wife gone, two sons' census facts gone) — and requires ordinary research (not the forget-and-rederive skill itself) to put all three back. A pass demonstrates that research recovers what a prior removal took, not only the one fact a researcher explicitly asked about.

While authoring this fixture, live snapshotting of this PID surfaced two independent tooling defects, filed separately and not exercised by this fixture: `research.json` schema drift blocking `tree_forget` outright (#1572), and `tree_forget` removing a fact from every person that happens to share its id rather than only the requested owner — confirmed on this exact PID, where FamilySearch returns the identical fact id for six different people's Birth facts (#1574). The unstripped tree also needed two hand-fixes before `strip`/`validate` would accept it: a `blessing` fact type recapitalized to `Blessing`, and a garbled `1851+Census+of+...` type relabeled `Census` — both on people (Mary Maria Fuller, Lydia Churchill) unrelated to this fixture's findings, and Mary Maria Fuller's is moot regardless since she is stripped entirely. Several dozen duplicate fact ids elsewhere in the tree (same cause as #1574) were mechanically re-keyed with `-dup2`/`-dup3`/... suffixes to satisfy `strip`'s uniqueness precondition; none of the renamed ids belong to this fixture's three findings.
