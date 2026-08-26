# Deep dive: proof-conclusion — findings and validator requests

Issue #1643. Guide followed: [`docs/skill-deep-dive-guide.md`](../skill-deep-dive-guide.md).
Prohibition list: [`proof-conclusion-prohibition-list.md`](./proof-conclusion-prohibition-list.md).

**Corpus read:** all five committed run logs,
`eval/runlogs/unit/proof-conclusion/v1_2026-08-21_04-34-52.json` through
`v1_2026-08-21_19-34-21.json` — 21 tests, 105 runs, 65 newly-written narratives plus 7
re-emitted on re-invocation.
`file_changes`, `tool_calls` and `builtin_tool_calls` were read for every run before any
score, per Step 2. Most of the time went on the quiet passes, per Step 3.

**Retention caveat for a later reader.** `DEFAULT_KEEP_CANDIDATES = 5`
(`harness/versioning.py`), so the re-run this PR forces writes a sixth log and prunes the
oldest — `v1_2026-08-21_04-34-52.json`, which is cited by name below. Those citations
will point at a file no longer in the tree; they were true when read, and the counts they
support (64 of 65 narratives, 15 forbidden-modal sentences, 13 unpaired) are over all five
logs including the pruned one. Recompute against what survives rather than assuming the
totals shifted.

## Numbers, re-derived 2026-08-25

| | command | value |
|---|---|---|
| Tests in the suite | `ls eval/tests/unit/proof-conclusion/*.json \| wc -l` | 21 |
| Non-discriminating dimensions | `make judge-report SKILL=proof-conclusion` | **4 of 8** — `base/Tool Arguments`, `rubric/Evidence completeness`, `rubric/Proof-conclusion fit`, `rubric/Tree encoding` |
| Tests changing outcome across the five logs | `tests[].outcome` compared pairwise | **7 of 21** (007, 009, 010, 011, 012, 018, 019) |
| `judge_context` files naming a score branch | the issue's grep | 3 |
| Existing validators | `grep -c '^def test_' eval/harness/validators/test_proof_conclusion.py` | **13** (the issue body says 14) |

`rubric/Tree encoding` was `n=9 +8 N/A` and flat across those five logs. The issue asked
whether it is flat or merely thinly sampled, and I answered "flat". **That answer was
wrong** — it was thinly sampled. The re-run this PR forced scored it a **1** on
`ut_proof_conclusion_012` (`varies [1, 3]`). See the correction under F6.

## Results of the re-run this PR forced — two of my own claims refuted

`v1_2026-08-25_13-34-10.json`, 21 tests, **$6.63**, 18 min wall (the issue quoted $5.64;
the new judge prompt costs more). 17 pass, 3 partial (007, 018, 019), 1 fail (012).
`releasable: true`, judge prompt `c39d7003…` — the snapshot-drift and stale-judge
complaints both clear.

**F1's fix did not work. `rubric/Proof-conclusion fit` is still flat at always-3**, over
17 gradings, and **13 of 13** narratives are again over their declared budget. The
criterion is being *read* — every rationale now cites the budgets, which it never did
before — and then overridden. From `ut_proof_conclusion_020`:

> "The narrative is approximately 1,200 words — **well within** the ~300–500 word Summary
> budget but justified by the need to correlate three independent sources…"

1,200 is not within 300–500. This is the scratch run's contradiction reproduced with the
count now stated *correctly*, so it was never an arithmetic problem: the judge reaches for
3 and writes whatever bridges to it. Telling it to score on shape instead did not help —
it simply asserts the shape ("reads as a statement, not a summary or argument").

**So the rubric edit was the wrong instrument and I should have known it.** ADR-0011's
first question — can this be decided by reading the project documents alone? — answers yes
for a word count against a closed enum, which makes it a mechanical check, not a judging
criterion. This is the lesson `docs/skill-lifecycle.md` §5 already records for prose edits
generally, now reproduced on a rubric. **V1 is the fix; the rubric edit is at best a
prompt that makes the judge show its reasoning.** I have left it in — it costs nothing and
the visible budget-citation is what made the override diagnosable — but it should not be
counted as closing F1.

**One honest weakening of F1's example.** `ut_proof_conclusion_017` this run is 383 words
against the ≤150 statement budget (×2.55) — but it is **11 sentences under a single
heading**. That is a genuinely statement-shaped document that is merely wordy, and the
judge's 3 is defensible. The indefensible case is 020's 1,200-word "Summary", not 017.
The count alone was never the finding; the count *plus* section headings and a per-source
walk-through is.

**The 4-of-8 → 3-of-8 improvement is not mine.** The composition churned under the new
judge prompt, in both directions, across dimensions I never touched:

| dimension | before | after |
|---|---|---|
| `base/Tool Arguments` | flat | varies [2,3] |
| `rubric/Evidence completeness` | flat | varies [2,3] |
| `rubric/Tree encoding` | flat | **varies [1,3]** |
| `rubric/Proof-conclusion fit` | flat | **still flat** ← the one I edited |
| `base/Completeness` | varies [1,3] | **now flat** |
| `rubric/Narrative standalone` | varies [2,3] | **now flat** |

Two dimensions went flat that were not flat before. Net 4→3 is coincidence, and the
`.ann.json` will be the first real check on whether any of this movement is sound.

**F6 is refuted — see the correction in F6 below.**

## One correction to a shared read-out

