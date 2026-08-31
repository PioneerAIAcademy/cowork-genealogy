# Deep dive: search-records — findings and validator requests

Issue #1642. Base `25b0f434`. Release candidate: `v1_2026-08-28_16-51-11` (28
tests, 27 pass / 1 fail, annotated).

Step 1's output is
[`search-records-prohibition-list.md`](./search-records-prohibition-list.md) —
33 checkable rules, of which 10 have a guard and 6 of those are purely
tag-gated, so they fire on one or two named tests and are inert on the rest of
the suite (see the prohibition list's Coverage summary for the full
breakdown, including the 3 that are universal/packaging-level rather than
tag-gated).

This round worked from six of the seven comments already on the issue
(DallanQ, mercyokum, florencemashipei, chesworthrm x2, clack391) rather than a
fresh cold-start audit — most of Step 1-3's work was already on the card.

---

## Fixed this round

### F1 — jurisdictionHints returned by record_search were never consumed (mercyokum, Finding 1)

**Did:** on `jimmie-jewel-neal`, run `2026-07-30_23-05-46`, `record_search`
returned a correctly-ordered jurisdictionHints candidate naming Yell,
Arkansas third, with supporting date and source person. The agent ran one
Arkansas-scoped search after receiving it, then reverted to nine more South
Carolina searches. Both grandparent findings were later scored false.

**Should:** the skill has explicit consumption rules for `ranked`,
`relativeTerms`, and `attachedToSubject`, but had no equivalent for
`jurisdictionHints`.

**Gap:** lane 4 — a missing instruction, not a violated one. Added to Step 4
(SKILL.md line 504): the next 1-2 retries in the same plan-item sequence must
try the top-ranked hint's place before reverting.

**Converted.** `test_jurisdiction_hints_followed`
(`eval/harness/validators/test_search_records.py`), tag-gated
`jurisdiction-hints-followed`. Direct proof tests in
`eval/harness/tests/unit/test_search_records_jurisdiction_hints_validator.py`.

**Correction (chesworthrm review):** the guard above was written but never
actually wired -- no test carried the `jurisdiction-hints-followed` tag and no
fixture returned a `jurisdictionHints` field, so it passed vacuously. Wired
properly now: `ut_search_records_jurisdiction_hint` (new scenario
`jesse-neal-marriage-jurisdiction-hint`, four new `record_search` fixtures)
carries the tag and a fixture whose response includes `jurisdictionHints`.
Running it caught a second, real bug in the same pass: the model's actual
next call used `recordSubdivision` -- the exact field
`record-search.ts`'s own `searchedPlace` computation reads for a marriage
search -- which the validator's `place_fields` tuple was missing, so a run
that had genuinely complied still failed. Both are fixed and the test now
passes end-to-end (all 7 dimensions score 3).

**Second correction (promise-emmanuel review):** the guard above still
passed on the exact failure mode it exists to catch. `_place_tokens` kept
any word over 2 characters as matchable, and the hint place ("Yell County,
Arkansas") shares the word "County" with the reverted-to place ("Union
County, South Carolina") -- so any subsequent US-place search satisfied the
assertion regardless of whether the run ever tried Arkansas. Verified
directly: the real jimmie-jewel-neal failure sequence (nil, then two more
South-Carolina-scoped searches, no Arkansas anywhere) passed the validator
before the fix and correctly fails it after. Fixed with a
`_GENERIC_PLACE_WORDS` filter (county/parish/state/district/...); pinned
regression test added using the fixture's own strings. Separately,
SKILL.md's Step 4 rule and the validator's own assertion message still
named `recordCountry`/`birthPlace` as the first-choice fields -- wrong for a
within-country jurisdiction change, and unstocked by any fixture -- both
corrected to `recordSubdivision`/`residencePlace`/`marriagePlace`.

### F2 — the skill asks permission instead of running a lever it already mandates (mercyokum, Finding 3)

**Did:** `ut_search_records_nickname_bitsie`
(`v1_2026-08-13_13-13-43`): the plan called for searching "Bitsie Jackson,"
getting a nil, then automatically searching the formal name "Mary." The agent
searched only "Bitsie," logged the nil, then asked the user whether to try
"Mary" instead of just running it.

**Should:** Step 8.2 says to iterate through search-strategy levers "before
declaring negative," and Step 9 already bans re-asking a question the
invoking context already answered.

**Gap:** lane 2/3 — the rule existed and was not followed; the same
"check-in-before-acting" tendency flagged elsewhere in this skill's own
history, so prose is unlikely to move it further.

**Converted.** `test_no_permission_ask_before_mandated_lever`, tag-gated
`asks-permission-instead-of-executing` — wired onto the actual test that
surfaced it (`non-derivative-nickname-bitsie.json`), plus a direct proof file.

### F3 — the extraction-offer gate contradicted itself by branch (DallanQ, opening comment)

**Did:** `SKILL.md:413` prohibited offering extraction "not even as a
question" inside the disqualified-namesake block, while `:606` instructed the
opposite for a promising result and `:621` said "let the user confirm before
extraction." On `ut_search_records_013` (`matchScore 0.52`, 3-year age gap —
exactly the boundary case), all five committed runs at the time offered
extraction and three called it a "strong candidate"; the judge scored Result
triage 3 every time.

