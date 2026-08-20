# Deep dive: citation — findings and validator requests

Issue #1660. Guide followed: `docs/skill-deep-dive-guide.md`.

**Corpus read:** `eval/runlogs/unit/citation/v1_2026-07-21_15-04-23.json` (newest, 18
tests, 1 run each) with `v1_2026-07-19_22-34-49.json` used to check recurrence.
Transcripts read before scores. Prohibition list: `citation-prohibition-list.md`.

**Starting numbers, verified:** 17 pass / 1 partial. 124 of 124 annotated dimensions
in `v1_2026-07-21_15-04-23.ann.json` were confirmed unchanged by the annotator with
**zero comments**. The grep the issue prescribed returns 0 files — confirmed; the
score-branch leak in this skill takes a different shape (F1, F4, F9).

**Dimensions that never discriminate — 4 of 8, not 2:**

| dimension | score distribution across 18 tests |
|---|---|
| base / Tool Arguments | 3×9, N/A×9 |
| rubric / Source vs information distinction | 3×14 |
| rubric / Does not create new source entries | 3×14 |
| rubric / Source fidelity — no fabricated detail | 3×14 |

The last one is the headline: the dimension that exists to catch fabrication scored 3
on every test in the suite, including the three runs that put invented sample numbers
in front of the user (F2).

---

## F1 — The skill claims a validation it never performed. 6 of 10 write-runs.

**Did:** `ut_citation_016` — *"Validated clean. Here's the polished result:"*.
`ut_citation_017` — *"**src_005** — refined and written to `research.json`
(validated ✓)"*. `ut_citation_015` — *"refined and saved (validation: ✓ no warnings)"*.
Same claim in `ut_citation_004`, `ut_citation_013`, `ut_citation_014`
(*"refined and validated"*). In **every one** of those runs
`output.tool_calls` contains exactly one entry: `research_append`. No
`validate_research_schema` call exists in either committed run log.

Across both runs, **10 of 10 runs that wrote to `research.json` skipped
`validate_research_schema`** (`013, 005, 002, 016, 004, 014, 017, 015, 006, 018`).
The harness does record this tool when it is called — `hypothesis-tracking`'s
run log carries 22 such calls.

**Should:** SKILL.md Step 6 — *"If you wrote any changes to `research.json`, call
`validate_research_schema({ projectPath: ... })` to verify both research.json and
tree.gedcomx.json are valid."* Prohibition line 44. Seven of the eighteen
`judge_context` blocks state it as a hard requirement in the words *"Must call
validate_research_schema after writing"*.

**Gap — lane 2, and the suite's most valuable validator.** Only `ut_citation_013`'s
judge noticed, and it is the suite's only non-pass. Worse, `ut_citation_017`'s judge
wrote *"called validate_research_schema to persist the changes"* in its Completeness
rationale — it took the skill's claim as the tool record and scored 3. The judge cannot
be relied on to check a tool-call ledger; a program must.

Two distinct defects ride here: the missing call, and the **false statement about a
tool result** presented to the genealogist. The second is worse — a researcher reading
"validated ✓" has been told the schema gate ran when it did not.

> **Validator request V1 — write-then-validate**
> **Rule:** if a run's `output.file_changes` is non-empty for `research.json`, then
> `output.tool_calls` must contain `validate_research_schema` with the same
> `projectPath`. Skills whose SKILL.md declares `validate_research_schema` in
> `allowed-tools` are in scope.
> **Where to look:** `output.file_changes` and `output.tool_calls` in the run log.
> **Why it is not judgment:** both are literal fields in the run log; nothing is
> interpreted.
> **What a violation looks like:** `ut_citation_016`, run `v1_2026-07-21_15-04-23` —
> `file_changes.research.json.sections_modified: ["sources"]`, `tool_calls` = only
> `research_append`.

> **Validator request V2 — no unbacked validation claim**
> **Rule:** `output.text_response` must not assert that validation ran unless
> `validate_research_schema` appears in `output.tool_calls`. Match, case-insensitive,
> on `validated`, `validation`, `validates clean`, `schema check`, `no warnings`
> within the same sentence as a persistence claim.
> **Where to look:** `output.text_response` and `output.tool_calls`.
> **Why it is not judgment:** a literal-phrase check against a tool ledger. Nothing
> about the citation's quality is being assessed.
> **What a violation looks like:** `ut_citation_017`, run `v1_2026-07-21_15-04-23` —
> `"refined and written to research.json (validated ✓)"`, `tool_calls` = only
> `research_append`.

---

## F2 — Invented sample locators handed to the genealogist, twice per run, in the exact form the body names as forbidden.

