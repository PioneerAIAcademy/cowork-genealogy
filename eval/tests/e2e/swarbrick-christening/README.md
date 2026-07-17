# Robert Swarbrick — parents and christening, with a same-name/same-year lookalike to avoid

**Source PID:** `MM4W-19N`
**Robert Swarbrick is deceased.** (Christened 20 Dec 1797, Poulton-le-Fylde,
Lancashire; died about 20 Nov 1839, Hambleton, Lancashire. FamilySearch ToS
requires all committed e2e fixtures to be about deceased persons.)

## Research question

> Who were the parents of Robert Swarbrick, and when and where was he
> christened, given that two same-named Robert Swarbricks were christened
> within months of each other in neighboring Lancashire parishes in 1797?

## Why this fixture exists

FamilySearch's own tree for this Robert carries a genealogist's note flagging
that **two** Robert Swarbricks were christened in 1797 in neighboring
Lancashire parishes — this one (son of John Swarbrick and Grace Collinson,
christened 20 Dec 1797 at St. Chad, Poulton-le-Fylde, twin of John) and a
different-family Robert (son of William Swarbrick, christened 11 Jun 1797 in
the parish of Hambleton). Both the differentiation note and the citing source
are removed from the starting tree, so the agent must re-derive the
identity resolution from parish register evidence — not read it off a note
someone else already wrote.

## What was removed from the starting tree

- Removed Robert's **Birth** (19 Dec 1797, Carleton) and **Christening**
  (20 Dec 1797, St. Chad, Poulton-le-Fylde) facts, and his **LifeSketch**
  note — the LifeSketch stated the correct parents and christening details
  and explicitly ruled out the other Robert by name, so it had to go or the
  fixture would be trivial.
- Severed the **ParentChild** relationships to John Swarbrick (`L88T-VT4`)
  and Grace Collinson (`P6MH-1N8`) — the `recover` targets (f1/f2). Both
  parent persons are **kept** in the tree (with their own facts and 1788
  marriage record) but unlinked from Robert, so they exist as findable
  candidates rather than being handed to the agent as an existing edge.
- Removed the three sources that most directly attest the stripped
  christening/birth: the parish register entry, the "Births and
  Christenings" database source, and — critically — the source titled
  *"TWO Robert Swarbricks christened in 1797 from neighboring parishes —
  differentiation with sources here"*, which named the exact puzzle.
- **Kept:** Robert's Death (Hambleton, 1839) and Burial (St. Chad,
  Poulton-le-Fylde, 1839); his 1821 marriage to Ellen Gardner and all of
  their children (unrelated to this question); John Swarbrick's and Grace
  Collinson's own vitals and 1788 marriage record (the disambiguating
  evidence once found, not the answer itself).

## Expected findings

- **f1 (recover, required):** father John Swarbrick (~1764–1830, Carleton,
  Poulton-le-Fylde).
- **f2 (recover, required):** mother Grace Collinson (~1769–1825, Carleton).
- **f3 (recover, required):** christening 20 Dec 1797, St. Chad,
  Poulton-le-Fylde (born ~19 Dec 1797, Carleton; twin of John).
- **f4 (avoid, required):** must NOT attach Robert to William Swarbrick
  (father of the *other* Robert, christened 11 Jun 1797, Hambleton parish).
  Pass = the recovered father is John Swarbrick, not William, and no
  parentage tracing to the Hambleton-parish christening is asserted for this
  Robert (or it appears only as an explicitly rejected hypothesis).

## Expected difficulty

hard — the two Roberts share a name, a christening year, and neighboring
parishes; disambiguating requires reading parish-register detail (parents'
names, exact parish, twin pairing) rather than a simple name/date lookup.

## Notes for reviewers

- **Expect WARNs from the stripping linter on f1, f2, and f3.** John
  Swarbrick (`L88T-VT4`) and Grace Collinson (`P6MH-1N8`) legitimately stay
  in the tree as unlinked candidates (their relationships to Robert are
  severed, not their person records) — the linter can't distinguish "kept
  as a findable candidate" from "the answer was left attached." Likewise
  `MG3V-ZQP`, Robert's own son also named John Swarbrick, is an unrelated
  namesake, not a stripping miss. And f3's `target_person` is Robert
  himself, who legitimately stays in the tree for a `fact` finding — the
  removed Christening fact was confirmed absent from his `facts` array
  before writing this file.
- The differentiation is genuinely resolvable from FamilySearch data: the
  removed christening source and the (still-present) 1821 marriage record
  and 1839 death/burial anchor Robert to the Poulton-le-Fylde/Hambleton
  area consistent with the Carleton-born, John-and-Grace christening, not
  the Hambleton-parish William Swarbrick line.