**Should:** one rule, not two competing ones.

**Gap:** lane 4, and a genealogist's call, not a grading fix — DallanQ said so
directly. Resolved by making the gate purely needs-review-based rather than
score-based: extraction may be offered only once the top match clears
needs-review on every check (Step 4, "This gate is not special to the
namesake case"), independent of `matchScore`. No numeric threshold remains
anywhere in the file. The warm-framing ban was widened to include "a strong
candidate," per DallanQ's note that the phrase list needed it.

**Not converted** — whether a needs-review flag is the *correct* call is
judgment; Result triage / rubric.md still owns grading it.

### F4 — batching prohibition lost to the tool's own affordance (florencemashipei, Finding 2)

**Did:** of 11 tests running 2+ `record_search` calls, 8 logged them via a
batched `ops[]` array rather than one call per search, against `SKILL.md:572`
("log each retry as a separate call immediately after it completes — do not
batch log calls at the end"). `_011` and `_024` were the clearest violations,
both narrating an end-of-run batch after a full nil-lever ladder.

**Should:** the crash-safety rationale is live — `_023` aborted on
`max_turns` this same run, and a held-to-the-end `ops[8]` would have lost
eight searches. But the tool offers the array, and most runs use it.

**Gap:** lane 4 — the prose banned an affordance the tool exists to offer.
Resolved by permitting batching (Step 8.2): "either its own call immediately
after the retry completes, or grouped into a batched `ops[]` call — but flush
every few retries rather than holding the whole ladder for one call at the
end." The crash-safety half ("flush every few retries") is still unguarded —
see prohibition list #30.

**Not converted** — a validator can see whether a batch happened, not
whether the model held it too long before flushing; that is a wall-clock/turn
judgment, not a state fact.

### F5 — the census inference-marker validator had two false-negative bugs and one true content gap (chesworthrm x2, this session's own re-measurement)

**Did:** run 4 (`v1_2026-08-28_15-20-05`) failed six tests: `_010`, `_013`,
`_014`, `_015`, `_027`, `_t9p`. Checked each against the four pre-fix
historical run logs before touching anything, per this repo's "one run is not
a measurement" rule:

- `_010`, `_013`, `_027`: within each test's own historical non-pass rate
  (~75-100%) — not new.
- `_014`: within historical variance (2-of-4 pass historically).
- `_015`, `_t9p`: both a clean 4-of-4 historical pass, now failing — genuine
  signal, not noise.

Investigating the two real anomalies found three distinct causes:

1. `_015`'s failing note (a clean, unconflicted Sarah Mullen match) had no
   needs-review reasoning to hang the inference marker on — the rule as
   written was read as needs-review-scoped even though nothing gated it that
   way in the letter of the text.
2. `_010`, `_014`, `_027` (surfaced by the fix for #1) already produced
   compliant text — "ParentChild relationships indexed," "Indexed as Head of
   Household," "co-residents indexed" — that the marker regex simply did not
   recognize. A corpus scan of every committed run log confirmed a bare
   `index` marker would also have wrongly accepted `_013`'s "indexed
   spelling"/"surname indexed as Flyn," which is about name spelling, not the
   household relationship.
3. `_t9p` was a harness activation flake unrelated to content — all
   validators passed and the judge scored 3/3 on every dimension, but
   `skills_invoked` came back empty, which `derive_activated`
   (`eval/harness/harness/runlog.py`) treats as non-activation regardless. The harness's own
   docstring already names this as a known, accepted Agent SDK
   skill-discovery bug ("re-runs typically clear it") — confirmed: it passed
   on the very next run with no skill change.

**Should:** SKILL.md Step 4's own account of the underlying fact — "the
record's own `ParentChild`/`Couple` edges are the indexer's inference from
those same signals" — already implies both compliant forms above are correct.

**Gap:** #1 is lane 4 (a genuine scope gap in the prose); #2 is lane 2 (a
validator false negative), same class as the earlier `infer`/`inferr` bug
already fixed in this file; #3 is out of skill scope entirely.

**Converted.** `_ROLE_WORD` + two new `_INFERENCE_MARKERS` entries requiring
`index`/`indexing` near an actual role/relationship word (not a bare `index`
anywhere), plus `presumed` widened to `presum\w*` (missed "presumably" — same
bug shape). Verified deterministically against every committed
`pre-1880-census-household`-tagged note in the corpus before writing the fix
— zero API cost. 5 new pinned regression tests (4 compliant, 1 false-accept
boundary case pinning `_013`'s "indexed spelling ... household head" as still
correctly rejected) in
`eval/harness/tests/unit/test_search_records_pre1880_validator.py`; all 20 in
that file plus the full 32-test search-records-scoped suite pass.

### F6 — `_028` non-deterministically reads an unstocked sibling record (chesworthrm, second flake report)

**Did:** `ut_search_records_028` (richardson-ashton parish register batch)
intermittently scored partial — Correctness 2 — because the skill issues a
`record_read` for a Rachel Richardson sibling record the scenario never
stocked, yielding a `fixture_not_found`. The record ID varied by run
(`NGYP-RT5`, then `NGYP-KXD`).

**Should:** reading a sibling record already returned by a batch-enumeration
search is reasonable behavior, not a bug in the skill — it is the fixture
that is thin.

**Gap:** lane 2, per chesworthrm's own framing ("stock the record the skill
reasonably reaches for"). Stocked both observed sibling IDs
(`record-read-richardson-c00558-7-ngyp-rt5.json`,
`...-ngyp-kxd.json`) and extended `rubric.md`'s existing Tool-Arguments
name-variant override to cover `record_read` on a batch-enumeration sibling,
with a "do not split the difference" guard: on the run that surfaced this,
the judge had scored the same `fixture_not_found` down under Tool Arguments
**and** separately under Correctness and Completeness — penalizing one gap
three times under three names.

**Not converted** — which sibling ID a batch enumeration reaches for is
open-ended by design; there is no fixed set to validate against.

### F7 — 20 tests graded blind to the actual file diff

**Did:** `judge_reads_files` was absent (defaults false) on 20 of this
skill's test JSONs, meaning the judge scored several dimensions from the
narrated response alone rather than the persisted `research.json`/log diff.

**Gap:** lane 2. Set `judge_reads_files: true` on all 20 files, preserving
key order.

**Not converted** — this is a test-authoring default, not a runtime rule with
a pass/fail shape.

### F8 — clack391's validator request (five prescribed levers reject against the shipped tool)

**Did:** `search-strategy-levers.md` prescribed six query shapes
(`:48`, `:51`, `:53` x2, `:59`, `:110`) that the shipped `record_search`
`validateInput()` rejects outright — every lever that clears `q.surname`
fails the anchor rule (surname, `recordCountry`, or `batchNumber` required),
and no row said so.

**Gap:** lane 1 (tool/reference mismatch), already converted per clack391's
own request before this round started:
`packages/engine/mcp-server/tests/packaging/lever-anchor-shapes.test.ts`
parses each lever row and runs its derived query shape through the real
`validateInput()`. First version silently skipped rows it did not recognize
the wording of; fixed to fail-closed (`{applies, shape}` rather than
`null`-to-skip) so an unrecognized-but-relevant row fails loudly instead of
passing by omission — proven by a deliberate-breakage test.

### F9 — parent-age-at-birth plausibility (mercyokum, Finding 2) — partially converted, scoped wider than requested

**Did:** on `jimmie-jewel-neal`, run `2026-07-31_13-02-13`, the agent adopted
a same-surname household as Martha's birth family; the implied mother's age
at Martha's birth was 14, uncaught. The finding's own validator request
asked whether "parent age at childbirth" was already one of
`check-warnings`'s implausible-lifespan checks before building a new one.

**Should:** a `ParentChild` write with an implausible parent age should carry
a `needs-review` marker rather than a plain confirmed link.

**Gap:** lane 4 in the sense that no rule existed yet anywhere in the
project, not just in this skill.

**Converted, but not exactly as specified.** `test_parent_child_age_plausibility_flagged`
was added to `test_universal.py` — universal (applies to every skill's
writes), not search-records-specific, reusing the exact bounds already
implemented in `packages/engine/mcp-server/src/tools/person-warnings.ts`:
lower bound 12 general / 14 male, upper bound 80 general / **45** female. The
finding suggested "under ~13 or over ~55" for a mother — the shipped bound is
stricter (45, not 55) and, more importantly, **there is no female-specific
lower bound distinct from the general 12** — a mother at exactly the age the
Martha scenario describes (14) sits above every bound in the code and is not
flagged by this validator either. Documented rather than hidden: a direct
proof test, `test_known_gap_female_age_14_is_not_caught`, asserts the gap
exists (does not raise) rather than papering over it.

---

## Already resolved before this round (verified live, no credit claimed here)

**florencemashipei's Finding 1** (the `census-field-availability.md` pointer
was rewritten as an unconditional "always read this" instruction in #1283,
and 0 of 8 census tests read it on the next run — the situational trigger
wording was the fix, not a verb). The current SKILL.md line reads verbatim as
florencemashipei's suggested fix: "When a match turns on a field — or before
calling one absent — check that year's entry in
`references/census-field-availability.md`." Confirmed present; not touched
this round.

**Both of issue #1817's folded-in reference gaps** (promise-emmanuel review):
`census-field-availability.md`'s 1840 line now reads "1840 additionally
lists names and ages of Revolutionary War pensioners" (reworded elsewhere in
this diff), and `collection-quirks.md` now carries the leading/middle-wildcard
guidance for the Bipes/Bippes/Biepes/... case. Both confirmed present on
disk; this findings doc previously listed them under "Still open" in error.