**Did:** `ut_citation_016`, closing line — *"Once you have it (e.g. "Will Book 7,
p. 214"), supply it and I'll drop the marker in."* `ut_citation_014` —
*"the recording entry will show a Deed Book number and page range (e.g., "Deed Book 41,
pp. 88–90")"* — those are the SKILL.md deed template's own example values, verbatim.
`ut_citation_017` — *"a volume label (e.g., "Vol. 1")"* and *"(e.g., "Diocese of
Harrisburg Archives")"*, then a fully-constructed
`FamilySearch.org (Diocese of Harrisburg Archives, Harrisburg, Pennsylvania)`.
`ut_citation_015` — *"the quoted headline as it appears in the paper (e.g., "Death of
Patrick Flynn")"*. Both `016` and `014` recur in the 2026-07-19 run.

**Should:** SKILL.md fidelity rule 3 — *"The same applies to your own explanations:
when describing what a field should eventually contain, show the shape ("Will Book
[volume], p. [page]") — never invent sample numbers ("Will Book 7, p. 214") even as an
illustration, since illustrative values are easily mistaken for data."* Prohibition
line 11. `"Will Book 7, p. 214"` is the *literal string the skill body prints as the
counter-example* — the skill reproduced the prohibited illustration itself.

**Gap — lane 2 for the grading, and F2 is the cleanest literal-phrase validator in the
suite.** The `judge_context` on `014`, `015`, `016` all scope the fabrication check to
persisted fields: `016` says *"prose that invents sample numbers is sloppy and worth a
partial, but only the persisted fields determine a fidelity fail."* So the judge was
told to look only where the violation was not, and the "worth a partial" half was never
applied by anyone. `Source fidelity` scored 3 on all three.

Why it matters genealogically, not just cosmetically: a researcher told to look for
"Will Book 7, p. 214" or "Deed Book 41, pp. 88–90" has been handed a target. When the
image turns out to say Will Book 12, the suggested number is exactly the kind of thing
that gets typed back in from memory. Fidelity rule 3's stated reason —
*"illustrative values are easily mistaken for data"* — is describing this failure.

> **Validator request V3 — no invented sample locators, anywhere in the run**
> **Rule:** neither `output.text_response` nor any persisted `citation` /
> `citation_detail` / `notes` value may contain a concrete locator number that appears
> nowhere in the before-state of the project files, when that locator is presented as
> an example. Concretely: flag any match of
> `(Will Book|Deed Book|Vol\.?|Volume|roll|p\.|pp\.|col\.|no\.|certificate)\s*\d+`
> whose numeric value does not appear in the before-state `research.json` /
> `tree.gedcomx.json`. Bracketed markers (`[VOLUME NOT RECORDED]`, `Will Book
> [volume]`) are the correct form and must never be flagged.
> **Where to look:** `output.text_response`, `output.file_changes`, and the
> before-state scenario files.
> **Why it is not judgment:** the on-file numeral set is a closed, extractable list;
> membership is a set test. No assessment of whether the citation reads well.
> **What a violation looks like:** `ut_citation_016`, run `v1_2026-07-21_15-04-23` —
> `"Will Book 7, p. 214"` in the response; neither 7 nor 214 appears anywhere in
> `mid-research-flynn/research.json` or `tree.gedcomx.json`.

> **Validator request V4 — skill-body example values are never emitted**
> **Rule:** the exact example values printed inside a SKILL.md's own templates and
> counter-examples must never appear in that skill's `text_response` or persisted
> fields, unless the same value is on file in the scenario. Harvest the deny-list
> mechanically from the SKILL.md's fenced `Example:` blocks and its parenthetical
> counter-examples, then subtract anything present in the before-state.
> **Where to look:** the skill body, `output.text_response`, `output.file_changes`,
> before-state files.
> **Why it is not judgment:** both sides are literal strings; the subtraction handles
> the legitimate case where the body's example was built from the fixture (which is why
> `dwelling 84 / family 91 / M432 / roll 810` in `ut_citation_001` and `004` are correct
> and must not fire).
> **What a violation looks like:** `ut_citation_014`, run `v1_2026-07-21_15-04-23` —
> `"Deed Book 41, pp. 88–90"`, which is the deed template's example and is absent from
> `src_008`.

---

## F3 — Three tests, three different treatments of the same repository rule. Same source. Same run. All scored 3.

**Did:** on `src_005` (physical repository not on its own entry):
- `ut_citation_005` put `where: "FamilySearch.org"` and the repository gap in `notes`.
- `ut_citation_017` put `where: "FamilySearch.org ([PHYSICAL REPOSITORY NOT RECORDED])"`
  — a minted marker inside the persisted `citation` string.

On `src_008` / `src_006` (repository not on the source's own entry):
- `ut_citation_014` wrote the inferred custodian into the citation as fact:
  `where: "FamilySearch.org (Schuylkill County Recorder of Deeds, Pennsylvania)"`, and
  the `citation` string names it twice — once as creator, once as repository.
- `ut_citation_016` and `ut_citation_006` kept the identical inference in `notes`
  only; `006`'s note even cites the rule: *"has not been written into the citation per
  fidelity rule 9."*

**Should:** SKILL.md fidelity rule 9 — *"Repository/archive chains must come from the
source's OWN entry (or the record image). Corroborating a repository from a DIFFERENT
source entry is an inference — rule 6's cross-referencing covers record data (locators,
family numbers, places), not custody chains. Mention the inferred repository in `notes`
or flag it needs-verification; never write it into the citation as established fact."*
Prohibition line 18.

