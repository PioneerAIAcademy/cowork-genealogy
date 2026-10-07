# Issue #2813 item 5: an interrupted extraction is named as unsaved

**Status:** LANDED on `2813-item5-unsaved-extraction`. **Rewritten twice.** Round one returned 4 blocking findings and
the first killed the original premise. Round two returned 2 more; its finding 2 (the unit harness
cannot manufacture an in-turn extraction failure) is correct, and checking it turned up something
worse that neither round stated — see §"What the second rewrite changes".

## What the clause is, and why the first draft was wrong

Item 5's fourth clause: *"An extraction that gets interrupted is either finished or named in the
reply as unsaved."*

The first draft claimed *"is either finished"* was already enforced by `research/SKILL.md:190`,
the routing-table row that re-routes a log entry with no assertion back to `record-extraction`.
**That row never fires for this population.** PR #3187 landed items 1 and 2 in the same file
hours earlier, and they say the opposite at `:104-110` and `:119`:

> Hand a bounded request straight to the step that owns its deliverable … **Do not walk the
> routing table from the top for one** … Deliver the one thing, and stop.
> When a bounded request is met, **end your turn**.

Item 5 governs the bounded turn. On a bounded turn the table does not run, so nothing re-enters
the unfinished extraction and **both halves of the clause are open**. The draft scoped half the
work out by citing a rule its own PR had just disabled.

## Where it goes

**ADR-0011's question splits, and the split rules out the first tier.** Whether an extraction is
incomplete is decidable from the documents — a `log` entry (the section is `log`, not
`research_log`; `$defs.log_entry` carries `id`, `outcome`, `plan_item_id`, `results_ref`) with
`outcome` in (`positive`, `partial`) that no assertion's `log_entry_id` references.

**But that predicate alone is wrong, and this is the second thing the first draft got wrong.**
It fires on the normal mid-research state. Eleven committed scenarios already carry such an
entry — `flynn-parentage-found`, `mid-research-flynn-1880-found`, `flynn-fan-pivot` and eight
more — because "found, not yet extracted" is exactly the state `research/SKILL.md:190` exists to
pick up on the NEXT turn. A static snapshot cannot tell "interrupted now" from "queued since
earlier".

What distinguishes them is that an interruption happened in THIS turn, so the predicate must be
a **delta**: an entry present in `after_state["research_json"]` and absent from
`before_state["research_json"]`, with a positive/partial outcome and no assertion referencing it.
Both fixtures exist (`eval/harness/validators/conftest.py:55`, `:66`). Whether the REPLY named it is not: no tool sees the reply. So a writer-tool
precondition cannot express this clause, and the second tier applies — a deterministic validator,
which receives `after_state` and `text_response` together
(`eval/harness/harness/validator_runner.py:82`).

**The site is `research/SKILL.md:119`, not `record-extraction/SKILL.md:257`**, on three grounds:

1. **Scope.** `:119` is where the bounded turn ENDS and already says "Say what you produced
   first". It covers every interruption path. The spawn-failure arm at
   `record-extraction/SKILL.md:257` is one of at least four: the image-reader `NOT READ` pivot
   (`:101-112`), the stale staged handle (`:146`), and the orphan sidecar (`:150`) leave the same
   state and say nothing about naming the record.
2. **Both halves land together.** The "either finished" half also has to live where the bounded
   turn is decided, which is this file.
3. **Cost, measured.** Touching `record-extraction` arms Rule 10 — that suite still carries
   `expected_outcome: xfail` on `ut_record_extraction_g4k`, whose own reason needs issue #2173 —
   and Rule 6, which demands zero fails. **No committed run of that suite has ever had zero
   fails**: the six logs read 1, 4, 5, 5, 18, 19. The `research` suite carries no xfail markers
   and `v8.json` is 10/10.

## The change

