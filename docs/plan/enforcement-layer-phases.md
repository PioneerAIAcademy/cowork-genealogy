# Enforcement layer — the phase programme

**Status, 2026-08-19.**

| Phase | State |
|---|---|
| 0 — ownership declaration | **landed** 2026-08-16. `docs/specs/schemas/ownership.json`, 19 rows, two lints |
| 1 — creation path | **landed** 2026-08-17. `project_create`, and `init-project` rewritten onto it |
| 1 — standalone (answer, don't error) | **not started**, and no longer a seed writer. Blocked on the `readProjectJson` consolidation |
| 2 — device-bridge route closure | **landed** 2026-08-18. `device_commit_files` covered in all three lockdown copies *and* in the `hooks.json` matcher that decides whether the guard runs; `device_bash` deliberately not. Still unproven against a real bridge payload — only a live Cowork session can do that |
| 3 — first skill-agent pair (proof summaries) | **landed** 2026-08-19. `proof-conclusion` folded into an agent; the plugin hook denies a `proof_summaries` write to any other caller. Unproven against a real Cowork payload — no CI job sees one |
| 4 — remaining pairs | **not started** |
| 5 — detectors + positive controls | **not started.** Independent and free; can run at any time |

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
Phase 1b standalone ──────── issue #1695, after #988
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

## Phase 1b — standalone use: answer, don't error

**The creation half shipped** as `project_create` (2026-08-17), so this section
is only what remains. **Auto-seeding the writer tools — the design this section
used to describe — was rejected**, twice, under review: it lets any skill bring
an objective-less project into being, which `init-project`'s guard then refuses
to touch and no routing table has a row for. A dead end with no sanctioned exit.

**What remains is smaller than a seed writer**, and is a lead ruling
(2026-08-17): *it is fine for standalone work not to be persisted; it is not
fine for the user to see an error merely because they are not in a project.*

Measured: of 21 skills declaring a tool that touches the project files, **1**
(`locality-guide`) handles the absence. The rest would surface
`research.json not found in projectPath` to someone who simply is not in a
project — including the search path, which is the 27,699-results loss this
programme opened with.

The fix belongs at the writer tools, not in 19 skill bodies (~19 paid eval runs,
and ~19 drifting copies of one rule). Tracked as issue #1695, which **must follow
#988** — the message is thrown from nine sites until that consolidation lands.

---

## Phase 4 — the remaining pairs

**Ranked by measured traffic, not by tractability.** Across 154 e2e runs only 18
distinct skills are ever routed to; `timeline`, `hypothesis-tracking`,
`citation`, `convert-dates` and `tree-edit` are invoked **zero** times, so
pairing them would enforce a path no run takes.

| Candidate | e2e invocations | Folded size |
|---|---:|---|
| `research-exhaustiveness` | 114 | 19.4 KB |
| `conflict-resolution` | 9 | 47.7 KB |
| `person-evidence` | 149 | 49.5 KB |

**The fold ceiling is ~54 KB**, taken from `record-extractor.md` (53,845 bytes) —
the only agent body the team has shipped and lived with. `search-records` folds
to 140,882 bytes and is disqualified on size before anything else. Agent bodies
only grow: `record-extractor` went 32,042 → 53,845 in about a month, because an
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

**The instrument now exists.** `harness/replay.py` reconstructs `research.json`
at any point in a run — 136/154 (88%) exact reconstruction, `make replay-check`.
Both halves of the guardrail-detector corrections and the violation recompute
were blocked on exactly this.

**Positive controls first.** Three shadow checks fire **zero** times across 154
runs, and nothing distinguishes "the behaviour never happens" from "the detector
is broken" — a failure already on record here, where the mentor-verdict arm read
0 where recomputation gives 8. **Before any of the three graduates, each needs a
synthetic fixture that makes it fire.** Hand-built `research.json`, no live run.

**One graduation is genuinely ready:** the live `same_person` provenance check
fires 7 times across 5 runs, and nobody has ever observed how the agent behaves
when that write is actually blocked. One fixture at `PERSON_EVIDENCE_GUARD=deny`,
~$7–25.

**Carries a ceiling worth knowing.** The ledger never recorded every assigned id
— truncated responses and `_first_n` batch summaries — so any recompute keyed on
ids inherits it. 11,582 of 20,992 ids in a full replay are reconstructed by the
tool's sequential convention rather than observed.

**Closes** #1569, #1484, #1431.

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