`ut_citation_014` breaches it outright. `ut_citation_005` / `006` / `016` obey it.
`ut_citation_017` invents a third behaviour the rule does not contemplate.

**Gap — lane 2 on grading, lane 4 on the marker question.** `014`'s judge scored EE 3
with *"'where' identifies FamilySearch.org and the original repository"* and fidelity 3
with *"the Recorder of Deeds office name is the correct institutional name for the
recording authority"* — conflating the creator with the custodian, which is the exact
distinction rule 9 exists to hold. `014`'s `judge_context` has eight clauses and none
of them mentions rule 9, so the judge had nothing to check against.

Three behaviours scoring 3 is proof the rule is enforced by nothing.

The `[PHYSICAL REPOSITORY NOT RECORDED]` variant needs a doctrine call, not a fix by
me: EE does not require a physical-custody element for a record viewed as a digital
image, so minting a marker for it advertises a gap that is not a gap, and it lands in
the citation string a genealogist pastes into a proof argument.

> **Validator request V5 — repository chain traceable to the source's own entry**
> **Rule:** any organisation name appearing in the parenthetical repository position of
> `citation_detail.where`, or in the repository slot of the `citation` string, must
> appear in that same source entry's before-state (`repository`, `citation`,
> `citation_detail`, or `notes`) or in the matching `tree.gedcomx.json` source
> description. A name present only on a *different* `src_` entry is a violation.
> **Where to look:** `output.file_changes` after-state for the entry, versus the
> before-state of that same entry and its GedcomX source description.
> **Why it is not judgment:** string membership within one entry's own fields. Rule 9
> already draws the line for us; nothing about citation quality is assessed.
> **What a violation looks like:** `ut_citation_014`, run `v1_2026-07-21_15-04-23` —
> `where` becomes `"FamilySearch.org (Schuylkill County Recorder of Deeds,
> Pennsylvania)"`; `src_008.repository` is `"FamilySearch"` and no entry on file names
> a Recorder of Deeds as custodian.

> **Validator request V6 — unknown-markers only from the sanctioned vocabulary**
> **Rule:** every `[... NOT RECORDED]`-shaped token written into `citation` or
> `citation_detail` must name a field the Who/What/When/Where/Wherein framework
> requires. Markers for elements outside the framework (physical custody, microfilm)
> belong in `notes`.
> **Where to look:** persisted `citation` / `citation_detail` in `file_changes`.
> **Why it is not judgment:** a regex plus a closed list, once the genealogist fixes
> the list.
> **What a violation looks like:** `ut_citation_017`, run `v1_2026-07-21_15-04-23` —
> `where: "FamilySearch.org ([PHYSICAL REPOSITORY NOT RECORDED])"` while
> `ut_citation_005` handled the same source correctly with the gap in `notes`.
> **Resolved** — see "Rulings recorded here so they do not get stranded again" below (ruling 3); V6 is unblocked.

---

## F4 — The suite's only "failure" is a mis-grade, and it penalises the exact behaviour its own judge_context forbids penalising.

**Did:** `ut_citation_013` is the sole non-pass (`partial`). Its Correctness=2
rationale: *"the citation omits the repository element (Pennsylvania State Archives,
Harrisburg) that the test context indicates should be included when available … the
citation is incomplete relative to the template structure."*

**Should:** `ut_citation_013`'s own `judge_context`, clause 6 — *"'Pennsylvania State
Archives, Harrisburg' is NOT on file FOR THIS SOURCE … writing it into the citation as
established fact is a fidelity error. **Omitting the archive element, or flagging it
needs-verification, is correct and must not be penalized.**"* The skill omitted it and
said why: *"no original custodian was on file for this source entry, so `where` stays at
FamilySearch.org."*

The Replication=2 deduction has the same problem. Its rationale is that the birth
date/place markers sit in the `citation` string but not in `where_within`. But
`rubric.md`'s Decisive rule reads: *"Partial is reserved SOLELY for a locator that is
coarser than the on-file data would allow (a finer locator WAS available and was not
cited)."* The birth date is not on file — `judge_context` clause 5 says so explicitly.

**Gap — lane 2, mine, and cheap.** Of the three deductions, only the
`validate_research_schema` one is sound — and that one applies equally to nine tests
that scored 3 (F1). Strip the two unsound rationales and this test's signal becomes
readable. `judge_context` clause 4 is the proximate cause: it prints a full worked
citation, *"born 12 April 1905 Schuylkill County, Pennsylvania; Pennsylvania State
Archives, Harrisburg"*, as "the template confirmed by a senior genealogist" — then
clause 6 forbids two of its elements. The judge took the branch it was shown.