`output.tool_calls[]` entries key on **`tool`** and **`args`**, not `name`/`input`. Any
scan written against `name`/`input` returns clean silently — no error, no hits. That is
how F3 and F4 below survived a first pass over this same corpus: the checks ran and
found nothing because they were reading absent keys. Recorded here because the next
auditor will write the same scan.

---

## F1 — Every declared `vehicle` is a claim about the narrative, and 64 of 65 narratives fail it, under a dimension that has scored 3 on all 65

**Did:** `ut_proof_conclusion_015`, run `v1_2026-08-21_19-34-21`, wrote
`vehicle: "statement"` on a **523-word** narrative carrying markdown section headings, an
evidence walk-through, a tier-rationale section and a citation block. The judge scored
`rubric/Proof-conclusion fit` **3**, with the rationale:

> "The proof is written as a Statement (the simplest form), which is appropriate for this
> evidence shape … **The narrative structure follows the Statement form**."

Across all five logs: **64 of 65 narratives exceed their declared form's word budget.**
Twelve declare `statement` at **2.6× to 4.0×** the ≤~150-word bar (worst: 015 at
`v1_2026-08-21_18-43-53`, 599 words, ×3.99). Summaries run 1.2×–2.6×; arguments
1.5×–1.8×. The one narrative inside tolerance is 004 at `v1_2026-08-21_19-20-04` (×1.14).

**Should:** the agent body §3 sizes each form as part of *defining* it — "**Statement** —
a few cited sentences, no explanation needed. Budget: ≤~150 words", Summary "~300–500",
Argument "≤~800" — and the Statement is permitted only when "at least two independent
citations should support the claim **without requiring further explanation**." `rubric.md`
already carries the matching criterion: partial when "the declared form doesn't match the
narrative's actual structure."

**Gap: lane 2 — grading defect, fixed in this PR.** The criterion existed; the judge had
no anchor to measure against and read the declared label back as a finding. `rubric.md`'s
`Proof-conclusion fit` now states the three budgets, says the `vehicle` field is a claim
about the narrative as well as the evidence, and asks the rationale to name which half
failed. It also fences the obvious over-correction — a Summary modestly over ~500 words
that still reads as a Summary is a pass, because the form's defining property is that no
explanation was needed, not its length.

Not a doctrine finding: the substance of these narratives is fine, and a genealogist
would rather read the 523-word document than a 150-word one. What is wrong is the label.
A `vehicle` that does not describe the artifact is a lie in a structured field, and
`vehicle` is what a downstream reader filters on. **Converts — V1.**

**Measured, on a scratch run of `ut_proof_conclusion_016` against the edited rubric**
(`scratch_2026-08-25_13-29-08.json`, $0.41): the criterion fires — the judge now reasons
about the budgets unprompted — but it cannot do the arithmetic. Its rationale reads
"approximately 800 words (**within** Summary range of ~300-500 words)" for a narrative
that is **643** words. Wrong estimate, and 800 is not within 300–500 either way. The
verdict (3) is nonetheless right: at ×1.29 this is the modest-overrun case the criterion
explicitly passes.

So the rubric edit was refined once more before the paid run — it now tells the judge
**not** to attempt a count, to use the budgets as order-of-magnitude anchors, and to score
on shape (headings, per-source walk-through, tier-rationale section) instead. That is a
fix to a demonstrated failure mode, not tuning toward a score.

**The real lesson is that this belongs in V1.** A judge asked to count will guess, and it
guessed 25% high on a document in front of it. The rubric edit gets the dimension
*looking*; only the validator gets it *counting*. Read F1's fresh scores as evidence about
the 12 `statement`-declared narratives at 2.6–4.0×, which are the discriminating cases —
016 declared `summary` on this run and never sat on the violating branch at all.

---

## F2 — A conclusion can be written and its question left open, and the run passes

**Did:** `ut_proof_conclusion_015`, run `v1_2026-08-21_19-20-04`. `research.json`
`sections_modified` is `["project", "proof_summaries"]` — **no `questions` op at all.**
`ps_001` was appended at `not_proved`; `q_001` stayed `in_progress`. Two separate
`research_append` calls were made (`proof_summaries`, then `project`). The agent said so
in chat, deliberately:

> "The summary has been persisted as **ps_001**; q_001 remains open as an evidentiary gap
> (not a post-exhaustive negative finding)."

The other four runs of this same test all wrote the `questions` op. Outcome in all five:
`pass`. `base/Completeness` scored **3**, rationale "produced a complete proof summary
with narrative" — while the same dimension's rationale on the *next* log's run of the same
test explicitly credits "persisted the proof_summaries entry **and updated the question
status**." The judge notices the resolve when it happens and does not miss it when it
does not.

**Should:** agent body §5 — "**One `research_append` call, one `ops[]` batch, carrying
BOTH the summary and the question resolve**." §7 — the only licence to leave a question
open is a *gate-blocked* `not_proved`; "a `not_proved` summary written after an exhaustive
search that came back empty DOES close its question." The gate did not block here, and
the fixture (`bride-surname-illegible-cert-declared`) carries
`q_001.exhaustive_declaration.declared: true` with `status: exhaustive_declared`.

**Gap: two lanes, and the split matters.**

- **Lane 2 — nothing checks it.** No validator asserts that a run which writes a
  `proof_summaries` entry also resolves its question. `research_append` enforces the
  *converse* — per `docs/specs/schemas/ownership.json`, "a `resolved` write additionally
  requires a proof summary referencing the question" — so the tool closes
  resolved-without-summary and leaves summary-without-resolved wide open. **Converts — V2.**
