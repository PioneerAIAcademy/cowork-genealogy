# Scenario: flynn-marriage-parent-match

Mined from a recorded e2e run: `eval/runlogs/e2e/sebastiano-mingazzini-son/run-2026-08-04_00-14-29`
(via `/mine-unit-test --e2e-run`). Names are fictionalized to the corpus's
established Flynn convention — no PII from the source run is carried over.

## The real-run failure this captures

In the source run, person-evidence extracted a marriage bann naming a groom
(new to the tree) and his parents. The father's surname was **not indexed**
on the record; the mother's given+surname was an exact, distinctive match.
Both parent personas carried a non-null `record_persona_id` (the record was
record-search-sourced) and named people already in the tree — exactly the
condition SKILL.md Step 2 says requires a `same_person` call. The skill
instead went straight from `research_query` to `materialize_facts` /
`tree_edit`, linking both parents at `confident` confidence on narrative
correlation alone ("given name matches; surname is implied from the
groom's own surname"). `same_person` was never invoked anywhere in the
session — confirmed by grepping the full run's `tool_calls[]`.

## State (fictionalized)

- **Tree, before this run:** Thomas Flynn (`I1`, b. ~1810, Schuylkill
  County, PA) and his wife Bridget Sheehy (`I2`, b. ~1815), linked as a
  Couple (`RT1`). No other persons.
- **Just extracted:** an 1887 marriage record (`ark:/61903/1:1:FLYN-MARR`)
  naming groom **John Flynn** (persona `G1`, new to the tree) and, within
  the same record, his father **"Thomas [surname not indexed]"** (persona
  `F1`) and mother **"Bridget Sheehy"** (persona `M1`) — nine assertions,
  `a_001`–`a_009`, all attached to `log_001` / `src_001`. `a_001`–`a_009`
  all carry non-null `record_persona_id` (`G1`, `F1`, or `M1`).
- **`results/log_001.json`** holds the record's own GedcomX (all three
  personas + the `ParentChild` edges between them) — what a `same_person`
  call would use to build `gedcomx1`.
- **No `person_evidence` entries yet.**

## What it exercises

Per SKILL.md Step 2/3: `a_005` (father) and `a_007` (mother) are
record-search-sourced and each names a person matching an **existing**
tree candidate (`I1`, `I2`). person-evidence must resolve the persona via
the sidecar, build a tree-subset "matching mob" for the candidate, and
call `same_person` before linking — not link on narrative correlation
alone. The father's unindexed surname is an unaccounted-for name element
that should cap `a_005`'s confidence absent a corroborating score; the
mother's exact, distinctive-surname match can support `confident` once a
score is actually obtained and disclosed. `John` (`G1`) has no existing
tree candidate, so materializing and linking him needs no `same_person`
call — this scenario should not penalize skipping the tool on that half.

## Caveats for the reviewer

- This carve is a best guess at the pre-failure state — verify in the CRUD
  UI that it matches what person-evidence would actually see mid-flow.
- The two `same_person` fixtures' scores (0.58 for the father, 0.89 for
  the mother) are illustrative, chosen to be plausible for a
  partially-indexed vs. fully-indexed match — not derived from any real
  score.