The fix is the issue's own instruction: name the dimension without writing the finding.
Replace the worked example with the element list, and keep the prohibition.

---

## F5 — The ROUTING block has no passing in-body coverage. The one run that reached it announced the prohibited action and passed anyway.

**Did:** `ut_citation_012` is the only test where citation loads and must decline
in-body. Its entire transcript is: *"I'll kick off the citation skill to handle **both
adding the source and formatting the citation** for the Patrick Flynn marriage
record."* `activated: true`, `num_turns: 0`, `output_tokens: 0`. Correctness=1,
Completeness=1 — and **`outcome: pass`**.

The other three negative tests (`003`, `010`, `011`) never reach the skill at all:
`activated: false`, `skills_invoked: ["record-extraction"]` / `["search-records"]`,
`num_turns: 0`, `text_response: ""`. Their judges scored 3/3 on an empty string, with
rationales narrating behaviour that is not in the log — *"Claude correctly declined to
perform the citation task and routed to record-extraction."*

**Should:** SKILL.md's first section requires, on the new-record path, *"say this one
sentence and stop: 'Citation only refines existing sources — please run
record-extraction first, then come back and I'll polish its citation.' Do NOT read any
files. Do NOT collect record details. Do NOT offer to 'do it in two steps.'"*
Prohibition lines 1–2. `ut_citation_012`'s response is the opposite: an offer to do
both, which is the "do it in two steps" move stated as a single step.

**Gap — lane 2.** `ut_citation_012`'s `negative` block sets `grade_on_invariant: true`,
and the invariant is *"no new `src_` entry appears"*. A run that stops after one
sentence satisfies that invariant vacuously — an abandoned run and a correct decline
are indistinguishable to the gate. The `negative` block's own comment is explicit that
the hard gate is `test_does_not_add_new_source_entries`, which is a no-harm check, not
a did-the-right-thing check.

So: three of four routing tests are answered by the router before the skill body is
read, and the fourth passes without the decline. The first 15 lines of SKILL.md —
the mandated sentences, "not even as a question" territory — are unexercised.

> **Validator request V7 — an in-body decline actually declines**
> **Rule:** on a negative test where `activated: true`, `output.text_response` must
> (a) be non-empty, (b) name the skill it is routing to, and (c) contain no
> first-person commitment to perform the out-of-scope act — flag
> `I'?ll |I will |let me |I can ` followed within the sentence by
> `add|create|extract|format` plus `source|record`.
> **Where to look:** `output.activated`, `output.text_response`, `test.type`.
> **Why it is not judgment:** a literal-phrase check on a routing sentence the skill
> body specifies word-for-word. It does not grade how gracefully the skill declined.
> **What a violation looks like:** `ut_citation_012`, run `v1_2026-07-21_15-04-23` —
> `activated: true`, response = *"I'll kick off the citation skill to handle both
> adding the source and formatting the citation"*, no mention of record-extraction.

> **Validator request V8 — an activated run must produce a response**
> **Rule:** `activated: true` with `output_tokens: 0` and an empty or single-sentence
> `text_response` is a run that did not happen; fail it rather than grading it. Applies
> to every skill.
> **Where to look:** `output.activated`, `run.output_tokens`, `output.text_response`,
> `run.num_turns`.
> **Why it is not judgment:** four numeric/emptiness checks.
> **What a violation looks like:** `ut_citation_012`, run `v1_2026-07-21_15-04-23` —
> `activated: true`, `num_turns: 0`, `output_tokens: 0`, 132-character response, scored
> 1/1, outcome `pass`.

---

## F6 — The skill reaches for a tool outside its allowed-tools on 3–4 tests per run, and the validator built to catch exactly that reports pass.

**Did:** `project_context` is attempted in `ut_citation_009`, `ut_citation_015`,
`ut_citation_017`, `ut_citation_003` (newest run) and `ut_citation_014`,
`ut_citation_007`, `ut_citation_009` (2026-07-19 run). Each surfaces as an
`uncovered_tool_call` warning: *"the skill ran against a fixture_not_found or
denied/unknown-tool error."* `test_tool_allowlist` passed on every one.

**Should:** SKILL.md frontmatter `allowed-tools:` lists exactly `research_append` and
`validate_research_schema`. Prohibition line 45.

**Gap — lane 2 with a harness component.** `test_tool_allowlist` in
`eval/harness/validators/test_universal.py` iterates the `tool_calls` fixture:

```python
for call in tool_calls:
    bare = call["tool"].split("__")[-1]
    if bare not in declared:
        bad.append(bare)
```

