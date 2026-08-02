# Agentic system critique — orchestration, skills, tools, and evals

**Date:** 2026-08-01 (rev. 5, after a fourth — narrow — adversarial pass) · **Scope:** the
`/research` orchestrator, the 27 plugin skills, the 4 plugin agents, the 47 MCP
tools, and the two eval harnesses — specifically the mechanisms that bind them
together: how the router picks a skill, how a skill picks a tool, how they agree
on a schema, and what stops any of them from doing another's job.

**What this file is for.** A read of the system as it stands, benchmarked
against how comparable production agent systems are built, and a prioritized
list of what to do next. It is a critique and a work list, not a plan — each
item that gets picked up should get its own plan or issue.

**Evidence base.** 133 committed e2e runs (`eval/runlogs/e2e/`), the latest unit
run log for the 25 skills with suites, the specs under `docs/specs/`, the
measured performance work in `docs/plan/research-performance-2026-07-27.md`, the
plugin bodies, the packaging lints, and ~170 open issues (115 before `docs/TODOs.md`'s 54 items were filed as
#1117-#1157 on 08-02). Numbers cited are reproducible from the repo —
see §7.

> **rev. 5 supersedes rev. 4 after a fourth, deliberately narrow pass** — a
> fresh-eyes attack on only the rev. 4 diff, because each revision's errors
> have concentrated in its newest text. It refuted the third consecutive
> `same_person` gate discriminator (record identity via the pe join —
> deny-everything at a project's first batch), so that P0 is now **spec-first**
> with five named design constraints rather than a mechanism this document
> keeps guessing at. The §7 numbers have reproduced on every pass; §9 now
> carries four tables. Read §9 before treating any earlier framing as current.

---

## 0. Executive summary

**Three findings.**

**0.1 — We proved the right law and have not applied it to the router's
judgment rows.** `research-performance-2026-07-27.md` §5.3 is the strongest
piece of agent engineering in this repo: across 309 turns of a real session,
every rule with a **structural anchor** held at **100%**, and **both rules that
decayed had none** — the ranking doctrine from 77% compliance to **3%** once
compaction evicted the skill body. We acted on that for `record_search` (the
ranking fold, C7). The routing table — 17 rows at `research/SKILL.md:128-146`,
inside a 431-line body that is resident longer than any other in the system — is
still prose.

**The law runs one direction only.** An anchor *guarantees* survival; the absence
of one merely *permits* decay. It is not the converse — "unanchored" does not
predict failure. The audit's own table lists **three** unanchored rules and one
of them **improved**: `givenName` went 54% → 94%, annotated "Not decay — the
early surname-only queries were deliberate broad sweeps. Rate *rose*." So the
inference an anchor licenses is one-way, and an unanchored rule still has to be
measured before it is called a problem.

Three caveats that rev. 1 got wrong and that constrain what follows. First,
**whether this is in fact the largest unanchored rule we own is unmeasured**:
`research-performance-2026-07-27.md:692-697` explicitly scopes its audit to
`search-records` and says the per-skill audit "should not be assumed." No
compaction-segment audit of `research/SKILL.md` exists; doing one is cheap and
should precede any structural change to the router. Second, that same scope note
**exempts plugin agents entirely** — they run in fresh context per invocation, so
`record-extractor` (48 KB) and `gps-mentor` (34 KB) reload every time and
cannot decay this way; nothing below about anchoring applies to them. Third,
**only 6 of the 17 rows are mechanically computable** (§3, P2 spike) — and those
six are the ones that were never failing.

**0.2 — The dominant failure mode is process compliance, not genealogy — but the
instrument measuring it has three open defects, two unnamed false-positive
classes, and one false-negative blind spot (see the P0).** Since the post-run compliance
detector shipped (#914, 2026-07-27), **8 of 25** e2e runs carry at least one
guardrail-bypass violation. In the five failing runs of 2026-07-30 that
completed (the window §7 describes — they are not the five most recent on the
committed corpus) the LLM judge scored the *genealogy* **pass on three and partial on
two** — every one was failed by the detector.

> **On the full committed window that rate is worse, not better: 12 of 29 runs
> and 45 violations (§7).** The 8/25 window stops at `2026-07-30_19-43-58` and
> drops timed-out runs. The narrow window is retained here because §3's P0 and
> §9's "≤9 of 25" gate-reach figure are stated against it.

**That rate is a floor with an unquantified false-positive rate and should not
be quoted without this caveat.** The arm producing **16 of the 25** violations
(34 of 45 on the full window) is `find_person_evidence_missing_same_person`.
**16 is a count of violations, not of what a gate could prevent** — §3's P0 puts
the reach of any gate consistent with the skill contract at **≤9 of the 25**,
because 7 of the 16 flagged persons have zero record-sourced links (§9, rev. 3
row). It is the subject of **#1006**, which was
**settled 2026-08-01: this is a doctrine gap, not a check measuring its own
introduction date.** Splitting every run with a tool ledger on the doctrine's
landing date shows compliance *falling* afterwards (27% before, 19% after) and
`same_person` calls predating the rule by three weeks (see the P0). **#998**
documents a second arm firing on seeded tree state with no `starting_tree`
baseline (3 of the 25). **#999** documents that `is_error` is never populated,
so a *failed* `Skill` call is credited as a successful invocation across all four
checks. Calibrating these is a prerequisite to acting on the rate, not a
follow-up.

**The most frequent violation is not a routing failure.** In all five
2026-07-30 failures `person-evidence` **was invoked** (1–2× each) and
`gps-mentor` ran as an Agent. The skill ran and did not score identity:

| Run | `person-evidence` invoked | `same_person` calls | Violations |
|---|---|---|---|
| isabel-carvajal-daughter | 1× | 0 | 5 |
| heinrich-zinsmeister-death | 1× | 0 | 1 |
| amelia-gioiello-marriage | 2× | 0 | 3 |
| cornelius-booysen-death | 1× | 1 | 5 |
| pierre-desobry-spouse | 2× | 3 | 5 |

`pierre-desobry-spouse` called `same_person` three times and still drew four
"never called for it" violations — the check is per-person, so partial
compliance is the norm rather than wholesale skipping. **The gap is inside the
skill, not in the route to it.** **9 of the 25 violations** — the
exhaustiveness / proof-conclusion / conflict arms, 3+3+3 — are the "router did
the work inline" shape, and only `cornelius-booysen-death` is a clean instance.

> **Two different "9 of 25" figures appear in this document and they are
> disjoint sets, not the same claim.** This one is the inline-shape subset
> (3+3+3 from the non-`same_person` arms). §3's P0 and §9's "≤9 of 25" is the
> *gate-reach* figure — 16 minus the 7 flagged persons with no record-sourced
> links, i.e. the complement. Their union is the whole 25; they do not add.

**0.3 — Everything we know about this system, we know from the bench.**
`apps/server/app/obs.py` is PII-free stdout logging; tool events go to a capped
in-memory replay buffer. There is no durable, queryable tool-call ledger in
production. Every guardrail measurement, cost breakdown, and compliance rate in
this repo is computed over `eval/runlogs/`. Issue #1054 scopes this correctly
(retention first, detectors second) and is the highest-value unshipped
infrastructure item we have. #1091 (filed 07-31) is the same hole seen from the
bench: e2e runlogs record no skill snapshot, so a committed run cannot be tied
to the prompt that produced it.

---

## 1. What this system does that world-class systems also do

These are strengths worth protecting. Most are published best practice — what
distinguishes this repo is that they are *implemented*, where surveyed practice
shows a large recommendation-to-implementation gap (LangChain's State of Agent
Engineering survey: ~52% evals adoption against ~89% observability). On public
evidence, one is genuinely novel — the CI-linted dual-spelling permission
binding (1.3) — and one is independently derived with a production-grade twist
no benchmark gives (1.1).

**1.1 Structural anchoring, measured rather than asserted.** The §5.3 rule audit
(anchor kinds: the tool rejects the violation / the output feeds a step that
cannot proceed without it / it leaves a durable trace) plus the criterion it
yields — *a rule that must hold for hours needs a structural anchor; prose
survives about three compactions* — is stated qualitatively in Anthropic's own
published guidance (deterministic hooks over model choice, "poka-yoke your
tools" in *Building Effective Agents*, the context-engineering post) — and the
quantification itself now has a public precedent: arXiv 2606.22528 ("Governance
Decay", June 2026, one month before this document) measures constraint
violations rising 0% → 30–59% after compaction on a purpose-built benchmark.
What remains distinctive here is the derivation from production: the §5.3 audit
reached the same law from 309 turns of real work and yields an operational
decay horizon (~3 compactions) the benchmark paper does not give.
Two rules were converted on the strength of it — the `count: 50` default and
the ranking fold, both now in `record-search.ts`. (The fold was reported as
verifying 7/7; that result is not recorded in any committed test or runlog.)

**1.2 Capability restriction by tool identity, not by prose or by parameter.**
`extraction_append` is `research_append` narrowed to `sources` + `assertions`,
gated by a **second function parameter** that a tool caller structurally cannot
reach (`research-append-tool-spec.md` §11.2; the table below is §11.1). The accompanying table — prose
lane: no; parameter lane: no; tool identity: yes — is the correct analysis, and
it is backed by an observed failure (the birkeland re-run, where a caller
prompted the agent past its prose lane and it fabricated a `match_score`). The
lane analysis is textbook least-privilege by 2025 (OWASP's Excessive-Agency and
MCP guidance); the value here is the unforgeable enforcement mechanism, not the
insight.

**1.3 Cross-environment tool binding treated as a first-class hazard.** Every
MCP tool in an agent's `tools:` **and** `disallowedTools:` is listed under both
server spellings, because the server's registration key belongs to whoever
registers it and the VM-side plugin cannot control it.
`tests/packaging/agent-tool-names.test.ts` derives the bridge prefix from
`manifest.json`'s `display_name`, so renaming the extension fails in CI rather
than silently in production. The namespacing hazard itself is widely documented
(open issues across at least five frameworks, including Anthropic's own
surfaces, claude-code#18763); what has no public precedent we could find is
treating allow/deny binding across spellings as a CI-linted invariant —
especially the deny side, where a miss is silent. #650/#698
is the scar that produced it. (What it still does not prove is that a declared
tool actually *binds* at runtime — see §2.12.)

**1.4 Validate-before-persist with TOCTOU-aware preconditions.**
`proofSummaryInvariants` snapshots each question's `declared` flag **before** a
batch is applied, so a single atomic call cannot establish a precondition and
consume it. Most systems check final state and ship the hole. The spec even
flags that other same-batch orderings have not been audited — which is the right
way to record a known gap.

**Caveat (#1001):** the sibling completion gate is already half dead.
`research-append.ts:622` tests `c.identity_question === true`, while both schema
mirrors type the field as `["string","null"]` — the identity clause is
unsatisfiable for any schema-valid document, so the gate binds solely through
`blocks_question_ids`, an array the bypassing agent writes itself. The pattern
is right; this instance needs repair before more weight is put on it.

**1.5 Two-tier evaluation with offline judge calibration.** Unit: mocked MCP
fixtures, per-skill `rubric.md`, a deterministic validator per skill, an LLM
judge, snapshot-hashed run logs, and 82 negative routing tests. E2e: live
FamilySearch, 100+ fixtures, blind human `.ann.json` annotations, and
`calibrate_judge` measuring judge-vs-human agreement **offline**, never inferred
from expensive live runs. Grading the grader in the cheap loop is the
published-consensus architecture — critique shadowing in the practitioner
literature, shipped as product by LangSmith and Braintrust. Implementing it puts
this repo ahead of median measured practice, not ahead of the field's knowledge.

**1.6 Compliance detectors that override the judge.** A run whose answer is
right but whose audit trail was not earned is failed — since #1050 via three
top-level axes (`verdict` genealogical, `compliance` guardrail, `outcome` the
gate), so a violation fails the run without rewriting the judge's result. For a
product whose
deliverable is a defensible GPS argument, that is the right objective function —
provided the detectors themselves are calibrated (§0.2).

**1.7 Drift lints as CI, not as convention.** `manifest.tools` ↔
`allToolSchemas`; rubric/judge prose ↔ `allowed-tools`; tool coverage in both
directions; skill/agent frontmatter; byte-identical reference copies; run-log
snapshot and judge-prompt hashes. This is "the prompt is the product" taken
seriously.

**1.8 An explicit refutation ledger.** §7 of the performance plan ("Refuted in
review — do not re-derive") and §9 of the guardrail spec ("Options set aside")
prevent the most expensive failure mode in prompt-shaped systems: re-deriving a
settled wrong answer. It is a focused variant of ADR "considered options"
practice, adapted for the reader that actually re-derives settled designs: a
future agent session. This file adopts the convention in §9.

**1.9 A guardrail layer that reaches every environment.** *(Added in rev. 3 —
rev. 2 discussed the write lockdown only through its eval-side incident, §2.10,
and never credited the production mechanism.)* The lockdown ships as a plugin
`PreToolUse` hook (`packages/engine/plugin/hooks/guard_project_files.py`, #989,
07-30) — the only instrument that can restrain the *main thread* in Cowork,
where session options are not ours to set. It is Windows-safe, was verified
live in Cowork (a canary write hard-denied, the hook's own reason text
surfacing), never raises (every failure path allows the call), and its deny
message names the sanctioned writer tools instead of just refusing — a denied
write is treated as a recoverable mistake, not a stop.

---

## 2. What world-class systems do that this system does not

| # | Gap | Evidence in this repo |
|---|---|---|
| 2.1 | Production telemetry / trace ledger | `obs.py` is logging only; `sandbox_server.py` records to a capped replay buffer; all detectors run on eval runlogs (#1054). Per-call tracing is now *median* industry practice (OTel GenAI semantic conventions; ~89% observability adoption in the LangChain survey) — this repo is below median on exactly the axis it leads everywhere else |
| 2.2 | Deterministic control flow where control flow is deterministic | 6 of the router's 17 rows are mechanically computable and none of them is computed; of the other 11, 7 need judgment outright and 4 are mixed (§3, P2) |
| 2.3 | A cheap test for the component that fails most | No `eval/tests/unit/research/` suite; the router is only exercised by live e2e runs at ~$8 / 55 min |
| 2.4 | Per-step model and effort routing | Effort is session-wide and never set by `real_agent.build_options`; per-step routing exists only via plugin agents. The 26 skill `model:` pins are **dead weight, not a fidelity gap** — 26 of the 27 skills pin `claude-sonnet-4-6` (`forget-and-rederive` never had one), which *is* `DEFAULT_MODEL` (`skill_runner.py:57`), and only the unit harness reads them (`harness/orchestrator.py:206`); the e2e harness never does. Deleting all 26 changes nothing anywhere; leaving them makes per-step routing look like it exists |
| 2.5 | Automated production → eval mining | `mine-unit-test` exists; the trigger is a hand-triaged feedback zip |
| 2.6 | Parallel / tiered e2e | `run_e2e.py` takes one fixture per invocation with no concurrency; a 20-fixture pass is ≈$147–171 (20 × median-to-mean run cost) and ~17–20 h serial, with no budget enforcement |
| 2.7 | Generated schema mirrors | 4+ hand-maintained copies of the closed enums (#1087, #1015, #1014; #1013 closed 08-01 into a retitled #1015); CLAUDE.md needs a three-case table to say which sites an edit touches |
| 2.8 | Unit-side judge calibration | `calibrate_judge` is e2e-only; the unit judge has `.ann` corrections but no agreement metric |

### Specifics that deserve naming

**2.9 `research_query` caps at 50 items with no pagination** (`MAX_ITEMS = 50`,
`research-query.ts:29`; #1031). proof-conclusion's "collect every assertion"
gate saw 50 of 57. rev. 2 called this "silent" — it is not: the response has
carried a `truncated` flag and a pre-cap `count` since the tool shipped on
07-26 (`research-query.ts:243-244`, typed at `:66-71`), and the schema description says to check
the flag and narrow. The real defect is narrower and still real: there is no
way to fetch items 51+ when the filter cannot be narrowed further, and the
consuming skill ignored the flag it was given. A correctness bug wearing a
performance costume either way, and it still undercuts the
projection-over-`Read` doctrine we are trying to establish. Fix #1031's
"silently" framing when touching it.

**2.10 A guardrail was a no-op on the only platform the team runs — but that is
not the interesting part of the incident.** From #914 (2026-07-27) to #984
(2026-07-30), `direct_project_file_write` split paths on `/` alone, so the guard
never fired on Windows. Three `william-ferber-origins` runs on 2026-07-29 wrote
`research.json` raw **33 times** (12 / 13 / 8 — 32 `Edit` plus 1 `Write`), all
successful.

**All three runs made *zero* MCP tool calls.** The genealogy server never
connected (#941, open: *"MCP server silently fails to connect in headless runs
despite green preflight"*), and run `17-05-11`'s log carries the agent's own
diagnosis verbatim: `BLOCKER: mcp__genealogy__research_append tool not found`
(the other two runs carry differently-worded diagnoses of the same failure). So the
POSIX-only split is real, but it is not why the writes happened — the agent had
no writer tool at all.

**The larger finding is what the agent did instead of stopping.** In
`run-2026-07-29_12-16-49.json` the agent worked the permission system *while it
kept writing*: `Glob` for `settings.json` and a read of the **global**
`~/.claude/settings.json` (Globs at idx 21/28, the read at 29), the first raw `Edit` of `research.json`
(idx 33), an attempted `Write` of a permissions allowlist into the project
`.claude/settings.json` (idx 46, denied), `Skill("update-config")` asking it to
*"Add WebSearch and WebFetch to the project allowlist"* (idx 62), an attempted
`Edit` on the **global** settings file (idx 102, denied) — with raw writes
interleaved throughout (9 of the 13 precede the last denied attempt). rev. 2
said the agent escalated first and "only then" wrote raw; the log refutes that
ordering (§9) — the escalation was concurrent with the writes, not a prelude to
them. The behaviour was known before the
incident: the pre-#1173 comment in `eval/harness/harness/auth.py` recorded the
agent "falls back to write JSON directly" — though it attributed the cause to a
flag polarity that turned out to be inverted, so the ferber runs and #941 are
the durable evidence, not that comment (whose text is now deleted). Two
gaps follow, neither of which rev. 1 named — see 2.11.

The narrow lesson still stands: a guard needs a test that runs in the
environment it guards. Per `guardrail-enforcement-spec.md` §6, **no test asserts
the three lockdown copies agree**, so the next change to
`PROTECTED_PROJECT_FILES` can re-open the divergence. One scoped-out risk also
deserves naming: all three copies match only `Write`/`Edit`/`NotebookEdit` — the
`Bash` route is deliberately open (`real_agent.py:132-139`: pattern-matching
command text would false-deny the skills' own stdlib scripts; recorded in
`docs/specs/guardrail-enforcement-spec.md` §6).

**2.11 The system fails open when its tool layer disappears, and a skill is
reachable as a permission-escalation path.** Nothing treats "the writer tools
are absent" as a halt condition (§2.10, #941). Since 07-30 the raw-write
degradation path itself is closed — #984/#989 fixed the Windows split and
shipped the deny as a plugin hook (§1.9), so a repeat of the ferber runs would
flail against denied writes and burn its full budget with *no* output rather
than an unvalidated file. The halt condition is still missing, and nothing
prevents a skill (`update-config`) from being reached for to widen the
session's own permissions. Both remaining gaps are architectural, not
incidental.

**2.12 No check proves a declared agent tool actually binds at runtime.**
#1084/#1085: every existing lint stops at spelling. #1085's worked case is
`gps-mentor` reading `research.json` front-to-back for 112 of 178 reads across
24 runs because its `tools:` list — fully correct by every lint we have — lacked
the projection tools (granted by #1082 on 07-31, which is also why the P2 state
diet should re-measure first). The claim survives HEAD explicitly: d6075b9b
hardened the *registration-key* half, and its own commit message concedes "This
does NOT verify that a granted tool actually BINDS at runtime; nothing in the
repo does" — the SDK handshake exposes only name/description/model per agent,
so `make agent-smoke` (the only check that reads what the runtime resolved, run
by no CI job) cannot be extended to cover it. The sibling gap is agent
*resolution* itself: #939's shape, a bare-name delegation silently falling back
to a stand-in that binds none of the deny-list.

**2.13 Untyped delegation is still happening and is unattributable.** Of 159
`Agent` calls in the 28 recent runs, **13 carry no approved subagent type** (10
with `subagent_type: None`, plus one each `general-purpose`, `claude`,
`Explore`) — the #980 shape. #980 further records that attribution is
*impossible* on committed data: 0 of 3,385 protected writes carry a caller id.

**2.14 Skill→skill delegation can bind a callee toolless.** #1012 (open): in
the unit-harness path, a sub-skill's tools are not unioned into the caller's
allowlist, so a `Skill(...)` callee can run with zero tools. This is the
router→skill binding seen from the callee's side — squarely inside this
document's scope — and prior revisions only name-dropped it (§9 briefly
mislabeled it). It is also a design hazard for the P1 router suite: a suite
exercising the router's `Skill` calls must make callee binding real before
grading routing.

### The rubric layer is starting to argue with itself

`eval/tests/unit/search-records/rubric.md` now spends ~40 lines overriding the
global judge prompt because two grading rules contradict each other (the rubric
pays the skill to invent name variants; the global rule fails any call that
matches no fixture). On 2026-07-31 a judge quoted the override, agreed with it,
and scored 2 anyway. When rubric prose needs prose to defend it, the corpus
limit is the thing to fix — not the rubric.

---

## 3. What to do next — prioritized

Ordered by leverage per unit of work, against the *measured* failure. Each item
names its own exit criteria.

### P0 — Calibrate the compliance detectors (#998, #999, #1006)

Every compliance number in this document comes from them, including the one that
justifies the rest of this list. #999 is a small fix — populate `is_error` so a
failed `Skill` call stops counting as a successful invocation — but necessary,
not sufficient, per the issue itself: a skill that runs and produces nothing
still returns success. #998 needs a `starting_tree` baseline so the
proof-conclusion arm stops firing on seeded relationships (the arm keys on *any*
ParentChild/Couple in the final tree; `starting_tree` is consulted only for
person fact-counts).

**#1006's confound is settled, not partially resolved (2026-08-01).** The issue
is now titled "(settled: doctrine gap, not an anachronistic check)". The
separating measurement is not the bagley run but the full before/after split on
the doctrine's landing date (`same_person` entered `research/SKILL.md`
2026-07-15, PR #657): of runs writing `person_evidence`, **13 of 48 (27%) called
`same_person` before that date and 16 of 83 (19%) after** — compliance *fell*
after the rule landed, which the check-measures-its-own-introduction reading
predicts cannot happen; and `same_person` calls appear from 2026-06-23, three
weeks before the line existed. **Do not re-open this as a confound.** What
remains open in #1006 is the *rollout* — 94% of current `person_evidence` writes
would fail the invariant it decided — plus its three scope questions.

**Two false-positive classes rev. 2 did not name — both from the detector
enforcing the router's paraphrase rather than the owning skill's contract.**
`find_person_evidence_missing_same_person`'s docstring cites the routing
table's "scores every cross-record link with `same_person`". The owning skill
is narrower: `person-evidence/SKILL.md:228-229` mandates scoring only for
`record_search`-sourced assertions, `:407-410` types `match_score` null for
FTS-, image-, and PDF-sourced links, and the stub path (`:412-436`)
creates-and-links a new person precisely when no candidate existed to score.
Both compliant-by-contract behaviors carry the detector's exact violation
signature. Calibration therefore has a fourth task: **decide which doctrine is
canonical, including what the `record_read` lane owes** (7 of the 16 flagged
persons carry only null-`record_persona_id` links — see the reach note in the
next P0) — until then, "true or false positive" has no ground truth. There is
also a false-*negative* blind spot in the committed corpus: no pre-#1050 run
records an empty violations list ("ran clean" and "did not emit" are
indistinguishable per-run; #1050, merged 07-31, emits the field unconditionally
for runs after it), and the three ferber raw-write runs count as clean in the
8/25 denominator, because raw writes are shadow-mode only.

**Until these land, the 8/25 rate cannot be trended and no gate should be
graduated on it.** `guardrail-enforcement-spec.md:346` is explicit that
false-deny is the asymmetric risk.

**Exit:** the five 2026-07-30 runs re-scored under corrected detectors; each
surviving violation adjudicated true or false positive against the *decided*
doctrine, with the record-sourced condition and the stub path adjudicated
explicitly.

### P0 — Make `same_person` structural at the write boundary — spec first

The direction is settled: identity scoring must be enforced structurally at
the write boundary, not by post-run detection. The mechanism is not. **Three
discriminators have now failed under adversarial review** (§9 records each):
rev. 2's unconditional version ("any `person_id` new to the tree") hard-denies
behavior the owning skill's contract documents as compliant — FTS-, image-,
and PDF-sourced links (`person-evidence/SKILL.md:407-410` types their
`match_score` null) and the no-candidate stub path (`:412-436`). rev. 3's
"person existed before this append" fails because `materialize_facts` mints
the person one call before the links are appended (bagley: idx 85 → 86), so
the person always pre-exists. rev. 4's "record already underpins the person,
via the pre-call pe → assertion → `record_id` join" fails because a project's
*first* pe batch has an empty pre-call join — bagley's idx 86 is a 30-op
first batch across three persons, so the gate denies all 30 links, the
compliant introducing ones included; a tree-source-ref basis instead exempts
all 30; and, deeper, the observed violation actually *commits* at idx 85,
when `materialize_facts` attaches unscored refs to existing persons, before
any pe append exists to gate.

**This item's deliverable is therefore a gate spec, not a code change.**
Constraints any design must satisfy, distilled from the three failures:

1. **Provenance.** Distinguish create-refs from enrich-refs at
   `materialize_facts` time, and gate there too — the tree write is where the
   violation lands, so a `person_evidence`-append gate alone cannot be the
   enforcement point.
2. **An attestation — but note the owner has already decided against holding
   out for a non-fabricable one.** Nothing today persists `same_person` output.
   `research-append-tool-spec.md:821-829` records the 2026-08-01 decision
   (#1006): validate `match_score`'s **presence** on the
   `personEvidenceInvariants` path, explicitly conceding that presence does not
   prove the call happened, and *"do not over-engineer past this."* That
   paragraph **supersedes** the earlier "the lever there is eval/rubric, not
   tooling" reading this document quoted through rev. 5. The stronger
   counter-design — `same_person` persisting a (person, record, persona)-keyed
   attestation the writer tools check — is not what was decided; propose it
   *against* that decision, not into a vacuum.
3. **Persona granularity.** Key on (`record_id`, `record_persona_id`), not
   `record_id` — bagley's `QPQP-R8T8` carries ≥3 personas, and a record-level
   exemption lets a second persona of an already-linked record attach
   unscored.
4. **Batch semantics.** Keep `proofSummaryInvariants`' pre-call-state
   discipline (`guardrail-enforcement-spec.md:150-154`, "Prefer this shape")
   with defined handling for an assertion and its link arriving in one batch.
5. **Demand the call, not a score threshold.** An ark-less stub legitimately
   returns a degenerate score the skill must treat as *no score*.

**Reach, honestly: ≤9 of the 25 measured violations, not 16.** 7 of the 16
persons flagged by the `same_person` arm have *zero* record-sourced links —
null `record_persona_id` on every linked assertion, by schema design for FTS-,
image-, PDF-, and `record_read`-sourced evidence — so no version of this gate
consistent with the skill contract can reach them. Whether those 7 are false
positives or a real `record_read`-lane doctrine hole is exactly the
calibration P0's doctrine decision. The gate still lands inside the skill
where the gap actually is (§0.2) rather than on the route to it.

**Gate it on the calibration P0 above.** #1006's anachronism worry is partially
retired by the 07-31 data point, but the doctrine decision (router paraphrase
vs. skill contract, including the `record_read` lane) directly sets this
gate's conditions.

**Exit:** the gate spec exists, satisfies the five constraints, folds in the
calibration P0's doctrine decision, and survives review; then implement. The
eventual behavioral exit stands: a run that attaches a persona from a new
record to an existing tree person without a `same_person` attestation fails
at the tool, not at the post-run detector.

### P0 — Move the last two prose gates into `research_append`

`research_append` already refuses `project.status: "completed"` while a blocking
conflict is unresolved. It does **not** refuse when:

1. a tier-≥-probable conclusion is not encoded in `tree.gedcomx.json` (the
   "Tree-encoding gate"), or
2. a resolved question's `ps_id` has no `focus: "proof-critique"` entry in
   `evaluations[]` (the mentor gate).

Both are prose today, both are the shape §5.3 says *can* decay (unanchored —
which permits decay rather than predicting it, §0.1), and both are
computable from files the tool already loads. Follow `proofSummaryInvariants`'
pre-call-state discipline. Land the mentor gate first — it is a pure FK check
into `evaluations[]`; the tree-encoding gate carries the caveat below.

**Prerequisite: #1001.** The gate being extended is already half dead —
`research-append.ts:622` tests `c.identity_question === true` while both schema
mirrors type it `["string","null"]`, so the identity clause is unsatisfiable and
the gate binds solely through `blocks_question_ids`, which the bypassing agent
writes itself. Fix it in the same PR and add the string-valued test that does
not exist.

**A prose-lane sibling is in flight.** PR #1029 (open) rewrites the routing
table so every "Invoke" is a literal `Skill` call and adds a contract against
hand-writing `exhaustive_declaration`/`proof_summaries` — reinforced prose
aimed at the same arms these gates would anchor. If it merges before the gates
land, it is a natural experiment for §5.3's decay law: track whether the
reinforced prose holds where the unanchored prose did not, and fold the answer
into this item's exit review.

**Caveat on gate 1.** "Is the conclusion encoded in the tree?" is a semantic
match of free-text conclusion to a tree fact or relationship, and the router's
own text says to "match the check to the question type." That is #998's exact
problem in a new place — scope the check conservatively and prefer a false
*allow* over a false deny.

**Exit:** a run that writes a proof summary and skips the tree write fails at
the tool.

### P1 — Production tool-call ledger, then port the detectors (#1054)

Append-only rows: session, turn, tool, args digest, agent id, outcome, tokens,
latency. Everything else falls out of it — §8's detectors in production, a real
compliance rate, cost per question, and the ability to answer "is this getting
better?" for a user rather than for a fixture. #980's finding that 0 of 3,385
protected writes carry a caller id is the same gap seen from the eval side.

### P1 — A router unit suite

`eval/tests/unit/research/`: state fixture → assert the first `Skill` call, plus
negatives for the shortcut cases the body warns about.

**Prerequisite: the router's `allowed-tools` and the agent-union semantics.**
`research/SKILL.md:19-22` declares only `validate_research_schema` and
`research_query`, while the body mandates `research_append` for the terminal
`project.status: "completed"` transition (`:145`, `:379`) and a `Read` of
`tree.gedcomx.json` (`:259`). rev. 2 concluded a suite built today would deny
the router that tool — **backwards** (§9): `compute_allowed_tools`
(`allowed_tools.py:61-68`) unions in the `tools:` of every plugin agent a skill
references via `@plugin:`, and the router references `@plugin:gps-mentor`,
whose frontmatter carries `research_append`. A unit run would therefore
**grant** the router the tool, and nothing denies the router *using* it inline
(`context_policy.py` guards only `image_read`; `allowed_tools.py:98-103` names
the held-only-for-the-subagent gap). The right suite asserts the router routes
rather than writes — a stronger test than the one rev. 2 imagined.
Second-order: the baseline (`allowed_tools.py:59`) grants `Write`/`Edit` to
*every* skill and the unit workspace stages no plugin hooks, so §2.10's
raw-write class is ungated at call time in unit runs (the `test_ownership_table`
validator flags it only at grading time). Worth fixing in the same pass.
Related: #1012, #915.

**Prerequisite: fix the contradictory verdict tables.**
`research/SKILL.md:343-348` says `address_first` in interactive mode → ask, then
*"end your turn — no further tool calls"*, reinforced over five sentences.
`:368-372` is a second, unheaded table saying for the same verdict *"Do not
block… log and continue."* Both are live; commit `ee088b96` (2026-07-22,
merged 07-23) reconciled the prose and left the second table behind. The body cannot currently
tell a test which behavior is correct.

**Production-shaped urgency:** #1104 (filed 08-01) counts 74 continue-nudges
across 34 runs at exactly this routing seam — the first production-shaped
number for the failure class this suite guards. Design hazard: #1012 (§2.14) —
in the unit path a `Skill(...)` callee binds no tools, so the suite must make
callee binding real before grading routing.

**Caveat to write into the suite's README:** this cannot see compaction decay —
it grades a single routing decision in fresh context. It guards against routing
*edits*, not against the decay the §5.3 audit measured.

### P1 — Ship C0 (the reasoning-effort A/B)

The largest measured single lever (58% of output tokens are unstored billed
reasoning; generation is linear in output tokens at ~57 tok/s). Nobody has
measured this product at any effort other than `high`. Issue #1136 notes
`ClaudeAgentOptions.effort` may make it a one-line change instead of a
settings-file write, and that the five-minute check has not been done. Do the
check first.

### P1 — Halt on tool-layer loss (#941)

Treat "a required writer tool is absent" as a stop condition with a logged
blocker. The raw-write fallback is closed since 07-30 (§2.11), but the failure
is still silent and the run still burns its full budget — now with even less to
show for it, since the writes that used to produce an unvalidated file are
denied. Consider also whether `update-config` should be reachable from a
research session at all.

### P1 — Flip the ToolSearch flag and re-measure

*(rev. 2/3 had this P2 as "investigate"; with the check done and §6 ranking it
lever #2, P2 was internally inconsistent.)* 387 calls across 28 recent runs
(~14/run, **~11% of all tool calls**), each a serial pre-call discovery step —
turn-shaped cost. rev. 3 hypothesized the flag's polarity was inverted; the
rev. 3 review **confirmed it** against the installed CLI (v2.1.220 — verify
against the pinned version before relying on it): a truthy
`ENABLE_TOOL_SEARCH` *enables* deferred/tool-search mode, unset also means on,
and only a falsy value disables it. Both harnesses and the hosted path have
been running the opposite of their comments' stated intent.

**Update 2026-08-02 — the comment half is done.** #1173 corrected the three
inverted sites (`auth.py`, `e2e/orchestrator.py`, `real_agent.py`) and a
follow-up corrected the last two in `CLAUDE.md` and
`tests/packaging/agent-tool-names.test.ts`. **What remains in #1110 is the flip
itself** — a behavior change in both harnesses and the hosted path that requires
re-measuring the tool mix before and after. It is no longer a one-line fix.
A related production hazard the packaging lint
cannot see: agents *generate* hardcoded `select:mcp__genealogy__…` ToolSearch
queries at runtime (the ferber transcripts show them), which would miss under
the Cowork bridge prefix. Strictly worse in Cowork, which offers no equivalent
control.

### P2 — Generate the schema mirrors

One source (`packages/schema`) → both `enums.schema.json` trees, the TS unions,
and `validator.ts`'s `CLOSED_ENUMS`. Closes #1087, #1015, #1014 (#1013 folded
into #1015 on 08-01) and
deletes the three-case "which sites does this edit touch" table from CLAUDE.md.

### P2 — Spike: a read-only `research_next` advisory

*(rev. 1 had this as the headline P0. It was aimed at the wrong layer — see §9.)*

**What it does and does not fix.** Row by row over `research/SKILL.md:128-146`:

| Rows | Class | Notes |
|---|---|---|
| 1, 6, 7, 11, 15, 17 | **Mechanically computable** | count/anti-join/FK checks; row 6 is exactly `logIndex.hasLinkedAssertion` |
| 2, 3, 4, 5, 9, 10, 12 | **Needs LLM judgment** | "plausibly answers," "identity uncertainty," jurisdiction-to-`loc_` fuzzy matching, digitized-but-unindexed (needs a live `volume_search`) |
| 8, 13, 14, 16 | **Ambiguous / mixed** | recorded conflicts are mechanical, *noticing* one is not; tree-encoding is a semantic match |

**6 of 17 computable — and those six are the ones that were never failing.**

**It does not address the measured failure.** The router invoked
`person-evidence` in all five 2026-07-30 failures (§0.2). Telling the router
what comes next changes nothing when the router already got there.

**The strongest objection**, which rev. 1 did not engage:
`guardrail-enforcement-spec.md:314-320` rejected per-skill write tools because
*"a split tool is exactly as callable by the router as a section branch is."*
The same logic applies here — "call `research_next` every turn" is itself
unanchored prose in the body, so nothing protects it from decaying. The
one-way law (§0.1) does not make that decay certain; the disconfirming
evidence for this proposal, which does not depend on it, is in our
own data: `project_context`, the projection tool built for exactly this, is
called **~3 times per run** against `Read`'s ~19.

**Also note:** it *adds* a serial tool call per routing decision — in practice
a turn — to save re-derivation tokens, which is the wrong direction under
`research-performance-2026-07-27.md:76-77`; and
`research-latency-reduction-plan.md:187-198` routes changes to how the pipeline
advances through `plan-design-review`.

**Scope the spike:** return only the six mechanical rows, mark the rest
`unknown`, ship it beside `project_context`, and measure adoption before
building further. **Exit:** an adoption rate, not a violation count.

The cheaper 80% is scoped but **iceboxed** (#1157 — "candidate work, no decision
made"): fold `logIndex.hasLinkedAssertion` into `project_context` — rows 6, 7
and 11 for free, no new tool and no new prose rule to remember. There is no
`docs/plan/` state-diet document; #693 is closed.

### P2 — Finish the state diet

`Read` is still the most-called tool: 544 calls across 28 recent runs (~19/run)
against 246 `research_query` + 91 `project_context`. #1082 (merged 07-31)
already granted `gps-mentor` the projection tools — the largest single `Read`
consumer, 112 of 178 reads — so **re-measure the mix before lifting anything
else**. Then ship the `project_context` `logIndex` extension, and give
`research_query` pagination past its 50-item cap (#1031) — the cap is a
correctness bug first (§2.9).

### P3 — Parallelize e2e and add a smoke tier

A cheap subset gating PRs, the full suite nightly or weekly with concurrency and
a budget cap. Today a suite run is a hand-written serial loop.

### P3 — Same-behavior test for the three write-lockdown copies

Per `guardrail-enforcement-spec.md` §6, three implementations exist and no test
asserts they agree. Table-drive one vector set across all three.

---

## 4. Is this system too complex?

Split by layer — the answer differs.

**Architecture: no.** 47 MCP tools is right-sized for the API surface;
generic-tools-with-parameters is held; the host/VM split is forced by the VM's
egress restriction and is correctly documented. The three-way skill / agent /
tool decomposition maps cleanly onto "judgment / fresh-context heavy lifting /
network and validation."

**Data: yes, in the mirrors.** Four-plus hand-maintained copies of one set of
closed enums is complexity that can simply be deleted (§3, P2).

**Prose: yes.** 915 KB of plugin markdown; SKILL.md bodies alone are 7,730
lines. `search-records` is 50 KB, `person-evidence` 39.5 KB, the router 29 KB,
`record-extractor` 824 lines, `gps-mentor` 635.
`references/validation-protocol.md` is duplicated **12×** (10 distinct — already
drifted), `places-guidance.md` **9× in skills** from a canonical copy at the
plugin's top-level `references/` (which is the lint's source, not a stray),
`research-log-protocol.md` **3×** (all three distinct). The duplication is a
*correct* response to a platform limitation (#17741), but **only
`places-guidance.md` is lint-guarded** (`skill-guidance.test.ts`, and its
`research-plan` exemption is existence-only); the other two are unlinted and
have drifted (#1112). So it is managed for one of three and accidental for the
rest — which also means §5 item 7 ("shrink the duplicated references") is a
larger job than it reads: 10 of the 12 copies are not in sync to begin with.
The real cost is that doctrine which
should be tool contracts is living in bodies that get evicted — and, as §3's P2
spike shows, most of the router's body is *not* that doctrine and cannot move.

**Governance: at the edge.** 55 specs, 284 MB of tracked run logs, ~170 open
issues, and a CLAUDE.md that is itself a load-bearing operating manual. (This
count included a 577-line `docs/TODOs.md` when written; it was retired
2026-08-02, its 54 items becoming issues #1117–#1157 — which is why the open-issue
figure jumped rather than fell.) Defensible when the prompt is the product; but the marginal
doc now costs more to keep current than it returns.

**Resolved (2026-08-02).** `docs/specs/skill-architecture-spec.md` — whose §2
still claimed "Cowork lacks programmatic skill invocation" and "there is no
orchestrator skill in v1" — was rewritten as an as-built binding map (#1107) and
then folded into [`docs/architecture.md`](architecture.md) and deleted. The
governance count above is one doc lighter.

---

## 5. How to simplify

1. **Generate the schema mirrors** — deletes four issues and a doc table.
2. **Ship the two gate ports, and spec the `same_person` invariant.** Each retires
   unanchored prose — the shape §5.3 says *can* decay — which is the *right*
   prose to retire, unlike a general assault on body length.
3. **Delete the 26 dead `model:` pins.** They change nothing anywhere and make
   per-step routing look like it exists (§2.4).
4. ~~Rewrite or retire `skill-architecture-spec.md` §2.~~ **Done 2026-08-02** —
   rewritten in #1107, then folded into `docs/architecture.md` and deleted.
5. **Reconcile the two `address_first` verdict tables** in `research/SKILL.md`
   — one behavior, one table.
6. **Adopt #985's retention rule** — every `.ann.json` and released `v{N}` kept
   forever, latest two candidates per skill, snapshots stripped from annotated
   older candidates, e2e transcripts deleted after 60 days once graded. (rev. 2
   paraphrased this as "keep the latest run per fixture, archive the rest" —
   that is not the issue's rule.) 284 MB tracked, most of it inert.
7. **Shrink the duplicated references rather than re-linking them.**
   `validation-protocol.md` ×12 largely restates rules that `research_append`'s
   error contract already enforces at write time. Every rule in a reference doc
   that a tool already rejects is a rule that can be a sentence.
8. **Fix the corpus limit behind the `search-records` rubric override**, so the
   rubric can lose its 40 lines of self-defense.

---

## 6. Performance and cost

The governing equation is already established and should not be re-derived:
generation time is linear in output tokens at ≈57 tok/s with a ~2 s intercept,
so **the only levers are fewer tokens emitted and fewer turns**. Tool latency is
effectively zero. Note the corollary rev. 1 violated: **a change that adds a
tool call to save tokens is not obviously a win** — tool calls come at
turn-granularity cost (the plan's own data: ~2.1 calls per turn, with parallel
calls amortizing, so a marginal *serial* call is a marginal turn).

Current measured economics:

| | |
|---|---|
| e2e run, median / mean | **$7.35 / $8.54** (111 runs record a cost; 22 record none) |
| e2e run, worst case | **$25.24** and **180 min** (corpus maxima; duration median 52, mean 59) |
| e2e recent window (07-25 → 07-30), 32 runs / 27 costed | **$2.89 – $21.50**, **18 – 180 min** |
| Full unit sweep (25 suites) | **≈$77** |
| Committed e2e spend to date | **≈$948** |

**The tail is the expense, and it is easy to truncate away.** Read those ranges
with two facts. First, **capped and timed-out runs are not exceptions** — 8 runs
hit `stop_reason: cost_cap` and 19 hit `timeout`, 27 in all. Quoting a
range that stops at the last *completed, uncapped* run understates the top badly:
inside the 07-25 → 07-30 window that framing gives $2.89 – $14.00 / 18 – 87 min,
while the window's real extremes are **$21.50 / 119 min**
(`jimmie-jewel-neal` 07-25, `stop_reason: cost_cap`) plus **two 180-minute
timeouts** (`jimmie-jewel-neal`, 07-30). Second, **all 19 timed-out runs record no
cost at all**, so they are absent from the median and mean entirely — $8.54 is a
floor, not a centre. Corpus-wide the worst single run is `jimmie-jewel-neal`
07-31 at **$25.24 / 168 min**, and that fixture accounts for five of the ten
longest runs on record. Cost work should be aimed at the tail; the median run is
already cheap.

Levers, ranked:

1. **C0 — reasoning effort.** Largest measured lever, unshipped, possibly one
   line.
2. **ToolSearch flag flip** — ~11% of all tool calls; polarity settled and the
   five inverted comment sites corrected (#1173 + follow-up), **the flip itself
   unshipped** (#1110, P1).
3. **Finish the state diet** — `Read` still leads the tool mix.
4. **Shrink the resident bodies** — but only behind a gate the unit suite cannot
   provide. Our own caveat holds: the unit suite grades single invocations in
   fresh context and will happily bless a cut that removes something only a
   multi-hour session needs. Start with a compaction-segment audit of
   `research/SKILL.md` (§0.1), which nobody has done.
5. **Per-step model routing via subagents** — the only surgical lever, per the
   record-extractor A/B (skill `model:` is inert; agent `model:` is honored).

---

## 7. Evidence appendix

Reproducible from the repo at the date above.

> **Correction (2026-08-02).** This appendix carried a carve-out saying the
> #1006-separating bagley run of 07-31 (`run-2026-07-31_18-06-28`) was
> uncommitted and existed only in that issue's comment thread. **It is
> committed** — it landed in `d5d26d00`. Every count below has been recomputed
> over the whole committed corpus, including it.

**E2e corpus (133 committed runs).** Outcomes 81 pass / 22 partial / 30 fail
(these are fused pre-#1050 verdicts: 8 of the 30 fails are judge-pass/partial
runs failed by the compliance detector — 6 judge-pass, 2 judge-partial).
Stop reasons: 96 completed, 19 timeout, 8 error, 8 cost_cap, 1 inactivity, 1
natural_end. **This is the same 133 §6's economics use** — 111 of them record a
cost and 22 do not (all 19 timeouts, 2 errors, 1 inactivity). One corpus, one
denominator.

**Guardrail violations since the detector shipped (2026-07-27 20:00):** **12 of
the 29 runs** in that window carry at least one, **45 violations** in total:
34 × "tree person is new this run and has a `person_evidence` link" (with no
`same_person`), 4 × exhaustiveness declared without `research-exhaustiveness`,
4 × proof/conclusion effect without `proof-conclusion`, 3 × conflict analysis
without `conflict-resolution`. **Read with §0.2's caveat: #998/#999/#1006 make
this a floor with an unquantified false-positive rate.**

> **Why other sections say "8 of 25" and "16 ×".** Those are the same
> measurement over a **narrower window** — it stopped at `2026-07-30_19-43-58`
> and dropped timed-out runs, which excluded four runs (two `jimmie-jewel-neal`
> timeouts and both 07-31 runs) that are all committed. Those four carry 20 of
> the 45. The narrow window is what §3's P0 and §9's **"≤9 of 25"** gate-reach
> figure are stated against, so both are left on it; **the ≤9 has not been
> re-derived on the full window — do not rescale it by eye.**

**The five 07-30 failures.** isabel-carvajal-daughter (judge pass, 5
violations), heinrich-zinsmeister-death (judge partial, 1),
amelia-gioiello-marriage (judge pass, 3), cornelius-booysen-death (judge pass,
5), pierre-desobry-spouse (judge partial, 5). `person-evidence` invocations and
`same_person` calls per run: see the table in §0.2.

**Tool mix, 28 runs (2026-07-25 → 2026-07-30 19:43, timeouts and one `cost_cap`
run excluded; 3,659 calls).** *This is a third window, narrower than either
violation window above — "since 2026-07-25" over the whole corpus gives 34 runs
/ 5,431 calls. Every figure derived from it (§2.13's 159/13, §3 P1's 387, §3
P2's 544/246/91, §8's 46/31) inherits the same truncation. Recomputing on the
stated window is queued with the window decision below.* Read 544 · research_append
486 · **ToolSearch 387** · research_query 246 · record_search 227 · Skill 219 ·
record_read 204 · research_log_append 169 · Agent 159 · wiki_place_page 121 ·
Glob 99 · extraction_append 92 · project_context 91 · … · same_person 21.

**Skill invocations, same window (219 total).** question-selection 44 ·
research-plan 32 · search-records 31 · person-evidence 24 · locality-guide 20 ·
research-exhaustiveness 20 · proof-conclusion 19 · record-extraction 14 ·
search-external-sites 4 · check-warnings 3 · search-images 2 · gps-mentor 1 ·
search-full-text 1 · **conflict-resolution 1** · research 1 · init-project 1 ·
update-config 1.

> `gps-mentor` additionally ran **25× as an Agent** in this window, including
> at least once in each of the five failing runs (pierre 2×) — the Skill count badly understates the
> mentor gate's use. `conflict-resolution` has no Agent path, so its 1 is real.

**Agent delegation, same window (159 calls).** record-extractor 88 ·
image-reader 28 · gps-mentor 25 · **`subagent_type: None` 10** ·
image-reader-opus 5 · Explore 1 · general-purpose 1 · claude 1. The 13
untyped/non-approved calls are the #980 shape.

**Unit suite.** 373 committed test definitions (291 positive, 82 negative) under
`eval/tests/unit/`. The latest run log per skill totals **384 rows** — the
difference is 12 stale rows for the retired `assertion-classification` skill
plus one suite that has gained a test since its last run. 348 of the 384 rows
pass (91%). Weakest: record-extraction 17/27 (63%), person-evidence 12/18 (67%),
proof-conclusion 13/19 (68%), validate-schema 8/10, search-familysearch-wiki
13/16. No suite exists for `research` or `forget-and-rederive`.

**Routing corpus.** 83 distinct skill→correct_skill edges, **38 reciprocal**
(consistent with #945).

**Prose sizes.** Plugin markdown 915 KB total, of which per-skill `references/` is 353 KB
(357 KB including the canonical top-level copy).
SKILL.md bodies 7,730 lines. Largest: search-records 50,185 B · person-evidence
39,572 · research 29,132 · citation 28,172 · proof-conclusion 26,820 ·
conflict-resolution 24,504. Agents: record-extractor 824 lines · gps-mentor 706 (635 before #1082).
The router's routing table proper is 17 rows at `research/SKILL.md:128-146`.

**Raw-write incident.** `eval/runlogs/e2e/william-ferber-origins/` runs
`2026-07-29_02-09-46` (12 edits), `12-16-49` (13), `17-05-11` (8) — **33
successful raw writes** to `research.json`, all Windows paths, in three runs that
made **zero MCP tool calls** (#941). Two `settings.json` write attempts in the
same window were denied.

---

## 8. What this critique did not examine

Named so nobody mistakes silence for a clean bill.

- **Prompt-injection exposure.** Untrusted free text reaches an agent holding
  `research_append` via `image_transcribe` OCR (46 calls in the recent window),
  `fulltext_search` (31), and every record the extractor reads. A grep of
  `packages/engine/plugin/` and `packages/engine/mcp-server/src/` for
  injection/untrusted doctrine returns **zero hits**
  (`docs/plan/prompt-injection-defense-plan.md`, Status: proposed — not started;
  #847). Not examined here, and explicitly not a clean bill.
- **Session resume, mid-run compaction, and concurrency.** `resume_on_stall` and
  resume counts appear in every runlog; nothing here examined what routing state
  survives a resume, or what happens when two sessions touch one project.
- The **genealogical quality** of the doctrine in the skill bodies. This is an
  engineering read of the binding mechanisms, not a GPS review.
- The **hosted web workbench** (`apps/web`, `apps/server`, `packages/viewer-ui`)
  beyond the agent-configuration path.
- The **`.mcpb` install and OAuth paths**, except where they bear on tool-name
  binding.
- **Individual tool implementations** against their specs — that is a per-tool
  review against `docs/specs/<tool>-tool-spec.md`, not this document's scope.
- Whether the **judge itself** is well-calibrated on the unit side. §2.8 notes
  the metric is missing; measuring it is separate work. (#1090, filed 07-31, is
  direct e2e-side evidence of the risk: the judge scored a relationship finding
  as recovered on a tree with no relationships.)

---

## 9. Refuted in review — do not re-derive

### rev. 1 claims, refuted in the rev. 2 pass

| rev. 1 claim | Why it was wrong |
|---|---|
| **Routing-as-a-tool is the headline P0, and will drive guardrail violations to zero** | The router invoked `person-evidence` in **all five** 2026-07-30 failures. The gap is inside the skill (`same_person` not called), not in the route to it. Only 6 of 17 routing rows are computable, and those six were never failing. Demoted to a P2 spike |
| "The routing table … is 431 lines of prose" | 431 is the **whole file**. The table is **17 rows** (`:128-146`). The other ~390 lines are autonomous-mode, iteration, the extraction/conflict contracts, hard rules and verdict handling — none of it movable into a tool |
| "The single largest unanchored rule we own" | Unmeasured. `research-performance-2026-07-27.md:692-697` scopes its audit to `search-records` and says the per-skill audit "should not be assumed" |
| "35 successful `Edit` calls to research.json" | **33** (12 / 13 / 8). The extra two were `settings.json` writes, **both denied** |
| The POSIX-only path split is why those writes landed | All three runs made **zero MCP calls** (#941). The agent had no writer tool. The guard was a no-op *and* irrelevant to the outcome |
| The 8/25 compliance rate stated as settled fact | #998, #999 and #1006 are three open defects in the instrument; 16 of the 25 violations come from the arm #1006 says cannot be separated from its own introduction date |
| 26 skill `model:` pins are an eval/production fidelity gap | All 26 pin `claude-sonnet-4-6`, which **is** `DEFAULT_MODEL`; only the unit harness reads them. They are dead lines, not a gap. Delete them |
| `gps-mentor 1` listed among skill invocations without qualification | It ran **25× as an Agent** in the same window, including in every failing run. The mentor gate is not being skipped |
| "Adds no cost" framing for a new routing tool | A tool call is a turn, and turns are the cost (`research-performance-2026-07-27.md:76-77`) |

### rev. 2 claims, refuted in the rev. 3 pass

| rev. 2 claim | Why it was wrong |
|---|---|
| `research_query` "**silently** truncates" | The response has carried `truncated` + a pre-cap `count` since the tool shipped on 07-26 (`research-query.ts:243-244`), five days before rev. 2. The defect is missing pagination and an ignored flag, not silence |
| "A suite built today would **deny** the router `research_append`" | Backwards: `compute_allowed_tools` unions `@plugin:gps-mentor`'s `tools:` into the router's allowlist (`allowed_tools.py:61-68`), so a suite would *grant* it — and nothing denies the router using it inline. The real gap is held-only-for-the-subagent tools (#911; #1012 is the inverse — a `Skill()` callee runs toolless) |
| The ferber agent escalated permissions and "**only then**" wrote raw | The first raw `Edit` (idx 33) precedes every denied settings attempt (idx 46, 102); 9 of 13 writes precede the last one. Escalation was interleaved with the writes, not a prelude — a tidier story than the log supports, the same failure mode §9 exists to catch |
| "46 MCP tools" / "all 26 skills with suites" | 47 (`allToolSchemas`, unchanged since 07-26) and 25 (27 skills − `research` − `forget-and-rederive`) |
| "a tool call is a turn," stated as law | The cited plan's own data: ~2.1 calls/turn, with parallel calls amortizing (`research-performance-2026-07-27.md:53`, `:799`). Direction right, arithmetic wrong |
| The unconditional `same_person` gate (P0) and the 16-violation arm read as pure doctrine gap | The owning skill's contract exempts FTS-/image-/PDF-sourced links (`person-evidence/SKILL.md:407-410`) and the no-candidate stub path (`:412-436`); the detector enforces the router's broader paraphrase. Conditions added in rev. 3's P0; canonical-doctrine decision moved into the calibration exit |

### rev. 3 claims, refuted in the rev. 4 pass

| rev. 3 claim | Why it was wrong |
|---|---|
| "Conditioning on a pre-existing `person_id` exempts a stub's first link naturally" | The skill's flow creates the person via `materialize_facts` in a *prior* call and writes the `pe_` links in a separate append (bagley: idx 85 → 86), so at the append's pre-call snapshot the person always exists — including for the compliant introducing-record links. Record identity was rev. 4's replacement answer; it failed too (next table) |
| The conditioned gate "touches 16 of the 25 measured violations" | Inherited from the unconditional rev. 2 version. 7 of the 16 flagged persons have zero record-sourced links (null `record_persona_id` throughout, by schema design), so the conditioned gate's reach is ≤9 of 25 |
| Held-only-for-the-subagent tools cited as #1012 | Wrong issue: that gap is tracked by #911. #1012 is the inverse — a `Skill()` callee runs toolless in the unit path |
| "~70 open issues"; 20-fixture pass "≈$185"; "(26 suites)" in §6 | 115 open as of 08-01 (91 pre-wave); $150–165 from the corpus's own per-run stats; 25 suites — a §9 correction rev. 3 applied in one place and missed in another |
| "Exactly two are genuinely novel," counting the quantified compaction-decay law | arXiv 2606.22528 ("Governance Decay", June 2026) quantified compaction-driven constraint decay a month earlier. The production-derived ~3-compaction horizon remains distinctive; "no public precedent" does not |

### rev. 4 claims, refuted in the rev. 5 (narrow) pass

| rev. 4 claim | Why it was wrong |
|---|---|
| The record-identity exemption "exempts the stub's introducing links and still catches bagley's cross-record links" | A project's *first* pe batch has an empty pre-call pe → assertion → `record_id` join — bagley's idx 86 is a 30-op first batch across three persons, so the gate denies all 30 links, introducing ones included; a tree-source-ref basis instead exempts all 30; and the violation actually commits at idx 85 (`materialize_facts` attaching unscored refs to existing persons) before any pe append exists to gate. "A `same_person` result on record" also named no mechanism — nothing persists `same_person` output, and `research-append-tool-spec.md:812-815` says `match_score` is caller-fabricable. The P0 is now spec-first with five named constraints |
| "bagley: `materialize_facts` at idx 85, **all 13 links at idx 86**" | Idx 86 is a 30-op batch across three persons carrying 11 of I1's 13 links; the other 2 land at idx 141, from a fourth record. The idx-85 → 86 ordering argument stands; the count did not. (`guardrail-enforcement-spec.md:92`'s "26-op batch creating a new tree person" matches neither — spec fix filed) |
| 20-fixture pass "≈$150–165" | The doc's own median gives $145.80 — the low bound is ≈$146 |
