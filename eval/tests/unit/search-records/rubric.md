# Search Records Rubric

Grading dimensions for search-records unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

> **Note — not a dimension.** Everything until the first `##` below is grading
> guidance, not a scored axis. Keep it out of `##` headings: the harness parses
> every `##` in this file as a rubric dimension and rejects one without
> **pass** / **partial** / **fail** bullets, which aborts every test in the
> skill as `not_runnable`.

### Tool Arguments — this rubric owns the name-variant case

**A `fixture_not_found` on a *name-variant* `record_search` is a gap in this
test's fixtures, not a Tool Arguments defect. When the searches that DID match a
fixture — above all the primary query — carry correct arguments, score Tool
Arguments exactly 3. Not 2. A `fixture_not_found` of this kind contributes
nothing to the score, so it cannot be the reason for a deduction of any size.**

**Do not split the difference.** On 2026-07-31 a judge quoted this override,
agreed the variant misses "are not Tool Arguments defects", confirmed "the
primary search arguments were correct", and then scored **2** — reading "do not
score below 3" as "do not score *fail*" and settling one band down. Partial is a
deduction; if the only blemish is a name-variant fixture miss, there is nothing
to deduct for. The score is 3.

This overrides the global "Critical: Tool Usage Errors" rule for this one case,
under that prompt's own provision for a skill's rubric to claim an axis and be
deferred to.

It exists because the two rules otherwise contradict each other. **Search
strategy** below awards a pass only when, "for names with known variant patterns
(Irish, German, Eastern European origins), at least one relevant variant or
phonetic alternative is included" — and marks it *partial* when an obvious
variant is missed. So the rubric pays the skill to invent spellings. But a unit
test can only stock the spellings its author happened to think of, and the
global rule fails any call that matches no fixture. The skill therefore gets
credited on Search strategy and penalised on Tool Arguments for the *same*
query. Observed twice in one suite sweep on different tests — `Flinn`/`Pat`
(ut_search_records_014) and `Wilkens` (ut_search_records_024) — each of which
passed in isolation, because whether the model reaches for a variant on a given
run is a coin flip. That is a corpus limit surfacing as skill flakiness.

**Scope this narrowly.** It covers a plausible spelling or given-name variant of
a name already in the query — `Flynn`→`Flinn`, `Wilkins`→`Wilkens`,
`Patrick`→`Pat`. It does **not** excuse: a malformed or anchorless call, a wrong
parameter name, a tool that does not exist, a call to a tool this skill is not
allowed, or a `record_read`/`record_search` aimed at a record no search returned.
Those are real defects and the global rule stands.