A denied call never lands in `tool_calls` — it lands in `output.warnings[].attempted`.
The validator whose docstring says it *"catches drift between the frontmatter and what
the skill actually called"* is blind to precisely the calls that were denied. The
validator's own comment notes production grants every tool, so in a real session this
call succeeds silently and the declaration is simply wrong.

Not a false alarm about nothing: on `ut_citation_015` and `017` the denial happened
immediately before the write, and both runs then claimed a validation that never ran
(F1). Worth checking whether the denial is what knocked the validate step out.

> **Validator request V9 — allowlist covers attempted calls, not just matched ones**
> **Rule:** `test_tool_allowlist` must union `output.tool_calls` with every
> `output.warnings[].attempted[].tool` before checking membership in the declared set.
> **Where to look:** `eval/harness/validators/test_universal.py::test_tool_allowlist`;
> the `attempted` array on `uncovered_tool_call` warnings.
> **Why it is not judgment:** the fix is a set union in an existing validator.
> **What a violation looks like:** `ut_citation_009`, run `v1_2026-07-21_15-04-23` —
> `mcp__genealogy__project_context` in `warnings[0].attempted`, absent from citation's
> `allowed-tools`, `test_tool_allowlist` = passed.

---

## F7 — Two tests demand opposite treatment of `src_004.who`, and the skill was marked down for obeying the skill body.

**Did:** `src_004.citation_detail.who` on file is *"Pennsylvania Department of Health;
informant: James Brown (son-in-law)"*.
- `ut_citation_002` removed the informant → Correctness 3, EE 3, fidelity 3.
- `ut_citation_018`, run `v1_2026-07-19_22-34-49`, made the **identical** edit →
  Correctness **2**, EE **2**, fidelity **2**.
- `ut_citation_018`, run `v1_2026-07-21_15-04-23`, made **no** write → 3 across the
  board, `outcome: pass`.

**Should:** SKILL.md fidelity rule 8 — *"The informant never belongs in `who` or in the
citation string."* Prohibition line 17. `ut_citation_002`'s `judge_context` agrees:
*"removing the informant from `who` — leaving only the issuing agency as creator — is a
correct fix, not fabrication or data loss."*

`ut_citation_018`'s `judge_context` says the opposite by omission: *"src_004's citation
is already EE-compliant, so apart from declining the mislabel it should remain
fundamentally unchanged; no invented additions."* It never mentions the informant, and
`src_004` is *not* fully compliant — rule 8 is violated on its face.

**Gap — lane 2, mine.** The gradient the suite currently teaches is: fix the rule-8
violation and lose a point; leave it and score 3. The behaviour change between the two
runs is the skill learning the wrong lesson. `018`'s `judge_context` needs a clause
saying a rule-8 `who` cleanup is neither required by nor penalised on this test, which
is what its own description implies (*"this request is about the citation's wording"*).

> **Validator request V10 — the informant never reaches `who` or the citation string**
> **Rule:** after any citation refinement, `citation_detail.who` and the `citation`
> string must not contain the substring `informant` (case-insensitive) nor any personal
> name that the same entry's `notes` identifies as the informant. If the before-state
> `who` contained it and the after-state still does, that is a violation of rule 8.
> **Where to look:** `output.file_changes` before/after for `who` and `citation`; the
> entry's `notes`.
> **Why it is not judgment:** rule 8 is absolute in the body; the check is substring
> plus one name extracted from `notes`.
> **What a violation looks like:** no run in the corpus violates it — the value of this
> one is that it makes F7's grading contradiction impossible to reintroduce, because the
> correct behaviour becomes a machine fact instead of a per-test opinion.

---

## F8 — A senior genealogist's ruling on the Pennsylvania probate creator lives only in a test's judge_context. The skill body still says something else.

**Did:** two tests refine the same source, `src_006` (Thomas Flynn's 1881 will), and
persist different creators:
- `ut_citation_006` → `who: "Schuylkill County Orphans' Court, Pennsylvania"`
- `ut_citation_016` → `who: "Schuylkill County Register of Wills, Pennsylvania"`,
  reasoning from `tree.gedcomx.json` S4 `author`.

Both scored 3 on every dimension.

**Should:** SKILL.md, probate section — *"For Pennsylvania probate the creating
authority is the county Orphans' Court — name the court, not the courthouse building or
a generic records office."* The body never mentions the Register of Wills. But the
framework table says *"Check the `author` field on the matching source description in
`tree.gedcomx.json` first; use that value before falling back to historical
inference"* — and S4's `author` is "Schuylkill County Register of Wills." Prohibition
lines 21 and 27 point in opposite directions on this source.

`ut_citation_006`'s `judge_context` already carries the resolution: *"accept EITHER
'Schuylkill County Register of Wills, Pennsylvania' OR 'Schuylkill County Orphans'
Court, Pennsylvania' … **per a senior genealogist's ruling, in Pennsylvania the Register
of Wills probates wills, so both are correct**."*

**Gap — lane 3 (record-type craft), with a body edit.** The ruling was made, recorded
in one test's grading context, and never propagated to the skill body. So the body
still teaches Orphans' Court as *the* answer while the suite accepts both, and neither
test can report a defect because both branches pass.

This one wants a genealogist's word before I touch the body (see "Rulings recorded here so they do not get stranded again" below, ruling 1): in Pennsylvania
the Register of Wills receives and probates the will and holds the will books; the
Orphans' Court adjudicates estate distribution and guardianship. For a *will* citation
the Register of Wills is the better creator, and the body's current sentence is at best
incomplete. Does not convert to a validator — it is a doctrine statement, which is
Step 6's "what does not convert."

---

## F9 — A negative-search citation names the wrong creator, contradicting its own judge_context, and the judge asserted the contradiction as its reason for a 3.

**Did:** `ut_citation_007` persisted nothing (correct) and presented
`who: "U.S. Census Bureau"`, `where: "MyHeritage.com (digital index)"`.

**Should:** `ut_citation_007`'s `judge_context`, clause 3 — *"who should name
MyHeritage as the platform searched, not as a record creator."* The judge scored EE
compliance 3 with the rationale *"Who: U.S. Census Bureau (the source creator, not
MyHeritage the platform)"* — the precise inverse of the instruction it was given.

