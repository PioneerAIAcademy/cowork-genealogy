# ADR-0009: Keep a standing ledger of refuted agent-design claims

> **Read before you:** propose a `same_person` write-boundary discriminator ·
> propose "routing as a tool" as the fix for a routing failure · quote a
> compliance rate, a violation count, or a cost figure from an older write-up ·
> argue that skill `model:` pins are an eval/production fidelity gap · argue the
> unit harness would deny the router `research_append` · vet an issue whose
> premise is one of the rows below.

- **Status:** Accepted
- **Decided:** 2026-08-09
- **Last updated:** 2026-08-30 (the compliance-rate row's anachronism clause
  withdrawn; constraint 6's fire-rate figure annotated with the deny-mode run
  that met it. Previously 2026-08-09, promoted from
  `docs/agentic-system-critique.md` §9, which was retired; constraint 6 added)
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `.claude/agents/task-reviewer.md`, `.claude/skills/review-ready/SKILL.md`, `docs/specs/guardrail-enforcement-spec.md`, `docs/architecture.md` — *linted; keep current*
- **Related:** ADR-0002, ADR-0003, ADR-0006; issues #1006, #1012, #1015, #702, #941

## Context

This system was reviewed five times over three weeks. Each pass refuted claims
the previous pass had asserted with confidence, and several of those claims came
back — proposed again, by a different reader, from the same evidence, because
nothing recorded that they had already been tried and failed.

That is the specific failure this file exists to prevent. It is not a critique
and it is not a plan: **it is the negative record.** A row here means the claim
was stated, tested against the repo or the run-log corpus, and found wrong.
Re-deriving it costs a review cycle every time.

Three consumers already cite it by name and reason about it as a
do-not-re-derive guard: `.claude/agents/task-reviewer.md` (which reads it when
vetting an issue's premise), ADR-0006 (which sends anyone proposing a fourth
`same_person` discriminator here first), and `docs/adrs/README.md`. It was
§9 of `docs/agentic-system-critique.md` until that document was retired — the
rest of the critique had become a status snapshot that rotted, while this half
stays true forever, which is why only this half survived.

The rows are verbatim in substance from the five review passes. Source-line
citations have been converted to symbol references, per the ban in
`packages/engine/mcp-server/tests/packaging/doc-links.test.ts`.

## Decision

**Keep the refutation ledger as an ADR, add to it whenever a proposal is
refuted, and never delete a row.**

