# Guardrail bypass: enforce coherence at the write boundary — Plan

**Status:** not built. Replaces the per-turn detector sketched for issue #940 ask #3,
which was withdrawn after adversarial review (see §6). Parent plan:
`docs/plan/research-guardrail-bypass-plan.md`.

## 1. The reframe

Everything hard about the detector design came from asking **"which skill wrote
this?"** Provenance needs caller attribution, a scope decision ("what is a run,
in a session that lasts weeks?"), per-turn state snapshots, a tuned recency
window, and a second copy of the logic in an environment that cannot import the
first. Adversarial review found three of those load-bearing and wrong, and one
already-shipped check firing on seed state.

But the *harm* in every confirmed case is not "a skill was skipped." It is **a
document that contradicts itself** — and `research_append` already holds the
document when the write arrives. §4.2 established exactly this pattern
(`research-append.ts:194-204`), it is caller-agnostic, and it binds in Cowork,
the hosted workbench, and both harnesses today with no machinery at all.

So: **stop policing who wrote it; make the incoherent state unwritable.**

## 2. The rule that does the work

> A question may not be concluded `proved` or `disproved` while any conflict in
> the project is left `unresolved` and unaccounted for by that proof summary.

**The default must be inverted, and this is the whole design.** The obvious
formulation — "every conflict whose `blocks_question_ids` names this question
must be resolved" — is **worthless**, because the agent writes
`blocks_question_ids` too. Measured against the corpus it fires **0 times in 113
runs**, including on `eulogia-gatica-burial`, the case it was designed for:
there `c_001` carries `blocks_question_ids: []` and `ps_001` carries
`resolved_conflict_ids: []`. An agent that skips the conflict skips the link to
it. Any invariant keyed on a link the bypasser controls is toothless by
construction.

Inverting it — an open conflict counts against every conclusion unless the
summary positively accounts for it — measures as follows across the 113
committed e2e runs (20 `proved`/`disproved` summaries):

| Fires on | Verdict recorded | `conflict-resolution` invoked | Genuine? |
|---|---|---|---|
| `eulogia-gatica-burial/run-2026-07-28_17-07-48` | judge `pass` | no | yes — known bypass |
| `cruz-corona-ancestry/run-2026-07-13_04-12-41` | `partial` | no | yes — known bypass |
| `ferber-marriage/run-2026-07-21_13-02-59` | **`pass`** | no | yes — **not previously known** |

**3 hits, 3 genuine, 0 false positives.** The `ferber-marriage` case is new:
`c_002` (who signed the parental consent) left `unresolved` under a `proved`
tier, on a run recorded as a pass. #913's sweep could not see it — that keys on
conflict-resolution's *analytical product*, and here no analysis was ever
written. Keying on the outcome finds cases keying on provenance cannot.

Two supporting rules, same shape and same file:

- **A summary may not claim a conflict is resolved when it isn't.** Every id in
  `resolved_conflict_ids` must name a conflict with `status: "resolved"`. Fires
  0 times today; it is the cheap closure of the escape hatch §2's rule opens
  (list the conflict, don't resolve it).
- **A new tree person receiving facts requires a `person_evidence` entry.** The
  `materialize_facts` identity-bypass route (`research-guardrail-bypass-plan.md`
  §4.1), and the harm `bagley-father-1884` did: a father added to the tree with
  no identity pinning at all.

## 3. Where it lives

`packages/engine/mcp-server/src/tools/research-append.ts`, beside §4.2's gate,
plus the tree-write path for the third rule. One implementation, one language,
Vitest, no duplication.

That location is the entire argument: the MCP server is the one component every
environment shares. No hook, no plugin file, no `agent_id`, no scope decision,
no window to calibrate, no #911 dependency, and nothing to keep in sync.

Validation is the corpus itself — the 113 committed `*.final-research.json`
files are the regression set, and the measurement in §2 is reproducible against
them.

## 4. What this deliberately does not catch

**A skipped skill whose output is coherent.**
`hole-parents-negative/run-2026-07-22_11-27-49` is exactly that: the router wrote
conflict-resolution's full independence + weighing analysis itself and marked the
conflict `resolved`. The document is self-consistent, so no invariant can object.
Only provenance catches it — that is §4.1's window, which is blocked on #911's
calibration regardless.

This is a real and permanent limit, not an oversight. The trade is: catch the
cases that produce wrong genealogy, in every environment, now — rather than
catch all cases, in one environment, after a calibration that has not finished.

## 5. Sequencing

1. Land the §2 rule with the corpus measurement as its test fixture set.
2. Land the two supporting rules.
3. Re-run the corpus scan; anything newly firing is either a bug in the rule or
   a case worth adding to #913's ledger. Decide which, per hit.
4. Only then revisit whether a provenance check is still wanted.

## 6. Adversarial review of the withdrawn design

The detector plan this replaces was reviewed and did not survive. Recorded so it
is not re-proposed:

- Three of the four arms of `find_effects_without_invocation` read
  whole-document state with no baseline (`skill_invocation.py:289-297`,
  `:299-318`, `:349-357`); only the person-evidence arm takes `starting_tree`.
  At per-turn scope they latch permanently after the first legitimate write.
- The proof-conclusion arm's `has_conclusion_relationship` (`:307-309`) is true
  for any tree holding a `ParentChild`/`Couple` relationship — which every
  FamilySearch-seeded project does. Per-turn it fires on turn 1 in response to
  "hello."
- A hosted "turn" is one user *message* (`real_agent.py`'s `handle_turn`), and an
  autonomous research request is the entire run — the cited e2e runs are each a
  single `query()`. Per-turn scoping does not bound the case it was introduced
  for.
- The `snapshot.py`/`snapshot.ts` shared-vector precedent does not transfer:
  those pin a total normalisation function, these are heuristics over a
  changing schema, so vectors certify only the branches they already cover.

## 7. Open questions

- **Multi-question false denial.** In a project with several open questions, an
  unresolved conflict irrelevant to question B still blocks concluding B until
  the summary names it. That is the correct default (it forces a positive act
  rather than silence), but it is the one place this can annoy a real user. Zero
  instances in the corpus — every run that fired was a genuine bypass — but the
  corpus is thin on multi-question projects.
- **The error message is the whole UX.** A denial the model cannot act on
  becomes a retry loop. It must name the conflict id and the two ways forward
  (resolve it, or account for it), the way §4.2's message names its fix.
- **Rule 3's scope.** "New person receiving facts" needs a precise definition at
  the tree-write boundary; a person created and populated across two calls must
  not slip through the gap.
- **Unlinked supporting assertions.** A fourth candidate rule — every
  `supporting_assertion_ids` entry must have a `person_evidence` link — fires on
  3 summaries in the corpus (`bottemiller-parents`, `cruz-corona-ancestry`,
  `ferber-marriage`), 8/31, 3/12 and 4/20 assertions respectively. Not included
  above: unexamined, and a partial-linkage pattern may be legitimate for
  assertions that are not about the concluded person. Triage before adopting.
