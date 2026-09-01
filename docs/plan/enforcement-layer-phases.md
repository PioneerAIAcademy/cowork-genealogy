# Enforcement layer — the phase programme

**Status, 2026-09-01.**

| Phase | State |
|---|---|
| 0 — ownership declaration | **landed** 2026-08-16. `docs/specs/schemas/ownership.json`, 19 rows, two lints |
| 1 — creation path | **landed** 2026-08-17. `project_create`, and `init-project` rewritten onto it |
| 1b — standalone (answer, don't error) | **landed** 2026-08-21. `classifyProjectPath` in `project-io.ts` decides five states from the directory rather than the file; twelve tools return `reason: "no_project"` with no `isError`, and the three harness detectors that read `is_error` to mean "never landed" mirror it |
| 2 — device-bridge route closure | **landed** 2026-08-18. `device_commit_files` covered in all three lockdown copies *and* in the `hooks.json` matcher that decides whether the guard runs; `device_bash` deliberately not. Still unproven against a real bridge payload — only a live Cowork session can do that |
| 3 — first skill-agent pair (proof summaries) | **landed** 2026-08-19. `proof-conclusion` folded into an agent; the plugin hook denies a `proof_summaries` write to any other caller. Unproven against a real Cowork payload — no CI job sees one |
| 4 — remaining pairs | **first pair landed** 2026-08-23. `research-exhaustiveness` folded into an agent; the plugin hook routes the exhaustiveness CLAIM (`declared: true`) to it, field-scoped rather than section-scoped. Two writer-tool preconditions landed with it. **Second pair landed** 2026-09-01: `person-evidence` folded into an agent, section-scoped like proof summaries, with **no** writer-tool precondition — its candidate rule (issue #1731) is satisfiable by only 6.7% of reachable links and ships as a warning, which the conversion guide's step 3 sanctions ("there may be no such rule; say so and move on"). Remaining: `conflict-resolution`, and `research/SKILL.md` itself |
| 5 — detectors + positive controls | **landed** 2026-08-23. The shadow report replays the post-hoc families and the §11 unnamed-delegate check over history rather than reading only what a run stored; citation-nulling has its positive control on the live path; the deny run happened (PR #1844) and the agent recovers. Also fixed the capture strip, which was destroying `replay.py`'s input |

Three gates, the phase function, and the replay engine were built during the
investigation — they are *inputs* to this programme, not one of its phases.
**Update this table as each phase lands, and delete a phase's section when it
ships.** Two files in this directory once spent weeks claiming "not yet
implemented" for work that had shipped; that is the failure this line exists to
prevent.

**The goal is a comprehensive enforcement system, not a count of closed issues.**
The originating investigation carried a pre-registered target of 12 issues; the
programme reaches 11, and the lead's ruling (2026-08-16) is that the number was
the wrong instrument for this work — report it with that caveat rather than
widening scope to hit it. Issue closures are a side effect of building the
system, not the objective.

## What owns what

| Artifact | Role |
|---|---|
| **ADR-0011** | the layer map — six substrates, the decision procedure, snapshot-vs-live, and why gates ship without an override. **The durable decision.** |
| `docs/specs/schemas/ownership.json` | who may write each section of each project document, and on which planes that is checkable. The declaration every later phase keys on |
| `docs/specs/guardrail-enforcement-spec.md` | what is enforced today, what is measurement, the measured findings |
| root `PLAN.md` (gitignored) | the *current* phase only, as a per-task plan |
| **this file** | the phases not yet started, and the dependencies between them |

## Sequencing, and the one hard constraint

```
Phase 0  manifest ────────── LANDED ┐
Phase 1  creation path ───── LANDED ┼──> Phase 2  route closure ── LANDED
Phase 1b standalone ──────── LANDED
Phase 3  first pair ──────── LANDED
Phase 4  remaining pairs      first pair LANDED; #1253 does not block a PAIRED agent
Phase 5  detectors + controls (independent, free, any time)
```

Phase 3 took its row from the landed manifest: `proof_summaries`, now
`enforceableAt: ["unit", "hook"]` with `hookCallers: ["agent:proof-conclusion"]`.
It added the **`hook`** plane only. The `tool` plane stayed empty on purpose: a
narrow per-section writer tool is the alternative ADR-0011 rejects — *"a split
tool is exactly as callable by the router as a section branch is"* — so the
constraint comes from the caller check, not from a second tool name. Phase 4
inherits that shape.

**The hard constraint held, and was honoured.** A sanctioned creation path had to
exist before the bridge route closed, or project creation would have become
impossible: measured 2026-08-15, `init-project` created both files through
`device_commit_files` in Cowork with a connected folder. `project_create` landed
first; the route closed after. That is ADR-0011's satisfiability rule — a deny
must leave a working alternative — and it is the reason for the ordering above.

---

## Phase 4 — the remaining pairs

**Read `docs/skill-to-agent-pair-conversion.md` first.** The first conversion
took nine paid runs, most of them avoidable; that document is the measured
record and the ordered process. The two rules that would have saved the most:
move a rule that must hold into the writer tool *before* the prose moves, and
fold verbatim then run once unchanged to get the pair's own baseline.


**This phase ranks candidates by bypass rate, and that is the right instrument
for the guardrail rationale only.** A second, cost-motivated pair track was
opened on 2026-09-01 (issues #2115-#2123): it converts skills that have no
bypass problem at all, to reach the `model:`/`effort:` pins and to keep the body
out of the orchestrator's context. Those candidates are ranked by main-thread
context cost instead, and none of them belongs in the table below. See
`docs/skill-to-agent-pair-conversion.md`, "Two rationales reach a pair".

**Ranked by measured traffic, not by tractability.** Across the e2e corpus only
18 distinct skills are ever routed to; `timeline`, `hypothesis-tracking`,
`citation`, `convert-dates` and `tree-edit` are invoked **zero** times.

**"Pairing them would enforce a path no run takes" is true of four of those five
and FALSE of `hypothesis-tracking`** — measured 2026-08-23, 32 runs write
`hypotheses[]` across 79 ops while the skill is invoked zero times, which is a
100% bypass rather than a dead path. `timeline` is the genuine dead path: zero
writes and zero invocations. The lead ruled 2026-08-23 not to widen Phase 4 to
it — the discriminator is that a deny on a routed skill REDIRECTS traffic that
already exists, while a deny on `hypotheses` must INDUCE routing that has never
once occurred. It goes to that skill's own deep dive (issue #1644), which must
fix a known-unsatisfiable gate in the body first.

| Candidate | e2e invocations | Folded size |
|---|---:|---|
| ~~`research-exhaustiveness`~~ | 115 | **landed 2026-08-23** — folded to ~21 KB |
| `conflict-resolution` | 9 | ~48 KB |
| ~~`person-evidence`~~ | 154 | **landed 2026-09-01** — folded to 53,158 bytes / 1,036 lines |

**There is no fold ceiling. `record-extractor.md`'s size is precedent, not a
limit** — it is the largest agent body the team has shipped and lived with, and
that is the whole of its authority. Quoting it as a bar has produced a pass/fail
test that decides nothing: the file measured 53,845 bytes, then 58,541, and
measures 57,229 today, so a candidate can cross the "ceiling" in either
direction without anyone touching it. `docs/specs/unit-test-spec.md` has already
ruled on a threshold in this band — "**the variable is anchoring, not length**",
plugin agents are "exempt from the decay argument entirely" because they run in
fresh context per invocation, and "the only band that binds `search-records`
alone and spares `record-extractor` is a ~1 KB window around a single file."
ADR-0003 says the same from the other side: reopen a size argument only on a
measurement that body size costs something end to end, "not on a byte count."

So do not disqualify a candidate on `wc -c`. Use the folded size to *size the
work* — what moves, what stays skill-side, how much prose a reviewer has to
read — and decide on the rationale the candidate is being converted for.

**`search-records` is the largest candidate by a wide margin and it is
genuinely blocked, but not by a byte count.** It folds to roughly 143 KB, of
which about 87 KB is `references/` — and an agent cannot keep a `references/`
directory. That is the real constraint, and issue #2123 is its prerequisite:
whether `wiki_search` can serve that reference layer. Note also that stripping
the references leaves the body at 56,244 bytes, which "clears" any
record-extractor-derived ceiling by about 2%, i.e. inside the meaningless
window — another reason not to run this decision through a threshold.

**Agent bodies do not only grow.** Of the committed revisions of
`record-extractor.md`, roughly a quarter shrank it, including recent ones.
The direction of that file is not evidence about any other.

**Do not split references back out.** Measured and reverted: on-demand `Read`
inside an agent scored 6/19 against a 12–14/19 baseline, and the external
evidence agrees — scoped loading measures −8.3pp, structured rendering −13.3pp,
and no representation strategy improved performance on either executor tier. The
monolithic body is the best-performing arrangement anyone has measured.

**Blocked on #1253** (no harness path can invoke an agent directly) only for
agents with no natural skill caller. A paired agent inherits coverage through its
caller's suite — verified: the `record-extraction` run log's snapshot contains
`agents/record-extractor.md`.

**Cost:** ~3–4 days + one paid run per caller skill, each.

---

## Phase 5 — detectors and positive controls

Independent of everything above, offline, and free. Can run at any point.

**Part 1 landed 2026-08-21.** `make e2e-guardrail-shadow REPLAY=1 SINCE=all` now
recomputes the post-hoc families and the §11 unnamed-delegate check from each
run's committed log instead of only reading what a run stored, and the replay
plumbing has its own controls in `tests/unit/test_guardrail_shadow_report.py`.

**The premise this section carried was wrong, and the correction is the finding.**
It said three shadow checks fire zero times and that nothing distinguishes "the
behaviour never happens" from "the detector is broken". For two of the three it
was a third thing: the behaviour happens, the detector works, and the *report*
could not see history — a stored count reads 0 over every run made before its
check shipped. Replayed, both conflict-unpersisted and warnings-unchecked fire on
real committed runs. Only citation-nulling is a genuine zero, and it alone still
owes a synthetic fixture. **The counts are in the spec, deliberately not here** —
see below.

**The current measurements, what each check still owes, and what a
behaviour-presence replay does and does not claim now live in
`docs/specs/guardrail-enforcement-spec.md`** ("What is actually in the
shadow-to-graduate pipeline"), which owns measured findings. Read it there —
this section is deleted when the phase ships, and a durable finding cannot live
in a file with that property.

**`harness/replay.py` is not a dependency of this phase — and it was quietly
broken.** The e2e capture strip drops `response_summary` past 14 days, which is
where `replay.py` reads the `entryId` each writer reported back, so 133 of the
134 stripped runs could no longer be replayed against 18 of 23 unstripped ones
that could. That read as a fidelity collapse in an engine nobody had touched.
The sweep now keeps a replay remnant — ids, `ok`, batch length, 0.4% of the
summary bytes — so it stops happening; the 134 already stripped are not
recoverable, so fidelity returns only as new runs age in. It reconstructs
`research.json` at any point in a run (read the current rate from
`make replay-check`, never from a figure written down here) and
this section used to name it as the blocker. All three post-hoc checks read final
state, and every committed run ships `.final-research.json` /
`.final-tree.gedcomx.json` sidecars, so no reconstruction is needed. It remains
the right instrument for a mid-run question.

**citation-nulling's synthetic fixture — the last thing this phase owed — is
built.** `collect_post_hoc_shadow` was extracted from `_run_agent` so the live
path could be reached offline at all, and
`tests/unit/test_post_hoc_shadow.py` drives it from a hand-built
`research.json` on disk, exactly as Phase 5 specified: no live run, no API
spend. That closes the one place a zero was still ambiguous — the predicate
tests hand the detector a dict and the replay tests read committed sidecars, so
neither reached the path where a broken workspace read is indistinguishable from
a clean project.

**The deny run has now happened** — PR #1844 carries both runs and their
gradings, and issue #1431 closes with it. The agent recovers unaided: on
`hannah-earnest-children` the gate blocked twice with the loop valve never
opening, and each time the agent scored the identities with `same_person` and
retried the write, which landed. `mary-mcandrew-son` is the null control — every
link there was to a seeded person, so the check correctly never fired. What that
leaves for a graduation decision is a judgement about breadth, not a missing
observation.

**Carries a ceiling worth knowing.** The ledger never recorded every assigned id
— truncated responses and `_first_n` batch summaries — so any recompute keyed on
ids inherits it. 21,582 of 22,637 ids in a full replay (95%) are reconstructed by the
tool's sequential convention rather than observed. It does not touch the post-hoc
replay above, which reads committed final state rather than reconstructing.

**Closes** #1569, #1484 (both already closed); #1431 with PR #1844.

**This phase is done.** Everything it named has landed or been answered, so this
section goes when the programme's remaining phase does.

---

## Explicitly out of scope for the programme

- **Taint / prompt injection.** A trust level on assertions sourced from
  untrusted text is the systemic form of that problem, and the problem has its
  own probe. Note the capability surface is larger than its issue documents: the
  session also holds Gmail `send_message`, Drive `share_file`, and 22 browser
  tools.
- **Exfiltration.** The lockdown protects the *integrity* of the project
  documents. It says nothing about outbound channels, and that is a different
  guarantee (lead ruling, 2026-08-15).
- **The hosted tool-call ledger.** Its own issues own it.
- **Preventing a human from editing their own files.** Not a goal; the system
  constrains what *the system* does.
- **Artifact version skew** between the plugin zip and the `.mcpb`. Not
  detectable at runtime — the SDK init handshake carries nothing version-shaped —
  so it is a release-ordering rule, not a check.
