# Converting a skill into a skill-agent pair

**Read this before Phase 4.** It is the measured record of the first conversion
(`proof-conclusion`, 2026-08-19/20) and the rules that follow from it. The
conversion took nine paid eval runs; most of that was avoidable, and this
document exists so the next one does not repeat it.

Pairs are still the right instrument. Only an agent carries an `agent_id`, and
attribution is what the whole enforcement programme is built on. Nothing below
argues against pairing — it argues about *what to move, in what order*.

## 1. A conversion destabilises tests that were stable

Measured over five runs each, `proof-conclusion`'s 21-test suite:

| | tests changing outcome across 5 runs |
|---|---|
| before the fold | **5 / 21** — and three of those were *aborts*, i.e. execution failures, not behaviour. Two genuine flips. |
| after | **10 / 21** |

The five tests that consumed the entire effort — 004, 007, 011, 015, 018 — were
each a clean pass in **all five** pre-fold runs. They were not pre-existing
flaky tests that the conversion exposed. The conversion made them unstable.

**So: do not start a conversion by assuming the suite was already shaky.** Pull
the last few run logs first and write down which tests are stable. That baseline
is the only thing that tells you later whether you are fixing or breaking.

## 2. A prose gate weakens when it crosses a delegation boundary

This is the one structural cost, and it is specific rather than general.

A rule stated in a monolithic skill runs in the same reasoning pass as the work
it governs. Move it into an agent and it runs *after* a delegation, in a context
that has just received an instruction from a caller. The caller's framing then
competes with the rule. Three distinct failures, all observed on one test:

- **The caller instructs the outcome.** A delegation reading "Write a
  GPS-conformant proof conclusion for q_NNN" overrode a hard-blocking gate; the
  agent wrote past it. This is already on record for `record-extractor` — see
  the birkeland note in `research-append`'s sibling `extraction-append.ts`, where
  a delegation message pushed the extractor past its own lane rule.
- **The caller pre-judges the gate.** Given a query tool, the routing skill read
  the conflicts section itself, decided a conflict was "collateral", and
  delegated anyway — deciding the agent's gate from the one participant that
  cannot see the evidence.
- **The gate becomes arguable.** Once it is prose in a body reached by
  delegation, the agent can argue either side: declining with the gate passing,
  or concluding with it failing, in successive runs on the same fixture.

**So: move the rule into code BEFORE moving the prose.** A writer-tool
precondition kept working through every one of the above. The one rule that was
moved into `research_append` produced a clean refusal-then-comply on the first
run after it landed, and never regressed.

**And make the routing skill thin in capability, not just in wording.** It
should hold the tools it needs to route and nothing more. A skill told in prose
not to judge, but handed a query tool, judged.

## 3. The fold is faithful; the follow-up edits are the risk

Measured against the pre-conversion skill:

- **96%** of the original doctrine moved over verbatim (349 of 365 lines)
- the subsequent fixes then **added 102 lines** — 28% growth
- and those additions were concentrated in the two highest-traffic decision
  areas: the preconditions gate and tier selection

The instability tracks the additions, not the move. The traceable case: a
sentence added to the *gate* to fix an over-declining problem also stated which
tier thin evidence lands on. That steer broke a tier test on the next three
runs. Repairing that broke a second tier test; repairing that broke a third.

**So: fold verbatim, run it unchanged, and only then fix anything.** Establishing
the pair's own baseline is one run and it is the cheapest run in the project.

**And keep a fix inside the section it belongs to.** A gate rule that mentions
tiers is a tier change wearing a gate's clothes.

## 4. Determinism surfaces defects that judge grading hid

Converting judge-graded expectations into validators found five real problems
that had been invisible while the suite was green:

1. A fixture that **contradicted itself** — one grading line accepted a tier the
   next line forbade. It had been passing for months.
2. A fixture that was **unsatisfiable** — it accepted a tier below the
   tree-encoding threshold while requiring the tree write that tier can never
   produce.
3. A validator that **guarded nothing** — reverting its rule to a weaker one
   left the entire harness suite green.
4. A **judge misgrade** — a dimension scored fail on a rationale whose every
   sentence was affirmative. Visible only by reading rationales, never by
   reading scores.
5. A **duplicate-summary defect** — the agent appended a second summary for a
   question instead of updating the existing one, leaving contradictory entries.
   No judge dimension caught it; a state check caught it immediately.

**So: audit the fixtures before converting.** Under a monolithic skill an
impossible fixture can pass by luck. The conversion removes the luck, and you
will spend runs chasing the fixture believing it is the skill.

**And when a test is about a persisted fact — a tier, an id, an encoded
relationship — assert it in a validator, not in judge prose.** A validator names
the defect in one line; a judge gives an opinion that moves between runs.

## The process, in order

1. Record the pre-conversion baseline from existing run logs.
2. Audit that skill's fixtures for self-contradiction and unsatisfiability.
3. Move any rule that must *hold* into the writer tool. Prove it fails first.
4. Fold the prose verbatim. Delete `references/` — an agent reading its own
   reference files is measured unreliable and silent.
5. Give the routing skill only the tools it needs to route.
6. Write the delegation message so it asks for the work, never for the artifact.
   "Write a proof conclusion" overrides a gate; "conclude if the preconditions
   hold" invites an over-decline. Ask for the work and let the body decide.
7. Run once, unchanged. Compare against step 1.
8. Fix one thing per run.

## What is still open

- **Tier selection resisted every prose fix.** Three successive wordings each
  repaired one test and broke a neighbour, so the tier ladder was reverted to
  its pre-conversion text. Whether tier selection is stable in a pair at all is
  unmeasured — the original table has never been run against the folded agent.
- **No conversion has been proven in Cowork.** The pair, the hook's caller
  check, and the matcher are all unverified against a live session; no CI job
  reaches that runtime.