---

## Still open — not addressed this round

- **The `givenName`-drop contradiction** (issue #1817, folded in): SKILL.md
  says never drop given name; two `search-strategy-levers.md` rows say to.
  Explicitly parked pending the lead's answer on #1008 (the full-given-name
  default's cost) — do not resolve without that answer.
- **`_023`'s `max_turns` abort pattern** (florencemashipei, Finding 3): same
  ceiling issue as person-evidence (#1334) and proof-conclusion (#1603).
  Bumping this one test's `execution.max_turns` fixes the instance; the
  default itself is above this issue.
- **A fixture that models the behavior it penalizes** (florencemashipei,
  Finding 4): `record-search-1880-census-price-sarah.json`'s stubbed
  `response.query` is itself a 2-parameter echo, and `_016` may be copying it
  rather than its own 12-parameter call. Also `_024`'s `Wilkin*` wildcard
  cannot match `Wilkens` (the variant `_024` is supposed to test) — `Wilk*`
  would catch both, and no explicit spelling variant was tried first per
  `:577`.
- **Rubric wording does not hold across attempts** (florencemashipei, Finding
  5): the `_013`/`_016` judge-accuracy corrections were already backed by a
  `judge_context` that stated the exact rule and the judge still missed it.
  `rubric.md`'s own Tool Arguments section already carries a "do not reword
  this section again" note after three attempts — the same caution likely
  applies to Result triage now.
- **The validator is a floor, not a ceiling** (florencemashipei's own
  closing note): `test_pre1880_census_structure_marked_inferred` checks that
  the inference marker is *present*, not that the surrounding argument
  *respects* it — `_013` can pass the marker check and still lean on the
  inferred structure as identity corroboration anyway. This is likely the
  actual reason `_013` (and now `_012`) keep failing/near-failing even after
  F5: the marker's presence and the reasoning's honesty are two different
  facts, and only the first is guarded.
- **`_013` and `_012`'s residual content gap**: `_013` never uses inference
  language even where needs-review reasoning already exists in the same note
  (0 of 5 observed runs); `_012` failed the same way for the first time in
  the release-candidate run. Deliberately not re-worded this round — the
  last SKILL.md widening aimed at this exact family showed no measurable
  effect across the available run logs, and a third attempt without new
  evidence would repeat that.

---

## Notes for the next auditor

- **Do not re-word the census inference-marker rule a third time without new
  evidence.** Two rounds of prose widening on this exact rule (the
  needs-review cross-reference, then the unconditional-scope sentence) each
  targeted a real, cited failure — but only the second one was confirmed to
  move a specific test (`_015`) via a mechanism check, not just an outcome
  label. `_013`/`_012`'s residual gap is real and still open; the fix is more
  likely a validator or a rubric change than a fourth restatement.
- **Retention keeps only 5 candidate run logs per skill.** The four pre-fix
  baselines (`v1_2026-08-24_09-59-31` through `v1_2026-08-25_00-44-28`) that
  this round's before/after comparison depended on are already down to
  three, one auto-pruned when the post-fix candidate landed. A future
  before/after comparison on this skill has a shrinking window.
- **`_t9p`'s harness flake is accepted, not fixed, project-wide** —
  `runlog.py`'s `derive_activated` docstring already names the Agent SDK
  skill-discovery bug as a known-accepted v1.x limitation. Do not spend time
  re-diagnosing it on this skill specifically; a future v2 fidelity pass owns
  it (`docs/specs/unit-test-spec-v2.md`).
- **Two validator regex bugs this round shared one shape**: `infer` missing
  `infers`/`inferring` (fixed earlier, issue #1642), and `presumed` missing
  `presumably` (fixed this round). Both were "the regex only matches the
  base/past-tense form." Worth a quick grep of the file's other markers for
  the same shape before the next round.
- **A scoped word-proximity marker is safer than a bare word marker.** The
  `index` fix in F5 needed a corpus scan against every committed run log
  before shipping, specifically because a bare match would have silently
  broken `_013`'s pinned offender test. Any future marker addition to this
  file should get the same treatment — grep the corpus for the naive version
  before committing to it.
