# flynn-parentage-not-proved

Patrick Flynn parentage research where a reasonable search has been done but
the evidence **does not lean either way**. Built for the proof-conclusion test
that exercises the **`not_proved`** tier, the **Proof Argument** vehicle, and
the "do not write the tree below `probable`" invariant.

Two equally-plausible candidate fathers, and nothing connects adult Patrick to
either:

- **Candidate A** — the 1850 census shows a Patrick Flynn (age 5) in **Thomas**
  Flynn's household (dwelling 84).
- **Candidate B** — the 1850 census also shows a Patrick Flynn (age 6) in
  **Michael** Flynn's household (dwelling 210, a different district).
- **1860** — adult Patrick (age 15) is a **boarder/coal laborer** in the
  unrelated Owen Donnelly household; no Flynn is present, so it ties him to
  neither 1850 household.
- **1908 death certificate** — the father field is **blank** (the son-in-law
  informant reported "unknown").
- **Baptism search** — **negative**; the one record type that would name the
  father directly does not survive.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (father, `exhaustive_declared`)
- **Plans:** pl_001 (completed — 1850, 1860, death cert, baptism all searched)
- **Log:** 4 entries, including the negative baptism search
- **Sources:** 4 (two 1850 households, 1860 boarder record, death cert)
- **Assertions:** 12, including negative evidence (a_012: father not recorded)
- **Conflicts:** none — see note below
- **Hypotheses:** h_001 (Thomas) and h_002 (Michael), **both `active`**, neither ruled out
- **Proof summaries:** none yet — this is what the skill under test must produce
- **GedcomX persons:** I1 (Patrick), I2 (Thomas), I3 (Michael)
- **GedcomX relationships:** **none** — no `ParentChild` can be concluded

## Why this should be `not_proved` (and a Proof Argument)

After searching the records that could disambiguate the two candidate
households, the evidence supports Thomas and Michael **about equally** and
decisively links Patrick to **neither**. There is no basis to lean — the
question stays open. That is the definition of **`not_proved`**.

Because the case turns on weighing two competing candidates with only indirect
evidence and an attempted-but-failed elimination, the honest write-up is a full
**Proof Argument** (not a Statement or Summary) — a reader needs the whole
chain of reasoning to agree the answer cannot be determined.

## Design note: competing **hypotheses**, not a `conflicts[]` entry

The rivalry between the two candidates is represented as two `active`
hypotheses, **not** as an unresolved `conflicts[]` entry. This is deliberate:
proof-conclusion's preconditions tell it to **stop and route to
conflict-resolution** when it meets an *unresolved conflict*. Modeling the
rivalry as competing hypotheses (the proper home for competing candidate
explanations) lets the skill do its actual job here — reach a `not_proved`
conclusion — instead of deferring. The genealogical content is identical; only
the bookkeeping differs.

## Used by

- proof-conclusion positive test: write a `not_proved` conclusion as a Proof
  Argument **and leave `tree.gedcomx.json` unchanged** (the pre-state has no
  `ParentChild` relationship, so a correct run leaves the tree identical).