1. **`packages/engine/plugin/skills/research/SKILL.md:119`** — extend the existing sentence at
   the decision point, stating the negative, which is the only prose shape measured to bind:

   > Say what you produced first … **and name anything the turn found but did not save** — the
   > record and the person it was for, not "an extraction did not finish". A record found and
   > left unsaved that the reply does not name is lost: the turn is over, and the next one has
   > no log entry pointing at it.

2. **`eval/harness/validators/test_research.py`** — `test_an_unsaved_find_is_named`, tag-gated on
   `unsaved-extraction`. Fails when the turn ADDED a `log` entry — present in
   `after_state["research_json"]`, absent from `before_state["research_json"]` — with a
   positive/partial outcome that no assertion's `log_entry_id` references, AND the reply does not
   name that entry's record. Skips otherwise. The delta is load-bearing: the static form of this
   predicate fires on eleven committed scenarios that are merely mid-research (see above).

3. **`eval/tests/unit/research/<new>.json`** — **a scenario, not a forced failure.** The first
   draft wanted the extractor spawn to fail; the unit harness cannot do that. `blocked_tools` is
   e2e-only (`e2e/orchestrator.py:305`), and the one available mechanism, `stub_skills`, composes
   a denial that tells the model the delegation "counts as successful" and to "**not mention**
   … that it was skipped" (`harness/skill_stubs.py:49-80`) — a test built on it fails by
   construction. Instead the scenario's `research.json` ALREADY carries the orphan log entry,
   which is the state an interrupted extraction leaves. No failure needs manufacturing.

## Acceptance

`test_an_unsaved_find_is_named` driven directly, both directions, before any paid run: a reply
naming the orphaned record PASSES; the same reply saying only "an extraction did not finish"
FAILS; a run whose state carries no orphan SKIPS rather than passes. ("Fails on main" is
incoherent for a validator that does not exist there.)

## Not in this plan

- **Item 5 clause 3** — *"The reply then names what was saved and where"* — is also NOT built
  (`grep -rn "Saved to"` over `packages/engine/plugin/` returns nothing). The first draft listed
  it as built. It is adjacent and belongs with this work if it fits the same edit; name it in the
  PR body either way.
- The three other non-completion paths in `record-extraction/SKILL.md`. Covering them means
  touching that suite, which costs what §Cost says.
