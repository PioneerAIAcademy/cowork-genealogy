# Enforcement layer — the phase programme

**Status, 2026-08-21.**

| Phase | State |
|---|---|
| 0 — ownership declaration | **landed** 2026-08-16. `docs/specs/schemas/ownership.json`, 19 rows, two lints |
| 1 — creation path | **landed** 2026-08-17. `project_create`, and `init-project` rewritten onto it |
| 1b — standalone (answer, don't error) | **landed** 2026-08-21. `classifyProjectPath` in `project-io.ts` decides five states from the directory rather than the file; twelve tools return `reason: "no_project"` with no `isError`, and the three harness detectors that read `is_error` to mean "never landed" mirror it |
| 2 — device-bridge route closure | **landed** 2026-08-18. `device_commit_files` covered in all three lockdown copies *and* in the `hooks.json` matcher that decides whether the guard runs; `device_bash` deliberately not. Still unproven against a real bridge payload — only a live Cowork session can do that |
| 3 — first skill-agent pair (proof summaries) | **landed** 2026-08-19. `proof-conclusion` folded into an agent; the plugin hook denies a `proof_summaries` write to any other caller. Unproven against a real Cowork payload — no CI job sees one |
| 4 — remaining pairs | **not started** |
| 5 — detectors + positive controls | **part 1 landed** 2026-08-21 — the shadow report can now replay all four post-hoc families over history, and the replay plumbing has controls. Outstanding: citation-nulling's synthetic fixture, and issue #1431 (the deny run) |

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
| **ADR-0011** | the layer map — six substrates, the decision procedure, snapshot-vs-live, override tiers. **The durable decision.** |
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
Phase 4  remaining pairs      (needs #1253)
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


**Ranked by measured traffic, not by tractability.** Across 154 e2e runs only 18
distinct skills are ever routed to; `timeline`, `hypothesis-tracking`,
`citation`, `convert-dates` and `tree-edit` are invoked **zero** times, so
pairing them would enforce a path no run takes.

| Candidate | e2e invocations | Folded size |
|---|---:|---|
| `research-exhaustiveness` | 114 | 19.4 KB |
| `conflict-resolution` | 9 | 47.7 KB |
| `person-evidence` | 149 | 49.5 KB |

**The fold ceiling is whatever `record-extractor.md` currently measures** — 58,541
bytes as of 2026-08-21, up from the 53,845 this line used to quote, which is why
it says "measure it" rather than naming a number. `wc -c` on that file is the
check —
the only agent body the team has shipped and lived with. `search-records` folds
to 140,882 bytes and is disqualified on size before anything else. Agent bodies
only grow: `record-extractor` went 32,042 → 58,541 in under two months, because an
agent cannot offload to `references/`.

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
recomputes all four post-hoc families from each run's committed final state
instead of only reading what a run stored, and the replay plumbing has its own
controls in `tests/unit/test_guardrail_shadow_report.py`.

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

**`harness/replay.py` is not a dependency of this phase.** It reconstructs
`research.json` at any point in a run (fidelity moves with the corpus — read it
from `make replay-check`, never from a figure written down here) and
this section used to name it as the blocker. All three post-hoc checks read final
state, and every committed run ships `.final-research.json` /
`.final-tree.gedcomx.json` sidecars, so no reconstruction is needed. It remains
the right instrument for a mid-run question.

**Still outstanding:**

- **citation-nulling's synthetic fixture** — the one check with no observed fire
  on either axis. Hand-built `research.json`, no live run.
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
ids inherits it. 11,582 of 20,992 ids in a full replay are reconstructed by the
tool's sequential convention rather than observed. It does not touch the post-hoc
replay above, which reads committed final state rather than reconstructing.

**Closes** #1569, #1484 (both already closed); #1431 with PR #1844.

**Phase 5 is then done bar one item** — citation-nulling's synthetic fixture,
above. Everything else this phase named has either landed or been answered.

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