- **Doctrine, handed back, not edited.** The agent overrode a *declared* exhaustiveness
  because it judged the declaration premature. That judgement is genealogically right —
  this fixture's declaration is deliberately premature, which is what test 017 exists to
  probe — and §7's closing rule forbids making it: "Do not evaluate exhaustiveness here —
  reference the existing declaration and tier accordingly." So the body tells the agent
  to trust a declaration it can see is wrong, and gives it no way to record that it
  disagreed. **Request, for the senior lane already holding the agent body (#1851): §7
  needs a third case — concluded, but the exhaustiveness declaration is not credible —
  with a stated write for it.** Right now that state is expressed by silently skipping
  the resolve, which is indistinguishable from forgetting.

---

## F3 — A raw `Grep`/`Read` of `research.json` passes, in the suite whose validator docstring names that exact defect

**Did:** `ut_proof_conclusion_002` reached `research.json` directly in **3 of its 5 runs**:

| run | call |
|---|---|
| `v1_2026-08-21_18-43-53` | `Grep {pattern: "\"q_00[12]\"", path: …/research.json}` |
| `v1_2026-08-21_19-20-04` | `Read {file_path: …/research.json, limit: 60}` |
| `v1_2026-08-21_19-34-21` | `Grep {pattern: "\"q_00[12]\"", path: …/research.json}` |

All three `pass`. `base/Tool Arguments` scored **3** on all three; its rationale
enumerates the MCP calls and never mentions the builtin ones — it cannot, because it is
looking at `tool_calls` and these live in `builtin_tool_calls`.

**Should:** agent body §1 — "**Use `research_query`, not a raw `Read` of research.json**,
to gather this," on the stated ground that a whole-file read is "the single biggest
reclaimable cost in this skill."

**Gap: lane 2, and the guard that should hold it is half-built.**
`test_research_query_called_for_coverage` says in its own docstring that it is the
"deterministic regression catch … for a future SKILL.md edit that reverts to a raw Read,"
but it asserts only that *at least one* `research_query` call exists. It never looks for
the raw read, and it is gated on the `research-query-coverage` tag, which only test 020
carries — so it `skip`s on 002 entirely, recording `passed: true`. A validator whose
docstring names a defect and whose assertion cannot see it is the shape
`docs/architecture.md` §9.4 exists to register. **Converts — V3.**

`base/Tool Arguments` is the base rubric, so per the guide I am not editing it. **Posting
the problem for the lead:** the dimension is flat at 3 across all 21 tests in every log,
and one structural reason is that it grades `tool_calls` only. Every rule about *not*
reaching for a builtin — the raw-read rule here, and the same shape in any skill with a
"use the tool, not the file" rule — is invisible to it. Proposed wording, for the lead to
accept or reject: *"Tool Arguments covers what the skill reached for as well as how it
called it. A builtin `Read`, `Grep` or `Glob` against a project document the skill has a
dedicated MCP query tool for is an argument defect, not a neutral alternative."*

---

## F4 — `tree_edit` and `tree_correct` writes are split across calls where the body requires one batch

**Did:** two instances, both in passing runs.

- `ut_proof_conclusion_002`, `v1_2026-08-21_19-34-21`: **two** `tree_edit` calls, each
  carrying a single-op `ops[]` — `add_relationship` (the ParentChild edge, 5 refs) in one,
  `add_fact` (the concluded Birth, `primary: true`, 2 refs) in the other.
- `ut_proof_conclusion_019`, `v1_2026-08-21_19-20-04`: **two** `tree_correct` calls, and
  the first does not use `ops[]` at all —
  `{operation: "update_fact", personId: "LR9N-VGQ", factId: …, fact: {primary: true}}`.

`base/Tool Arguments` scored 3 on both, and the two rationales fail in opposite
directions. On 002 it reads "tree_edit (add_relationship, add_fact)" — describing two
calls as one. On 019 it counts them correctly and still scores 3: "**The tree_correct
calls** properly updated the christening fact and marriage relationship." The dimension
saw the split and had no criterion that made it matter.

**Should:** agent body §6 — "Use `tree_edit`, **batched into ONE call via its `ops[]`
array**", on the stated ground that "batching applies every op to a single in-memory tree,
validates once, and writes once (**all-or-nothing**)". Splitting reintroduces exactly the
partial state §6 exists to prevent: on 002, the edge lands and the concluded Birth fact
can then fail validation independently, leaving a `proved` conclusion whose vital fact is
not `primary`.

**Gap: lane 2 — nothing checks call *shape*.** The universal validators check what the
tree ends up containing; none checks how many writer calls got it there. This one is
cheap and exact. **Converts — V4.**

---

## F5 — The unresolvability rule is written per-sentence and graded per-narrative, so the per-sentence half is enforced nowhere

**Did:** across the five logs, **15** sentences in persisted narratives use one of the
modals the body forbids ("cannot be established", "cannot be determined", …).
**13 of the 15 name no unsearched record type in that sentence.** Examples, all in
`pass` runs:

- `ut_proof_conclusion_017` [`19-20-04`], `not_proved` — "the maiden surname of Ellen …
  **cannot be determined**." Bolded, as the conclusion line.
- `ut_proof_conclusion_n9f` [`19-34-21`], **`probable`** — "the exact date of death cannot
  be established from the sources found."
- `ut_proof_conclusion_018` [`19-34-21`], `possible` — "An exact death date cannot be
  established from evidence gathered to date."

**Should:** agent body, Important rules — "every sentence that states so **must**, in the
same breath, name at least one specific unsearched record type that could still establish
it … A bare 'cannot be determined from the record' with no such pairing is a fail, even
when the tier … is otherwise correct."

**Gap: lane 2, and the finding is the divergence, not the prose.** In every one of the 13
cases the narrative *does* name unsearched alternatives — in a neighbouring sentence or a
dedicated section. So the genealogical harm the rule guards against (foreclosing a fact)
is not occurring, and `ut_proof_conclusion_017`, the dedicated regression test, is right
to pass. But look at *what it grades*: its `judge_context` says score 3 "if the narrative
names at least one untried alternative record type … AND frames it as an unsearched next
step," and explicitly allows "the maiden surname is not established by the evidence
gathered so far." That is a **per-narrative** rule. The body states a **per-sentence**
rule. The test grades the weaker one, so the stricter one has never been measured
anywhere, and the agent has settled on the weaker one 13 times out of 15.

I am not tightening 017 to the per-sentence rule: doing so would enforce a prose
constraint on the strength of a body I cannot edit and am not persuaded is right. "Same
breath" is prose engineering, and 017's per-narrative framing is the genealogically
defensible reading. **Handed back as a request to the senior lane (#1851): the body should
say per-narrative, matching what the one test that covers it already grades, or say why
per-sentence is worth the cost.** Meanwhile the per-narrative version *is* mechanical and
currently runs on one tagged test only. **Converts — V5.**

---

## F6 — ~~`rubric/Tree encoding` is flat because no test plants a tree defect~~ — REFUTED by the re-run

**Did:** the dimension is graded on 9 of 21 tests (`+8 N/A`) and scores 3 on all nine.
Reading the nine: `001`/`020` write a ref-carrying `ParentChild`, `016` adds the `primary`
Marriage fact on the existing `Couple` edge, `n9f` and `018` add `primary` Death facts
with the bracket in `date`, `002` writes the edge plus the concluded Birth, `019` sets
`primary` via `update_fact`. All correct, all for the right reason.

**Should:** the dimension's `fail` criterion is "concludes a parentage/marriage at
`probable`+ … but the tree carries **no** `primary`/concluded value — the conclusion
never reaches the tree." That is the found-but-lost failure, and it is the whole reason
§6 opens with "**This step — not the proof summary — is where the conclusion actually
lands. Do not skip it.**"

**CORRECTION (2026-08-25, from the re-run this PR forced).** This finding was wrong, and
wrong in its framing rather than its arithmetic. On `v1_2026-08-25_13-34-10`,
`rubric/Tree encoding` scored **1** on `ut_proof_conclusion_012` and the dimension now
reads `varies [1, 3]`. The judge's rationale is exactly the failure the dimension exists
for:

> "The skill concluded ps_001 at tier 'probable' but made **no tree writes** to encode the
> conclusion … The conclusion lives only in narrative_markdown; the tree carries no
> primary/concluded value. This is a found-but-lost result."

**A tree defect does not have to be planted in a fixture — the agent produces it
behaviourally.** 012 is the re-invocation test; it re-concluded at `probable` and wrote
nothing to the tree. Five consecutive logs had simply never sampled that behaviour, so I
read a sampling accident as a structural impossibility. The dimension discriminates; it
does not need a new fixture, and it must not be retired. **No fixture work is owed here.**
Per CLAUDE.md, a measurement that disagrees with belief is re-measured rather than
reworded — this is the re-measurement, and it went against me.

Note also that this is **F2's failure mode recurring in a second place**: a conclusion
written, its consequence not landed. There it was the question left unresolved; here it is
the tree left silent. V2 and the existing
`test_tree_relationship_written_at_probable_plus` cover the two halves mechanically, which
is the durable answer in both cases.

~~**Gap: lane 2, and it is a missing fixture, not wording.** The dimension is well written;
the suite gives it nothing to discriminate.~~ Every `probable`+ test in the suite is one
the agent gets right. `test_tree_relationship_written_at_probable_plus` already covers the
mechanical half deterministically for `tree-write-expected` tests, which is part of why
the judge dimension has no work left — so the honest options are a fixture that makes the
tree write genuinely hard (a concluded parentage where the edge must be *created* and the
only available S-entry is ambiguous; or a two-part marriage conclusion where one side is
easy to drop) or retiring the dimension in favour of the validator. **This is the one
finding I am not fixing in this PR** — authoring that fixture is a paid-run-consuming
change of its own, and it should ride a run with a hypothesis about which shape actually
discriminates rather than being bolted onto this batch. Flagged for `/fill-ready`.

---

## F7 and F8 — found by the genealogist annotation, not by this dive

The `.ann.json` for `v1_2026-08-25_13-34-10` records **zero judge-vs-human
disagreements** across 41 corrections on the review sample (005, 006, 007, 011, 018) —
the judge's scores all stood. But two of its four written comments are **findings my sweep
missed**, and both are the kind a phrase-matching scan cannot see. Credit where it is due:
these are the annotator's.

### F7 — a citation gap weighed as an evidentiary gap, setting the tier

**Did:** `ut_proof_conclusion_018` wrote, correctly, that "the 1870 federal census entry is
represented in this project only as **a tree fact carrying no sourced assertion**" — very
nearly the agent body's own prescribed wording. It then listed "**the unsourced lower
bound**" among the reasons that "together prevent a `probable` tier rating", and tiered the
conclusion `possible`.

**Should:** the agent body §4 — "A tree fact is evidence that was consulted… It is **not**
the same as the record being unsearched… because the two point at different next steps —
**one needs a citation, the other needs a search.**"

**Gap: doctrine, and my own sweep's blind spot.** The agent got the *phrasing* right and
then made precisely the *reasoning* error the rule exists to prevent: F2 was consulted and
does establish the lower bound, so its missing citation is bookkeeping, not weak evidence,
and it should not sit in the list of things holding the tier down. The genuine Component 1
gap — the unsearched 1880 census, which would halve the bracket — the narrative names
prominently and correctly, twice. So this is not a missed gap; it is a *spurious* one
added beside it, and the spurious one is doing tier work.

**This does not convert to a validator, and I want to be explicit rather than quiet about
it.** Deciding it requires knowing that F2 was consulted, that its citation is absent, and
that the narrative is treating the absence as evidentiary weight — the third is a judgement
about reasoning quality, which the guide's "what does not convert" section puts squarely
with the judge. **My scan missed it because I searched for the forbidden *phrase* and the
agent used the permitted one.** A prohibition list built from phrasings will keep missing
this class; item 25 in the list now carries a pointer here.

### F8 — `research_append` retried until accepted, rather than fixed

**Did:** `ut_proof_conclusion_007` made **four** `research_append` calls (none using
`ops[]` — the bare `{section, op, entry, verdict}` form). The annotator's comment: "it was
rejected twice because of invalid/missing fields before succeeding on the third attempt.
Since the retry policy allows only one clean recovery for full credit, partial is
appropriate." Scored `Tool Arguments` **2**, and the human agreed.

**Should:** agent body §5 — "The tool validates the whole project and writes nothing on
failure. **Surface `{ ok: false, errors }` and fix before retrying.**"

**Gap: lane 2 — nothing mechanical counts rejections.** The judge caught this one, which is
to its credit, but it caught it on a sampled test in one run; nothing makes it hold. Note
this is the *same* dimension (`base/Tool Arguments`) that F3 and F4 show failing in the
other direction — it is carrying real signal here and missing real defects there, which is
an argument for moving the countable parts out of it. **Converts — V6.**

## F9 — `rubric/Evidence completeness` grades the prose and never the structured evidence fields

**This is the third flat dimension the issue assigned me, and my first pass missed it
entirely.** The issue said of the four, "You own three" — `Proof-conclusion fit` (F1),
`Tree encoding` (F6) and `Evidence completeness`. I wrote up the first two and left this
one at a mention in the numbers table. Closing it here.

**Did:** on `v1_2026-08-25_13-34-10`, every test whose fixture carries a resolved conflict
wrote the field empty:

| test | resolved conflicts in fixture | `resolved_conflict_ids` written | Evidence completeness |
|---|---|---|---|
| `ut_proof_conclusion_001` | `["c_001"]` | `[]` | **3** |
| `ut_proof_conclusion_002` | `["c_001"]` | `[]` | **3** |
| `ut_proof_conclusion_020` | `["c_001"]` | `[]` | **3** |

In all three the narrative *does* discuss the birthplace conflict — so the prose is right
and the field contradicts it. The same shape appears in `supporting_assertion_ids`: on
`ut_proof_conclusion_002`, the **`proved`-tier** test, 9 assertions are linked to `q_001`
via `extracted_for_question_ids` and only 5 are cited (`a_005`, `a_008`, `a_009`, `a_012`
omitted, and none of those ids appears in the narrative either). Also incomplete on 019
(16 linked, 13 cited) and 015 (3 linked, 2 cited). All scored 3.

**Should:** the dimension asks "Does the proof cite all relevant assertions and address all
resolved conflicts?" Agent body §7: "`resolution_assertion_ids` are the `a_` ids the
conclusion rests on — **the same ones in the summary's `supporting_assertion_ids`**."
`research-schema-spec.md` maps `resolved_conflict_ids ──► conflicts[].id` as the audit
trail, and 001's own `judge_context` says resolved conflicts "are part of the audit trail".

**Gap: lane 2 — the dimension's pass criterion says "cited in the NEW narrative", so the
judge reads prose and is never pointed at the two fields.** This is exactly the case the
guide's Step 2 flags — `file_changes` is "where you catch a skill that *said* the right
thing and *wrote* something else." The narrative governs on disagreement per the schema
spec, so this is a metadata defect rather than a GPS one; but `resolution_assertion_ids`
mirrors `supporting_assertion_ids` onto the question, and that mirror is what a later skill
reads to learn what grounded the answer.

**One root cause is spec wording, not the agent.** `resolved_conflict_ids` is specified as
"`c_` references to conflicts **resolved in this proof** (may be empty)". proof-conclusion
is forbidden to resolve conflicts, so `[]` is a defensible literal reading — while the
canonical example in the same spec shows `["c_001"]` and the audit-trail language says the
opposite. **Settle the wording before writing the validator**, or V7 will enforce a reading
the spec does not clearly license.

**Deliberately NOT fixed by a rubric edit, on F1's measured evidence.** A set comparison
between two fields in the same file is mechanical, and F1 is this dive's own demonstration
that putting a mechanical rule in rubric prose makes the judge *cite* the rule and then
score 3 anyway. Editing `rubric.md` again would also flip the snapshot inactive and owe
another ~$6.6 run plus a genealogist annotation — real cost for a change I have just
measured to be ineffective in this exact shape. **V7 is the fix.** **Converts — V7.**

## The three `judge_context` grep hits, adjudicated

| file | verdict |
|---|---|
| `citation-copied-verbatim.json` (015) | **Left.** Every score-branch clause is a normalization or scope rule preventing a false fail — "strip footnote/endnote markers, then compare", "do NOT let the proof's tier … affect this grade". The issue names this file as the leave-it case and it is right. |
| `no-unresolvability-without-testing.json` (017) | **Left.** Its clauses are false-fail guards for a genuinely narrow rule ("EXPLICITLY ALLOWED (do NOT penalize): … 'the maiden surname is not established by the evidence gathered so far'"). The problem here is not a leak to the judge; it is F5's body-vs-test divergence, which a `judge_context` edit cannot fix. |
| `no-image-claim-without-tool-confirmation.json` (016) | **Rewritten.** See below. |

### The 016 rewrite

Clause 2 read:

> "CRITICAL for Correctness: score 1 if narrative_markdown … describes a digital image …
> as 'accessible', 'viewable', 'available', or similar … **This exact overclaim happened
> in a real prior run of this fixture** and is what proof-conclusion SKILL.md's … rule was
> added to prevent."

That is the worked antipattern the issue names: it hands the judge the finding, the exact
words to grep for, and the assurance that this fixture produces it. It now reads:

> "Correctness covers image-accessibility claims about src_001. research.json records no
> imageId/artifacts for this hit and no record_read that could have found one, so grade
> any statement about whether an image of the church-book page can be seen against what
> the project data actually records — not against what a FamilySearch record-level ARK
> usually implies."

Dimension named, ground truth kept, finding and phrase-list removed. Clause 3 — "silence
on image accessibility is correct … Only an affirmative, unsupported accessibility claim
should be penalized" — is **untouched**: it is the false-fail guard, and it is what keeps
the judge from marking down a narrative for not discussing an image.

Checked while there: no run in the corpus makes an unsupported image claim. 016's three
`digitized image` hits are all the *correct* behaviour ("No digitized image of the
underlying register page was confirmed during the search (the record_search response
carried no imageId or artifacts field)"), and 019's is inside a citation copied verbatim
from a `3:1:` image ARK in the fixture. The rule is holding; only its `judge_context` was
telling the judge so.

### Stale pointers, also fixed

Four references sent a reader to `SKILL.md` for doctrine that moved to the agent body on
2026-08-21. A judge told to check "SKILL.md §6" reads a 63-line routing stub and finds
nothing.

- `no-image-claim-without-tool-confirmation.json` → agent body, step 4
- `bounded-death-encoded-not-collapsed.json` → agent body §2/§6
- `research-query-gather-evidence.json` → agent body §1
- `rubric.md`, `Tree encoding` → agent body §6

---

## Validator requests

All seven are new; none duplicates one of the 13 in
`eval/harness/validators/test_proof_conclusion.py`. Each names the committed run it must
fire on, per issue #1788 — a validator that never runs still records `passed: true`, and
most of the 13 existing ones `skip` on any given test: in `v1_2026-08-21_19-34-21`, 9 of
13 skip on `ut_proof_conclusion_002`, 10 on `020` and **11 on `015`**, which is left with
two running checks (`test_positive_test_creates_a_proof_summary` and
`test_new_proof_summary_has_narrative`) — neither of which can see F1 or F2.

**None of the seven should be tag-gated, and each says so in its own spec text.** Tag-gating
is what let F3 through: the guard existed, and the test that violated the rule did not carry
the tag. Read the instruction in each V-section rather than trusting this line — an earlier
draft of it said "two of the five", wrong twice over, and building the validator PR off a
summary line instead of the per-validator text is precisely how F3's failure mode
reproduces.

### V1 — declared `vehicle` must describe the narrative

> **Rule:** for every new or updated `proof_summaries` entry, the `narrative_markdown`
> word count must be within its declared `vehicle`'s budget with generous tolerance:
> `statement` ≤ 250 words, `summary` ≤ 800, `argument` ≤ 1200. (The agent body's budgets
> are ~150 / 300–500 / ≤800; these thresholds sit well above them so only a
> form-vs-artifact mismatch trips, not ordinary overrun.)
> **Where to look:** `file_changes → research.json → diff.proof_summaries.added[]` and
> `.modified[].changed_fields.narrative_markdown.after`; fields `vehicle` and
> `narrative_markdown`.
> **Why it is not judgment:** both are fields already in the file; `vehicle` is a closed
> enum and the budget is stated numerically in the agent body. Whether the *form choice*
> was right stays with the judge — this only checks the label against the artifact.
> **What a violation looks like:** `ut_proof_conclusion_015`, run
> `v1_2026-08-21_19-34-21`, `ps_001` declares `vehicle: "statement"` on 523 words. Also
> `v1_2026-08-21_18-43-53` (599 words) and `v1_2026-08-21_18-10-36` (488). **Do not
> tag-gate** — 12 of the 65 narratives in the corpus violate it, spread across tests 013,
> 015, 016 and 017.

### V2 — a written conclusion must resolve its question

> **Rule:** if a run appends a new `proof_summaries` entry for `q_NNN`, then `q_NNN.status`
> must be `resolved` in the after-state — **unless** the run's summary is `tier:
> not_proved` *and* the run also reports a precondition gate block (no `tree_edit` call,
> and a `conflicts` gate failure named in `text_response`). The gate-blocked
> `not_proved` is the one licensed open question, per agent body §7.
> **Where to look:** `research.json` after-state `proof_summaries[]` and `questions[]`;
> plus `tool_calls` to distinguish the gate-blocked case.
> **Why it is not judgment:** `status` is a closed enum and the linkage is a stated
> invariant. `research_append` already enforces the converse direction (a `resolved`
> write requires a summary referencing the question, per `ownership.json`); this closes
> the other half.
> **What a violation looks like:** `ut_proof_conclusion_015`, run
> `v1_2026-08-21_19-20-04` — `ps_001` appended at `not_proved` after a *declared*
> exhaustive search, `q_001` left `in_progress`, `sections_modified: ["project",
> "proof_summaries"]`, outcome `pass`. The same test's other four runs resolve it, so
> this must not be gated on a tag or it will pass by sampling.

### V3 — no raw read of `research.json`

> **Rule:** no `builtin_tool_calls` entry may be a `Read`, `Grep` or whole-file `Glob`
> whose path resolves to the project's `research.json`. Extend
> `test_research_query_called_for_coverage` rather than adding a sibling, and **drop its
> `research-query-coverage` tag gate** so it runs on every test — the positive half (at
> least one `research_query`) is already true of every run in the corpus, so ungating it
> costs nothing and the negative half is where the signal is.
> **Where to look:** `output.builtin_tool_calls[]`, keys `tool` and `args` (`file_path`
> for `Read`, `path` for `Grep`/`Glob`).
> **Why it is not judgment:** a path either is or is not `research.json`. `tree.gedcomx.json`
> must be **excluded** — there is no `tree_query` tool, so reading the tree raw is the
> only route, and 11 of the 21 tests do it legitimately in at least one run.
> **What a violation looks like:** `ut_proof_conclusion_002` in `v1_2026-08-21_18-43-53`
> and `v1_2026-08-21_19-34-21` (`Grep` for `"q_00[12]"` on research.json) and in
> `v1_2026-08-21_19-20-04` (`Read … limit: 60`). All three `pass` today, and the existing
> validator `skip`s on this test.

### V4 — one batched call per tree writer

> **Rule:** a run makes at most **one** `tree_edit` call and at most **one**
> `tree_correct` call, and every `tree_correct` call carries an `ops[]` array rather than
> a bare top-level `operation`.
> **Where to look:** `output.tool_calls[]`, matching `tool` by substring (`tree_edit`,
> `tree_correct`) so it holds under every MCP prefix spelling; then `args.ops`.
> **Why it is not judgment:** a count and a key's presence. The rule is stated
> numerically in agent body §6 ("batched into ONE call via its `ops[]` array") and its
> reason is the all-or-nothing write.
> **What a violation looks like:** `ut_proof_conclusion_002`, run
> `v1_2026-08-21_19-34-21` — two `tree_edit` calls, one per op. And
> `ut_proof_conclusion_019`, run `v1_2026-08-21_19-20-04` — two `tree_correct` calls, the
> first with no `ops[]` at all. Both `pass`; `base/Tool Arguments` scored 3 and its
> rationale describes 002's two calls as one.
> **Do not tag-gate** — neither 002 nor 019 carries a tag that would select for this, and
> the defect is a property of any run that writes the tree.

### V5 — an unresolvability claim must be paired with a named unsearched record type

> **Rule:** if a `narrative_markdown` contains any of the modals the agent body forbids
> — "cannot be established", "cannot be determined", "cannot be inferred", "cannot be
> assumed", "cannot be assigned", "indeterminable", "unobtainable", "cannot prove or
> disprove" — then the same narrative must also name at least one **unsearched record
> type** from a closed vocabulary (census, probate, baptism/christening, birth record,
> death record/certificate, marriage record/register/licence, obituary, naturalization,
> land record/deed, will, estate, church record, parish register, tax list, city
> directory, newspaper, vital record, cemetery, pension). Measure **per narrative**, not
> per sentence — the per-sentence version is contested doctrine (F5) and this validator
> should not decide it.
> **Where to look:** the same `proof_summaries[].narrative_markdown` as V1.
> **Why it is not judgment:** two substring vocabularies over one string. Whether the
> alternative named is the *best* next search stays with the judge.
> **What a violation looks like:** none in the current corpus — all 13 unpaired sentences
> sit in narratives that name alternatives elsewhere, so this validator would pass on all
> 65 today. It is the regression catch, and it should be **named as such in its
> docstring**: it is worth having because it is the mechanical floor under a rule the one
> test that covers it grades by tag (`unresolvability-restraint`, test 017 only), and
> because a run that both foreclosed and named nothing is the failure the rule was
> written for. **Not tag-gated** — the modals appear at `probable` (`n9f`) and `possible`
> (`018`) as well as `not_proved`, i.e. on tests no such tag would ever carry.

### V6 — a writer-tool rejection must be fixed, not retried

> **Rule:** across a run, at most **one** `research_append` (or `tree_edit` / `tree_correct`)
> call may return `ok: false`. A second rejection of the same section means the agent is
> retrying until accepted rather than reading the errors and correcting the payload.
> **Where to look:** `output.tool_calls[]` — `tool` matched by substring, and the recorded
> result/`is_error` per call.
> **Why it is not judgment:** a count of failed calls. The agent body states the rule
> imperatively ("surface `{ ok: false, errors }` and fix before retrying"), and the tool
> writes nothing on failure, so a rejection is unambiguous.
> **What a violation looks like:** `ut_proof_conclusion_007`, run
> `v1_2026-08-25_13-34-10` — four `research_append` calls, rejected twice on
> invalid/missing fields before the third succeeded. Caught by the judge on this run
> (`Tool Arguments` 2, human agreed) but only because 007 was in the review sample; nothing
> makes it hold on an unsampled test or a later run. **Do not tag-gate.**
> **Credit:** surfaced by the genealogist annotation of `v1_2026-08-25_13-34-10`, not by
> this dive's sweep.

### V7 — the structured evidence fields must match what the conclusion used

> **Rule:** for a new `proof_summaries` entry answering `q_NNN`: (a) every conflict whose
> `blocks_question_ids` includes `q_NNN`, or whose `competing_assertion_ids` intersect the
> entry's cited assertions, and whose `status` is `resolved`, must appear in
> `resolved_conflict_ids`; and (b) `resolution_assertion_ids` on the question must equal
> `supporting_assertion_ids` on the summary.
> **Where to look:** after-state `proof_summaries[]`, `questions[]`, `conflicts[]`,
> `assertions[]`.
> **Why it is not judgment:** set membership over closed id references and one closed
> enum (`status`). Whether the narrative *reasons* about the conflict well stays with the
> judge; this only checks the machine-readable claim matches.
> **Settle first:** `resolved_conflict_ids` is specified as conflicts "resolved in this
> proof", which proof-conclusion may not do — so part (a) needs the spec wording fixed
> before it can be enforced. Part (b) is unambiguous today and can ship alone.
> **What a violation looks like:** part (a) — `ut_proof_conclusion_001`, `002` and `020` on
> `v1_2026-08-25_13-34-10`, all three writing `[]` while `c_001` is `resolved` and
> discussed in the narrative, all three scoring Evidence completeness 3. Part (b) —
> `ut_proof_conclusion_002` on the same run: 9 assertions linked to `q_001`, 5 cited.
> **Do not tag-gate.**

---

## Fixes made in this PR

Grading only — `judge_context` and `rubric.md`, per the issue. The agent body and
`SKILL.md` are untouched.

| file | change |
|---|---|
| `eval/tests/unit/proof-conclusion/rubric.md` | `Proof-conclusion fit`: added the declared-form-vs-artifact criterion with the three budgets and a fence against over-correcting on length (F1). Stale `SKILL.md §6` → agent body §6. |
| `.../no-image-claim-without-tool-confirmation.json` | `judge_context[1]` rewritten to name the dimension without the finding or the phrase list; `description` pointer → agent body. Clause 3's false-fail guard left intact. |
| `.../bounded-death-encoded-not-collapsed.json` | Stale `SKILL.md §2/§6` pointer → agent body. |
| `.../research-query-gather-evidence.json` | Stale `SKILL.md §1` pointer → agent body. |

**Only two of those four edits force the re-run.**
`harness/snapshot.py` strips `_COSMETIC_TEST_FIELDS = ("name", "description", "tags")`
before hashing a test file, so a `description`-only repoint is cosmetic by design. Run
against this branch, `check_runlogs.py` names exactly three drifted snapshot files:

    eval/tests/unit/proof-conclusion/no-image-claim-without-tool-confirmation.json
    eval/tests/unit/proof-conclusion/rubric.md
    packages/engine/plugin/agents/proof-conclusion.md

**The third is not mine.** It is PR #1832's 2026-08-23 agent-body edit — hard confirmation
that the snapshot was already inactive on `main` before this branch, and that these
findings ride a run that was owed regardless. Last full run: `$5.64`, ~41 min
(`v1_2026-08-21_19-34-21.json`, `totals`).

**The judge prompt has also changed since that run** — `check_runlogs` warns that the log
was scored under hash `a7c9bd99…` while the current prompt hashes `c39d7003…`. This does
not touch F1–F5, which are read from `file_changes`, `tool_calls` and
`builtin_tool_calls` rather than from scores: the narratives really are over budget, the
question really was left open, the raw `Grep` really happened. It does qualify two
*score-derived* claims. "4 of 8 flat" and "scored 3 on all 65" are statements about a
judge prompt that no longer exists, so the fresh run is also the first honest measurement
of whether `Proof-conclusion fit` and `Tool Arguments` are still flat under the current
prompt — read the new judge-report before concluding that F1's rubric edit is what moved
the dimension.

## Handed back, not fixed here

- **The agent body's §7 has no third case** for "concluded, but the exhaustiveness
  declaration is not credible" (F2). Senior lane, #1851.
- **The unresolvability rule should say per-narrative or justify per-sentence** (F5).
  Senior lane, #1851.
- **F7 — a citation gap weighed as evidentiary weight, setting the tier.** Doctrine; does
  not convert to a validator (deciding it needs a judgement about whether the narrative is
  treating the absence as evidence). Senior lane, #1851, alongside F2 and F5. The agent got
  the prescribed *phrasing* right and made the *reasoning* error the rule exists to prevent,
  so a body edit here has to target the weighing, not the wording.
- **`base/Tool Arguments` grades `tool_calls` only** and is structurally blind to a
  builtin reached for in place of an MCP tool (F3). Base rubric — lead's call, proposed
  wording above.
- ~~`rubric/Tree encoding` needs a fixture that can fail it, or retirement~~ (F6) —
  **withdrawn, refuted by the re-run.** It scored 1 on `ut_proof_conclusion_012`, so it
  discriminates and no fixture work is owed.