Before proposing any of the designs in the "Read before you" line, read the
matching table. If your proposal is a row here, either it is the same proposal
(don't) or it differs in a way you must state explicitly, against the recorded
failure rather than into a vacuum.

### rev. 1 claims, refuted in the rev. 2 pass

| rev. 1 claim | Why it was wrong |
|---|---|
| **Routing-as-a-tool is the headline P0, and will drive guardrail violations to zero** | The router invoked `person-evidence` in **all five** 2026-07-30 failures. The gap is inside the skill (`same_person` not called), not in the route to it. Only 6 of 17 routing rows are computable, and those six were never failing. Demoted to a P2 spike |
| "The routing table … is 431 lines of prose" | 431 is the **whole file**. The table is **17 rows**. The other ~390 lines are autonomous-mode, iteration, the extraction/conflict contracts, hard rules and verdict handling — none of it movable into a tool |
| "The single largest unanchored rule we own" | Unmeasured. `docs/plan/research-performance-2026-07-27.md` scopes its audit to `search-records` and says the per-skill audit "should not be assumed" |
| "35 successful `Edit` calls to research.json" | **33** (12 / 13 / 8). The extra two were `settings.json` writes, **both denied** |
| The POSIX-only path split is why those writes landed | All three runs made **zero MCP calls** (#941). The agent had no writer tool. The guard was a no-op *and* irrelevant to the outcome |
| The 8/25 compliance rate stated as settled fact | Every measurement here is computed over the eval corpus and the detectors are uncalibrated, so the rate answers no production question — `docs/architecture.md`'s "What nothing checks" now says outright not to quote a violation rate or graduate a gate on one. **Half of the original refutation is withdrawn, 2026-08-30:** it also argued that 16 of the 25 violations came from an arm that "cannot be separated from its own introduction date." Issue #1006 closed COMPLETED on 2026-08-17 settling the opposite — a doctrine gap, not an anachronistic check — so those 16 are real violations. The claim stays refuted on the calibration argument alone |
| 26 skill `model:` pins are an eval/production fidelity gap | All 26 pin `claude-sonnet-4-6`, which **is** `DEFAULT_MODEL`; only the unit harness reads them. They are dead lines, not a gap. Delete them |
| `gps-mentor 1` listed among skill invocations without qualification | It ran **25× as an Agent** in the same window, including in every failing run. The mentor gate is not being skipped |
| "Adds no cost" framing for a new routing tool | A tool call is a turn, and turns are the cost |

### rev. 2 claims, refuted in the rev. 3 pass

| rev. 2 claim | Why it was wrong |
|---|---|
| `research_query` "**silently** truncates" | The response has carried `truncated` + a pre-cap `count` since the tool shipped on 2026-07-26 (`packages/engine/mcp-server/src/tools/research-query.ts`), five days before rev. 2. The defect is missing pagination and an ignored flag, not silence |
| "A suite built today would **deny** the router `research_append`" | Backwards: `compute_allowed_tools` (`eval/harness/harness/allowed_tools.py`) unions `@plugin:gps-mentor`'s `tools:` into the router's allowlist, so a suite would *grant* it — and nothing denies the router using it inline. The real gap is held-only-for-the-subagent tools; #1012 is the inverse — a `Skill()` callee runs toolless |
| The ferber agent escalated permissions and "**only then**" wrote raw | The first raw `Edit` (idx 33) precedes every denied settings attempt (idx 46, 102); 9 of 13 writes precede the last one. Escalation was interleaved with the writes, not a prelude — a tidier story than the log supports, the same failure mode this ledger exists to catch |
| "46 MCP tools" / "all 26 skills with suites" | 48 (`allToolSchemas`) and 25 (27 skills − `research` − `forget-and-rederive`) |
| "a tool call is a turn," stated as law | The cited plan's own data: ~2.1 calls/turn, with parallel calls amortizing. Direction right, arithmetic wrong |
| The unconditional `same_person` gate (P0) and the 16-violation arm read as pure doctrine gap | The owning skill's contract exempts FTS-/image-/PDF-sourced links (`packages/engine/plugin/skills/person-evidence/SKILL.md`, its `match_score` typing) and the no-candidate stub path; the detector enforces the router's broader paraphrase. Conditions added in rev. 3's P0; the canonical-doctrine decision moved into the calibration exit |

### rev. 3 claims, refuted in the rev. 4 pass

| rev. 3 claim | Why it was wrong |
|---|---|
| "Conditioning on a pre-existing `person_id` exempts a stub's first link naturally" | The skill's flow creates the person via `materialize_facts` in a *prior* call and writes the `pe_` links in a separate append (bagley: idx 85 → 86), so at the append's pre-call snapshot the person always exists — including for the compliant introducing-record links. Record identity was rev. 4's replacement answer; it failed too (next table) |
| The conditioned gate "touches 16 of the 25 measured violations" | Inherited from the unconditional rev. 2 version. 7 of the 16 flagged persons have zero record-sourced links (null `record_persona_id` throughout, by schema design), so the conditioned gate's reach is ≤9 of 25 |
| Held-only-for-the-subagent tools cited as #1012 | Wrong issue. #1012 is the inverse — a `Skill()` callee runs toolless in the unit path |
| "~70 open issues"; 20-fixture pass "≈$185"; "(26 suites)" | 115 open as of 2026-08-01 (91 pre-wave); $150–165 from the corpus's own per-run stats; 25 suites — a correction rev. 3 applied in one place and missed in another |
| "Exactly two are genuinely novel," counting the quantified compaction-decay law | Chen, "Governance Decay", [arXiv:2606.22528](https://arxiv.org/abs/2606.22528) (June 2026) quantified compaction-driven constraint decay a month earlier — verified against arxiv.org 2026-08-02. The production-derived decay horizon remains distinctive; "no public precedent" does not |

### rev. 4 claims, refuted in the rev. 5 (narrow) pass

| rev. 4 claim | Why it was wrong |
|---|---|
| The record-identity exemption "exempts the stub's introducing links and still catches bagley's cross-record links" | A project's *first* pe batch has an empty pre-call pe → assertion → `record_id` join — bagley's idx 86 is a 30-op first batch across three persons, so the gate denies all 30 links, introducing ones included; a tree-source-ref basis instead exempts all 30; and the violation actually commits at idx 85 (`materialize_facts` attaching unscored refs to existing persons) before any pe append exists to gate. "A `same_person` result on record" also named no mechanism — nothing persists `same_person` output, and `research-append-tool-spec.md` records that `match_score` is caller-fabricable. The P0 is now spec-first with named constraints |
| "bagley: `materialize_facts` at idx 85, **all 13 links at idx 86**" | Idx 86 is a 30-op batch across three persons carrying 11 of I1's 13 links; the other 2 land at idx 141, from a fourth record. The idx-85 → 86 ordering argument stands; the count did not |
| 20-fixture pass "≈$150–165" | The doc's own median gives $145.80 — the low bound is ≈$146 |

## The `same_person` write-boundary gate: six constraints any design must satisfy

Three discriminators failed adversarial review (the tables above record each).
A fourth now runs in **shadow** — the live pre-write provenance check in
`docs/specs/guardrail-enforcement-spec.md` §4 and §8. So the open question is
**graduating that check to a deny**, not deriving a fifth. Any design, including
a graduation, must satisfy all six:

1. **Provenance.** Distinguish create-refs from enrich-refs at
   `materialize_facts` time, and gate there too — the tree write is where the
   violation lands, so a `person_evidence`-append gate alone cannot be the
   enforcement point.
2. **An attestation — but note the owner has already decided against holding out
   for a non-fabricable one.** Nothing today persists `same_person` output.
   `docs/specs/research-append-tool-spec.md` records the 2026-08-01 decision
   (#1006): validate `match_score`'s **presence** on the
   `personEvidenceInvariants` path, explicitly conceding that presence does not
   prove the call happened, and *"do not over-engineer past this."* The stronger
   counter-design — `same_person` persisting a (person, record, persona)-keyed
   attestation the writer tools check — is not what was decided; propose it
   *against* that decision, not into a vacuum.
3. **Persona granularity.** Key on (`record_id`, `record_persona_id`), not
   `record_id` — bagley's `QPQP-R8T8` carries ≥3 personas, and a record-level
   exemption lets a second persona of an already-linked record attach unscored.
4. **Batch semantics.** Keep `proofSummaryInvariants`' pre-call-state discipline
   (`docs/specs/guardrail-enforcement-spec.md` §5, "Prefer this shape") with
   defined handling for an assertion and its link arriving in one batch.
5. **Demand the call, not a score threshold.** An ark-less stub legitimately
   returns a degenerate score the skill must treat as *no score*.
6. **Satisfiability.** State **which call shape satisfies the gate, and how often
   agents actually produce that shape.** A constraint an agent cannot practically
   meet is a denial of service, not a guardrail — and none of constraints 1–5
   would have caught this, because all five reason about what the gate *checks*
   and none about what a compliant run *looks like*.

   The shipped shadow check is the worked case, and
   `docs/specs/guardrail-enforcement-spec.md` §4 owns it — read it there rather
   than re-deriving it, and re-measure rather than quoting a count off a page.
   In outline: `tree_edit` mints local ids (`I1`) and rejects caller-supplied
   ones, while `same_person` scores `primaryId1`/`primaryId2` *inside the
   caller's own gedcomx documents*, so the one satisfying shape is to pass the
   tree side as `gedcomx2` with `primaryId2: "I1"` — **which agents produced in 3
   of 103 corpus runs.** A deny shipped on the fire rate alone, with the reason
   text as it stood, would therefore have rejected essentially every run that
   links a new person, at $7–25 a run.

   **Do not read that number as "a deny cannot ship" — it has since been tried
   and the agent recovered inside the run (2026-08-30).** With the reason
   rewritten to name the satisfying shape, `hannah-earnest-children`'s
   2026-08-23 run at `PERSON_EVIDENCE_GUARD=deny` took **two** denials (both
   `valve_released: false`, so the gate genuinely blocked them) and then issued
   **eight `same_person` calls, six of them in the satisfying
   `primaryId2: "I<n>"` shape**. The run did fail, on unrelated
   `proof-conclusion` and `conflict-resolution` bypasses — not on a wedge, and
   not on the loop valve. One run is not a graduation case, but it is a direct
   observation of the mechanism this constraint predicted: the fire rate priced
   an agent that had not been told the shape, and teaching it is the lever.

   **What makes this a constraint and not just a bug:** the gate is *achievable*
   — a live probe scored a minted, ARK-less tree person at 0.9999484 against a
   0.999967 control — so the fire rate was measuring an agent that did not know
   the call shape, not a gate that could not be met. A fire-rate number
   distinguishes none of that. An impossible gate, a mistuned one, and an
   achievable one the agent has been told to skip all look identical from the
   count, which is precisely why the satisfying shape has to be stated up front
   rather than inferred afterwards.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Keep the whole critique document** | The other eight sections were a dated status snapshot: priorities that shipped, counts that drifted, "Direction" notes duplicating `docs/architecture.md`. It was cited by path from ten places and by section from a dozen more inside `architecture.md` alone, and every one of those went stale together. §9 is the only part that stays true by construction | The retirement decision, #1309; ~13 `critique §N` prose references in `docs/architecture.md` that no lint could see |
| **Delete the refutation tables with the rest** | Three consumers read them as a do-not-re-derive guard, and the ledger's whole value is that it survives the reader who was not in the room. Two of the three `same_person` discriminators were re-proposed *after* being refuted once | `.claude/agents/task-reviewer.md`; ADR-0006's "read … before proposing a fourth" |
| **Move the tables into `docs/architecture.md` §10** | That section is "open questions" — things not yet decided. These are the opposite: things decided *against*. Filing them there would make the guide the owner of a growing append-only history, which is exactly what the ADR tier exists for | `docs/adrs/README.md` rule 3; `docs/architecture.md` §0 "The three tiers" |
| **A seventh constraint for every future failure** | The constraint list is not a changelog. A new constraint is warranted only when a failure mode none of the existing six would have caught is *observed* — which is the test constraint 6 passed | This ADR's own §"six constraints": 6 exists because 1–5 all reason about what the gate checks and none about what a compliant run looks like |

## Consequences

**Gains.** The negative record outlives its authors and its review passes. A
reviewer vetting an issue can check its premise against a list instead of
re-running the analysis, which is what `.claude/agents/task-reviewer.md` and
`.claude/skills/review-ready/SKILL.md` already do. Constraint 6 makes the class
of failure the ledger caught into a rule the next proposal is checked against.

**Costs, knowingly accepted.** A ledger of refutations grows and is never
pruned, so it gets longer and less navigable over time, and the "Read before
you" line has to carry more of the routing. Some rows will eventually describe
code that no longer exists — they stay anyway, because a refutation is about a
line of *reasoning*, and the reasoning comes back even when the code does not.
This ADR is also unusual in shape: most ADRs record one decision, this one
records the decision to keep a record. That was judged better than a fifth
tier of documentation.

**Risks.** A row here can itself be wrong — a refutation is a claim like any
other. Nothing re-verifies these rows on a schedule, and the numbers inside them
(counts, dollar figures, idx offsets) are frozen at the pass that measured them.
Read them as "this argument was tried and failed, for this reason," not as
current measurements. Current measurements live in `docs/architecture.md` §9 and
in `make e2e-corpus`.

## Enforcement

> `packages/engine/mcp-server/tests/packaging/adr-links.test.ts` — every repo
> path cited in this file's **Applies to** line and this section must resolve,
> and this ADR must appear in `docs/architecture.md`'s ADR index.

> `packages/engine/mcp-server/tests/packaging/doc-links.test.ts` — the citation
> to this file from `.claude/agents/task-reviewer.md` must resolve, so a rename
> breaks CI rather than the next reviewer. (`.claude/skills/review-ready/SKILL.md`
> reaches it only by fanning out that agent, so it carries no path of its own.)

What neither catches: that a *new* proposal was checked against these tables.
That is a review obligation, carried by the "Read before you" line, by
ADR-0006, and by `docs/specs/task-review-spec.md`. Nothing mechanical can see a
re-derivation.

*Linted: every path in this section must resolve.*

## Revisit when

> A failure mode is observed that none of the six `same_person` constraints
> would have caught — then add a seventh, with the observation as its evidence.
>
> Or: a row below is shown to be wrong. Correct it in place with the new
> evidence; do not delete it, because the claim will be proposed again and the
> next reader needs to know it was examined.
