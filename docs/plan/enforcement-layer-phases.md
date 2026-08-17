# Enforcement layer — the phase programme

**Status, 2026-08-17.**

| Phase | State |
|---|---|
| 0 — ownership declaration | **landed** 2026-08-16. `docs/specs/schemas/ownership.json`, 19 rows, two lints |
| 1 — creation path | **landed** 2026-08-17. `project_create`, and `init-project` rewritten onto it |
| 1 — standalone (answer, don't error) | **not started**, and no longer a seed writer. Blocked on the `readProjectJson` consolidation |
| 2 — device-bridge route closure | **landed** 2026-08-17. `device_commit_files` covered in all three lockdown copies; `device_bash` deliberately not |
| 3 — first skill-agent pair (proof summaries) | **not started.** Premise re-measured 2026-08-17 and it holds: 52 of 142 runs that wrote a proof summary never launched the skill that owns it |
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
Phase 3  first pair ──────── next
Phase 4  remaining pairs      (needs #1253)
Phase 5  detectors + controls (independent, free, any time)
```

Phase 3 takes its row from the landed manifest: `proof_summaries`, owner
`skill:proof-conclusion`, `enforceableAt: ["unit"]` today. What that phase adds
is the `tool` and `hook` planes — both already in the manifest's plane
vocabulary, both claimed by no row yet.

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

## Phase 3 — the first skill-agent pair (proof summaries)

**Goal.** One artifact whose owner is enforceable, end to end, as the reference
implementation of the layer map.

Chosen because proof summaries carry the highest measured bypass rate.
**Re-measured 2026-08-17, after the three write-boundary gates landed: 52 of the
142 runs that wrote a proof summary never launched the skill that owns it — 37%,
against the 35% first measured.** The premise holds.

Note what that re-measurement cannot say. Every run in the corpus predates the
gates (newest 2026-08-14; the gates merged 2026-08-16), so this is the pre-gate
rate re-counted on a larger corpus, not evidence about the gates. Nor should it
be: nothing in #1685 requires `proof-conclusion` to have run — the
`resolved`-needs-a-summary gate pushes agents *toward* writing summaries and
never asks who wrote them. Closing that is exactly this phase.

**Six changes, each in exactly one substrate, no prose:**

1. `proof_summary_append` — narrow tool, schema derived from
   `researchAppendSchema` (export and parameterise `narrowedInputSchema()`; it is
   module-local today).
2. `research_append` refuses `section: "proof_summaries"`.
3. `proof-conclusion` becomes a **pair**: skill half acquires and routes, agent
   half holds the narrow tool under all three spellings and denies
   `research_append`.
4. Hook denies the narrow tool unless `agent_type` is `proof-conclusion` **or**
   `genealogy-research:proof-conclusion` — the namespaced form is what production
   reports, and a bare equality never fires.
5. The completion precondition — already built.
6. The manifest row + regenerated detector.

**Why a pair and not just a narrow tool.** Only an agent has an enforceable
capability envelope in production; a skill's `allowed-tools` is documentation
(the hosted path runs `bypassPermissions` with no allowlist). And the pair is how
an agent gets eval coverage — the caller skill's suite spawns it for real.

**Closes** #1490 (with its phase 2), #1491. **Depends on** Phase 0 for the row,
a trustworthy hook. **Cost:** ~1 week + one paid `proof-conclusion` run.

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