**Do not "fix" this by stocking a catch-all nil fixture.** It was tried on
ut_search_records_014 and made things worse: an error stops the skill, whereas a
nil is an *invitation to try the next variant* (Step 8's protocol), and the run
hit its turn cap. A catch-all is defensible only on a test whose subject is nil
exhaustion **and** whose turn budget has room for it — ut_search_records_018 has
both.

## Search strategy

Did the skill construct appropriate search parameters from the plan item? Name variants, date ranges, and jurisdictions should match the research context, and the broad-to-narrow default should be followed unless the plan item justifies a narrow start.

- **pass:** Search parameters include the correct surname anchor (or `recordCountry` if surname unknown), a date range that matches the plan item, and a jurisdiction at the right level of specificity. For names with known variant patterns (Irish, German, Eastern European origins), at least one relevant variant or phonetic alternative is included. Rationale or `notes` explains the parameter choices.
- **partial:** Parameters are reasonable but a clearly relevant variant is missed (e.g., no Anglicization variants for an Irish-origin name such as Flynn → Flyn/Flinn), or the date range is significantly wider or narrower than the plan item suggested without explanation, or the jurisdiction is set at the wrong level (country instead of state, or city instead of county). **Also partial when the parameters are sound but unexplained** — the plan item or tree offered a specific reason to choose this surname, variant, or date range (a maiden-vs-married shift, a documented nickname, a marriage date bounding the range) and the skill silently used one without saying why. A future reader cannot tell a considered choice from a lucky one.
- **fail:** Parameters would not plausibly find the target even if it is indexed — the wrong jurisdiction for the plan item, a date range excluding the event, or a name form the plan item's own evidence rules out. (A *missing* anchor is not graded here: `record_search` rejects an anchorless query outright, so it surfaces as a Tool Arguments failure, not a strategy one.)

## Result triage

Did the skill obtain a real match signal against the research subject, and then
reason on top of it? When `record_search` is given a `subjectId` it ranks the
staged pool host-side and returns a `ranked` block — `matches[]` carrying
`matchRank`, `searchRank`, `matchScore`, `matchConfidence`, `candidateFactCount`,
and `attachedToSubject` / `attachedToOther`. The ranking is a **review surface,
not a verdict**; this dimension grades whether the skill treated it as one.

**This dimension owns the promising / needs-review / not-relevant verdict and the
reasoning behind it.** Correctness and Completeness must not re-grade the verdict
band — they grade whether required actions happened and whether stated facts are
true.

**No numeric threshold is graded.** Match-score bands genuinely overlap: on live
data a confirmed record scored 0.632 while a *different* same-name man scored
0.716, and two dateless obituary stubs differing only by a middle initial scored
0.086 and 0.668. Never reward or penalize a specific cutoff, in either direction.
Grade the shape of the reasoning, not the number it lands on.

**`results[].score` is not `matchScore`.** The former is FamilySearch's search
relevance — the unreliable ranking the match-ranker exists to replace. Citing it
as if it were a match score is a defect, not a pass.

**The standalone `rank_search_matches` tool is no longer part of the normal
flow.** Do not penalize its absence. It survives only for re-ranking a finalized
`results/<log_id>.json`, ranking a pool against a *different* subject, or
recovering from `rankingError`. Correct in those cases; a redundant second
ranking of a pool the search already ranked is `partial` (wasted call).

- **pass:** For a search with a known tree subject, `subjectId` was passed and the skill triaged from `ranked.matches[]`, not from raw search order or `results[].score`. Each surfaced candidate is categorized promising / needs-review / not-relevant with per-candidate reasoning naming the discriminating attributes — role in the record, birth-year distance, place, household, collection. Match score is cited as one input among several, and at least one verdict is argued rather than inherited from the ordering (a high-scoring candidate flagged on a failed cross-check, or a middling-scoring one kept for review because independent anchors corroborate it). Thin candidates are treated as low-signal in **both** directions: a low `candidateFactCount`, or a dateless / placeless stub, is a reason to corroborate before accepting *or* dismissing — never a reason to rank-order confidently. Attachment status is used directionally: attached-to-subject is deprioritized when the plan item's goal is *discovering* new evidence, and is the target when the goal is *confirming* a suspected fact.
- **partial:** Triage happened but the ranking was used as a verdict rather than a surface. Any of: the top match is adopted on score with no independent cross-check; a needs-review-band candidate is written up as a "Top Match" or "almost certainly the right person"; a conflicting date is explained away rather than resolved by corroborating anchors (this counts in **either** direction — the record's imprecision *or* the tree's own estimate being approximate are both excuses); a thin / dateless candidate is confidently dismissed on a low score alone; attachment status is reported but not used to prioritize; `results[].score` is cited alongside or instead of `matchScore` without noticing they are different quantities; or one near-match is silently dropped while the rest are triaged.
- **fail:** No match signal was obtained or reconstructed for a search that had a known tree subject — `subjectId` omitted and no ranking recovered — so every candidate was hand-scored from FamilySearch's search order. Or results are bulk-categorized with no per-candidate reasoning ("no matches found" when candidates were returned); near-matches are treated identically to irrelevant ones; or a candidate is presented as confirmed on score alone against a cross-check that visibly contradicts it (impossible role, birth year years off, wrong collection).

**`subjectResolvable: false` — score these clauses only when the response actually
carries the field; otherwise ignore them.** The field means one of two things and
`diagnostic` says which. *Subject too thin to score* — `matches` is withheld on
purpose — the correct response is to thicken the subject (extract or link one
dated/placed assertion) or narrow the query; hand-triaging the pool, or falling
back to `same_person` against the same starved tree person, is **partial**.
*Scoreable subject, no match in the pool* — this is a real negative for the
query; log it as such and page deeper or narrow. Taking the wrong branch for the
`diagnostic` returned is **partial**; recognizing the distinction and acting on
it is part of **pass**.

## Log quality

Does every search produce a log entry whose *authored* content is faithful and
useful? Scope this dimension narrowly: `research_log_append` assigns `id`,
`performed`, `results_ref` and writes the sidecar, and deterministic validators
already own entry existence (`test_positive_appends_log_entry`) and `outcome`
honesty (`test_log_outcome_positive_record_search`,
`test_log_outcome_honest_no_match`). **Do not re-grade any of those here.**

What is left is the part only a reader can judge: whether `query` faithfully
reproduces the search that was actually run, whether `results_examined` matches
what was really reviewed, and whether `notes` would help a future researcher.

Judge these from the skill's own account of what it wrote. Sidecar files are
newly created and do not appear in the file-change diff, so their absence from
the diff is never evidence.

- **pass:** `query` reproduces the search — the parameters actually sent, not a paraphrase, and complete enough to re-run. `results_examined` matches the number of candidates actually triaged. `notes` is a specific one-liner a later reader could act on ("1850 Schuylkill household matched; 1870 collection-mismatch candidate rejected on collection year"), not a restatement of the query.
- **partial:** The entry is broadly right but one authored field is thin: `query` omits a parameter that materially shaped the result set; `results_examined` is approximate ("about 3") when an exact count was available; or `notes` is generic ("search completed", "found some results") and carries no information a future reader lacks.
- **fail:** `query` misrepresents what was searched (wrong parameters, or so abbreviated the search cannot be reconstructed), or `results_examined` is materially wrong in a way that would mislead an exhaustiveness claim.

## Nil escalation

When a search returns no results, did the skill treat the nil as a finding to investigate — not an endpoint? The SKILL.md requires iterating through strategy levers (name variants, date widening, jurisdiction broadening) and logging each retry separately before declaring the search exhausted.

- **pass:** After a nil result, the skill tries at least 2–3 meaningful variations (e.g., phonetic surname variant, wider date range, higher jurisdiction level, wildcard on a suspect letter). Each retry is logged as its own entry. After exhausting reasonable levers, the skill assesses whether absence is meaningful — noting whether the record type existed in the jurisdiction, whether the collection is reasonably complete, and whether the subject should have appeared.
- **partial:** Skill tries one variant but stops short of exhausting the obvious levers for the record type and name origin, or tries multiple variants but logs them all under one entry instead of separately, or concludes the search negative without assessing whether the nil is meaningful evidence.
- **fail:** Skill gives up immediately after the first nil result with no variant attempts; or declares "record does not exist" without checking whether the database covers the target period; or conflates "not found in this index" with "does not exist in any source."