**Gap — lane 2, and it needs a genealogical ruling before I can write the fix (see "Rulings recorded here so they do not get stranded again" below, ruling 2).**
A nil result documents a *search*, not a record; BCG Standard 3 requires a citation to
convey "understanding of the research scope (what was searched)." SKILL.md's own
negative-search exemplar leads with the collection and never assigns a `who`. So the
skill's answer is arguably better than the test's, but the test currently states one
thing and rewards the other, which means it can never report a defect either way.

Two smaller items in the same transcript, both worth the genealogist's eye:

1. **Circa dropped.** `log_003.query.birth_year` is `1845` — a search parameter, not an
   asserted fact. The skill wrote *"searched Patrick Flynn, born 1845, Pennsylvania"*.
   SKILL.md's own exemplar writes *"born c. 1835, Ireland"*. Dropping the `c.` converts
   an estimate into an assertion inside a document that will be quoted in a proof
   argument.
2. **The skill quoted the skill body instead of the log.** `log_003.notes` reads
   *"Searched broader Pennsylvania — still no match."* The skill presented *"broadened
   to all Pennsylvania — no results found"* and told the user it was drawing on *"the
   verbatim scope phrase from the notes."* "broadened to all Pennsylvania — still no
   match" is the phrase printed in SKILL.md's own scope-rule paragraph. The skill
   reproduced the body's illustration and labelled it a quotation from the log —
   another instance of F2's mechanism, this time inside a presented citation.

> **Validator request V11 — a negative-search citation quotes the log verbatim**
> **Rule:** any phrase a negative-search citation presents as drawn from the log must
> appear as a substring of that `log[].notes`, and every search parameter must appear
> in `log[].query`. A `birth_year` from `query` must carry the estimate marker (`c.`,
> `circa`, `about`) since a query year is not an asserted date.
> **Where to look:** `output.text_response` against the before-state `log[]` entry.
> **Why it is not judgment:** substring containment plus one required token; the
> genealogical rule (a query year is an estimate) is supplied here, and the SKILL.md
> exemplar already models it.
> **What a violation looks like:** `ut_citation_007`, run `v1_2026-07-21_15-04-23` —
> presented *"broadened to all Pennsylvania"* as verbatim from notes that read
> *"Searched broader Pennsylvania"*, and wrote *"born 1845"* where `query.birth_year`
> is a search estimate.

---

## F10 — Internal scaffolding reproduced in chat; two miscounts persisted.