- Items 3 and 7 (blocked). `extraction_append` (#3159 closed that defect; this is not it).

## Cost

One `research` run. Scratch the new test `--runs-per-test 3` first per `eval/CLAUDE.md`
§ "Clearing a card", then one committed run. **Note the debt already on this suite:** #3077
changed `person-read-driscoll-attached-sources.json`, which `research/v8.json` embeds, so that
re-run is owed regardless and this work can ride it.


## What the second rewrite changes (round two, plus one finding of my own)

Round two's two blocking findings are accepted. Verified independently: the router holds no
writer tool (`research/SKILL.md:509`); `search-records/SKILL.md:684` already ships the
accuracy rule for clause 1 ("a candidate record sitting in a search log — say exactly that");
`blocked_tools` is e2e-only; and the vacuous-skip note is real, at
`harness/orchestrator.py:1784` (round two cited `e2e/orchestrator.py`, which is a different
function — right content, wrong file).

**The finding neither round stated.** Round two argued the *interruption* population is
unreachable. It is worse than that: **the `research` unit suite has no write population at all.**
All ten committed tests are routing/boundary tests, and the skill under test is a router that
holds no writer tool. So a state-delta validator in this suite is vacuous for clause 4 *and*
for clause 3 — not because the orphan is hard to manufacture, but because nothing in this suite
ever writes. The delta predicate the first rewrite landed on is correct and still unusable here.

**Where the population actually is, and why this PR cannot reach it.** It is
`record-extraction`'s suite. `check_runlogs.py:1255` keys "touched" off
`packages/engine/plugin/skills/<skill>/` and `eval/tests/unit/<skill>/`, so adding a scenario
there arms Rule 10 — blocking, requiring g4k's `expected_outcome: xfail` be deleted and the test
made to pass, which needs issue #2173 — and Rule 6, on a suite whose six committed logs carry
1/4/5/5/18/19 fails. A validator file under `eval/harness/validators/` arms neither.

### Scope actually built

1. **The prose rule** at `research/SKILL.md:119`, instruction-only per round two's finding 6
   (the draft's rationale sentence was also false: the log entry is precisely what persists).
   Scoped to what **this turn** produced, per finding 3 — the router cannot see a pre-existing
   orphan on a bounded turn, and `:190` owns that case on the next job turn. Covers clause 3
   ("names what was saved and where", unbuilt: `grep -rn "Saved to" packages/engine/plugin/` is
   empty) and clause 4 together, since both shape the same reply.
2. **The validator**, with the corrected predicate: the `log` section (not `research_log`), a
   before/after delta, and `log_entry_id` absent and `null` both counting as not-referencing.
3. **A direct pytest unit test** for it — `eval/harness/tests/unit/`, run free by
   `make harness-test`, both directions — which is what keeps it from being an unfalsifiable
   check.
4. **No eval scenario carrying the tag.** Adding one in `research` would be vacuous by §above;
   adding one in `record-extraction` is Rule-10 blocked. Leaving it out is what avoids creating
   the first state-dependent vacuous skip, the hole `harness/orchestrator.py:1784` names as
   unchecked. The validator is therefore wired and proven but **dormant in every eval suite**
   until #2173 unblocks `record-extraction` — stated here because a reviewer must not read it as
   eval coverage.

### Cost

One `research` run, owed anyway: #3077 changed `person-read-driscoll-attached-sources.json`,
which `research/v8.json` embeds. The validator half costs nothing.


## Review findings folded in (blind battery + drift-critic)

Three independent reviews ran after the code was written. What they changed:

- **BLOCKING, found twice independently.** `log_entry.query` is a required **object**
  (`research.schema.json`), and all 330 committed log entries are dicts. The first validator did
  `str(entry["query"])`, which compares a Python dict repr against prose and can never match — so
  the only working needle was the internal log id, and the check would have **rejected essentially
  every correct reply**. Its own unit tests passed only because my fixture used a `query` string,
  a shape the schema forbids. Fixed: needles come from the query object's person values; the
  fixture is schema-shaped; and one test is now driven from a real committed scenario so the
  fixture and production cannot diverge again.
- **Code reuse.** The delta was hand-rolled 390 lines below `from validators_lib import
  new_log_entries`, already imported in the same file and used twice in it. Now calls it.
- **`"log_1" in "log_10"`.** A different, saved record's id exonerated the unsaved one; real ids
  run `log_001`+. Now matched on a word boundary.
- **The predicate tested the opposite of the clause.** Clause 4 is "named **as unsaved**", but the
  check was "mentioned", so a reply naming the record while falsely claiming it was saved passed.
  Now requires an unsaved marker.

### Declared limits, not oversights

- **The record half is not mechanically checked**, only the person. A reply paraphrases ("the 1880
  census hit") where the entry stores a catalogue title ("Catholic Parish Registers, King's County,
  Ireland"); requiring that to match would reject correct replies, and wrongly blocking legitimate
  work is the costlier failure direction.
- **Prose and validator scopes differ.** The rule sits in the bounded-turn paragraph; the validator
  fires on any tagged test. Widening the prose means editing `SKILL.md` again, which restales v9
  and buys a second paid run for a dormant check. Left as-is deliberately.
- **`search-records/SKILL.md:684` already states clause 4's substance more sharply**, in the skill
  that actually writes the log entries. The router-level sentence is the weaker of the two and is
  additive, not a replacement.
- **v9 proves the rule did not regress the ten routing tests — nothing more.** All ten runs record
  `test_an_unsaved_find_is_named` as `skipped: not an unsaved-extraction test`.
- **A `None` id in `before_state` masks later entries** — a flaw inside the shared
  `new_section_entries`, affecting four other validators equally. Not fixed here; fixing it changes
  their behaviour and belongs in its own change.