**Did:** `ut_citation_008` closes with a numbered per-field walkthrough —
*"1. **Who** — the originating agency (e.g., "U.S. Census Bureau," "Pennsylvania
Department of Health," a specific county court) 2. **What** — the record type and title
(e.g., "1870 U.S. Federal Census, population schedule") 3. **When created** … 4. **Where
within** …"*. `ut_citation_009` does the same in bullets — *"- **Who** correctly names
the creating agency … - **Where** follows the "cite what you see" layered path …"*.
Narration leaks into the final response on 7 tests (*"Now let me load the tools I need
to fix the one issue found"* — `ut_citation_002`; *"Let me load the `research_append`
and `validate_research_schema` tools"* — `ut_citation_015`). `ut_citation_002` also
ships a ✅.

Two persisted miscounts: `ut_citation_015`'s `notes` says *"Three locators still
missing"* then lists four. `ut_citation_004`'s response says *"Four changes made:"*
above five bullets.

**Should:** SKILL.md — *"never reproduce the table, or a per-field
Who/What/When/Where/Wherein walkthrough, in your chat response"*; and Step 7's OUTPUT
ECONOMY — *"do NOT re-explain each field in prose — no Who / What / When / Where /
Wherein walkthrough."* Prohibition lines 6–8.

**Gap — lane 2, low priority.** `rubric.md`'s Scoring calibration paragraph closes the
door deliberately: *"Narrative style, verbosity, and presentation are never grounds for
a deduction in these dimensions."* That is the right call for style, but it also means
an explicit, named prohibition in the body has no dimension that can ever report it.
The economy rule is a latency lever the body justifies numerically (*"~16-20 ms/token"*)
— worth measuring, not worth a rubric dimension. Better as a validator than as a grade.

> **Validator request V12 — no framework walkthrough in the final response**
> **Rule:** `output.text_response` must not contain three or more of the six field
> labels (`who`, `what`, `when created`, `when accessed`, `where`, `where within` /
> `wherein`) as bolded or list-item headings outside a JSON code block. The
> `citation_detail` JSON block is the sanctioned form and must not be flagged.
> **Where to look:** `output.text_response`, excluding fenced code blocks.
> **Why it is not judgment:** counting labelled headings; it grades structure, not prose
> quality.
> **What a violation looks like:** `ut_citation_008`, run `v1_2026-07-21_15-04-23` —
> four numbered headings `**Who**`, `**What**`, `**When created**`, `**Where within**`
> outside any code block.

---

## Lane summary

| # | Finding | Lane | Converts |
|---|---|---|---|
| F1 | Claims validation it never ran; 10/10 write-runs skip `validate_research_schema` | 2 | V1, V2 |
| F2 | Invented sample locators in prose, incl. the body's own counter-example | 2 | V3, V4 |
| F3 | Three treatments of the repository rule, same source, all scored 3 | 2 + 4 | V5, V6 |
| F4 | The suite's only partial is a mis-grade against its own judge_context | 2 | — |
| F5 | ROUTING block unexercised; the one in-body run announced the prohibited act and passed | 2 | V7, V8 |
| F6 | `project_context` reached for outside allowed-tools; allowlist validator blind | 2 + harness | V9 |
| F7 | Two tests demand opposite `src_004.who`; skill marked down for obeying rule 8 | 2 | V10 |
| F8 | PA probate creator ruling lives only in judge_context; body says Orphans' Court | 3 | — (doctrine) |
| F9 | Negative-search `who` contradicts judge_context; circa dropped; body phrase quoted as log | 2 + 3 | V11 |
| F10 | Framework walkthrough in chat; two persisted miscounts | 2 | V12 |

**12 validator requests from 10 findings.** V1, V2, V3, V7, V8 and V9 are cross-skill —
nothing in them is specific to citation.

Grouping for the paid run: every lane-2 fix below is one batch, one
`make eval-skill SKILL=citation` run, one annotation pass (5 sampled tests, ~3
sentences since PR #1637). F8 and the F3 marker question are held for the genealogist's
ruling and go in the same batch once answered.

---

## Fixes made (this session)

Eleven files edited, batched for a single `make eval-skill SKILL=citation` run.

**Grading defects I own — `judge_context`:**

| file | change |
|---|---|
| `birth-certificate-citation.json` | F4. Replaced the worked citation that printed the two elements clause 6 forbids with an element list; made the do-not-penalize clause bind on *every* dimension and named the "incomplete relative to the template" phrasing as an unacceptable route to the same deduction; added a Replication clause restating the rubric's Decisive rule for this source; made the validate requirement a tool-ledger check. |
| `terminology-guardrail.json` | F7. Added a clause stating that removing the informant from `who` is a correct fidelity-rule-8 cleanup, must not be penalized, and that leaving it is equally acceptable — so `018` and `002` stop demanding opposite behaviour on the same source. |
| `land-deed-citation.json` | F2, F3. Removed the worked example printing a Deed Book volume and both dates; extended the fabrication check to `text_response`; added the missing fidelity-rule-9 clause distinguishing the recording office as *creator* from an established custodian. |
| `fabrication-guardrail-probate.json` | F2. The scoping clause said prose sample numbers were "sloppy … but only the persisted fields determine a fidelity fail" — which pointed the judge away from where the violation was. Now scoped to the whole run, with the numeral-against-fixture check spelled out. Also aligned the `who` guidance with the F8 ruling. |
| `newspaper-citation.json` | F2. Removed the two worked examples printing a plausible headline, date, page and column; added a whole-run fabrication clause noting an invented headline reads as a quotation from the paper. |
| `missing-locator-flagging.json` | F3. Added the marker-scope clause per the ruling: markers belong to framework elements, and an unconfirmed custody chain goes to `notes`. Made the validate requirement a tool-ledger check. |
| `probate-will-citation.json` | F8. Replaced "accept either" with the ruling: Register of Wills is the creator of a will; Orphans' Court is a real probate authority but not this record's creator, so partial rather than pass. |
| `negative-search-citation.json` | F9. Corrected the `who` clause per the ruling (record creator in `who`, platform in `where`); added the circa requirement for a query `birth_year`; replaced the pre-quoted note phrases with an instruction to read the log's actual wording, flagging paraphrase-presented-as-quotation; required the indexing caveat to reach the user. |
| `refuse-new-source-creation.json` | F5. Added two clauses: when `activated` is true, grade the decline itself rather than the absence of harm, and a run that produced no work is an absent decline, not a correct one; and named the three ROUTING moves that are checkable in the response, including the offer to handle both adding and formatting. |

**`rubric.md`:**

- New dimension **Tool usage — the write path**, graded on the tool ledger: `research_append` as the only writer, `validate_research_schema` after any write, and the response's account matching the ledger. This makes F1 gradeable and also clears the `missing_tool_usage_dimension` advisory the harness has been emitting on 8 of 18 tests.
- **Source fidelity** rescoped to the whole run, with a partial branch for an invented locator that appears only in prose and a fail branch for a custody chain derived from the creator's name. This is the dimension that scored 3 fourteen times out of fourteen; it can now report F2 and F3.
- Added a precedence rule: where a `judge_context` clause forbids a deduction, it wins — and the same deduction may not be reached by calling the citation "incomplete relative to the template". That is the exact move that produced F4.
- Adding **Tool usage — the write path** brought the rubric to 6 dimensions, over the spec §7 cap of 5 — caught by the runnability gate on the first post-fix `make eval-skill` run (all 18 tests aborted `not_runnable` before any model call, $0 spent). Retired **Does not create new source entries** rather than merge it: the invariant it graded is already enforced by `test_does_not_add_new_source_entries`, which runs on every positive test and on negatives tagged `no-new-source`, so the LLM dimension was pure redundancy — one of the two non-discriminating dimensions this dive already flagged. The retirement still holds even though the validator skips three untagged negatives: those receive zero rubric dimensions regardless, so no coverage was lost. Its auditor note moved to **Source vs information distinction**, the sibling dimension it referenced, which is invariant-shaped for a different reason (scores 3 whenever no source was created/modified) and stays as a graded dimension.

**`SKILL.md` (lane 3/4, on the genealogist's rulings):**

- **PA probate creator** — the body said the creating authority *is* the Orphans' Court and never mentioned the Register of Wills, while `tree.gedcomx.json`'s `author` for this source says Register of Wills and the framework table gives `author` precedence. Now: the Register of Wills receives, probates and records a will and holds the will books, so it is the creator of a will, probate record or letters-testamentary entry; the Orphans' Court is named for distribution, accounts, partition and guardianship; `author` still takes precedence over the inference.
- **Negative searches** — three new rules: a query `birth_year` is an estimate and keeps its `c.`; a phrase presented as the log's must be the log's own wording, not one illustrated in the skill body; and a coverage caveat in the log must reach the user, because it is the difference between evidence of absence and absence of evidence (BCG Standard 3).
- **Fidelity rule 3** — removed the filled-in counter-example. The body printed `"Will Book 7, p. 214"` as the thing never to write, and `ut_citation_016` reproduced that exact string to the user in both committed runs. The rule now describes the prohibition instead of demonstrating it, and the same attractor was removed from the probate `where_within` paragraph. No rule was restated: per the guide, a rule that was present and ignored does not get more prose — V3 and V4 close that class.

**Not fixed, deliberately:** F10 (framework walkthrough in chat, two persisted miscounts). `rubric.md` rules presentation out of every dimension on purpose, and that is the right call — mechanising it would add a dimension that scores 3 forever, which is what Step 6 warns against. F10 rides on validator V12 instead.

## Cost note

The run-log snapshot for `v1_2026-07-21_15-04-23` was **already inactive before this
session's edits**. Recomputing it with `harness.snapshot.hash_file` shows two fixture
files drifted after the run was recorded:
`eval/fixtures/scenarios/mid-research-flynn/research.json` (2026-08-03) and
`.../README.md` (2026-08-14). The eleven edits above therefore do not *buy* the paid
run — one was already owed. They should still ride on it as a single batch.

## Rulings recorded here so they do not get stranded again

F8's whole lesson is that a senior genealogist's ruling lived in one test's
`judge_context` for weeks and never reached the skill body. These four were made by
Edmond Oware on 2026-08-19 and are written into the body or the rubric, not only here:

1. **PA will creator** — Register of Wills, not Orphans' Court. *(→ SKILL.md probate section)*
2. **Nil-result `who`** — the searched record set's creating agency; the platform goes in `where`. *(→ SKILL.md + ut_citation_007)*
3. **Marker scope** — unknown-markers only for Who/What/When/Where/Wherein elements; an unconfirmed custody chain goes to `notes`. *(→ ut_citation_017, and V6 is unblocked)*
4. **Nil-result coverage caveat** — a note that the collection may not be indexed must reach the user with the citation. *(→ SKILL.md negative-search section)*
