# Enforcement layer — the phase programme

**Status: Phase 0 landed 2026-08-16 — the ownership declaration is
`docs/specs/schemas/ownership.json`, 19 rows, with its two lints. Phases 1–5
designed here, none started.** Three gates, the phase function, and the replay
engine were built during the investigation — they are *inputs* to this
programme, not one of its phases. **Update this line as each phase lands, and
delete a phase's section when it ships.** Two files in this directory once spent
weeks claiming "not yet implemented" for work that had shipped; that is the
failure this line exists to prevent.

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
Phase 0  manifest ─── LANDED ┐
Phase 1  seed writer ────────┼──> Phase 2  route closure   (HARD DEPENDENCY)
Phase 3  first pair ─────────┘
Phase 4  remaining pairs         (needs #1253)
Phase 5  detectors + controls    (independent, free, any time)
```

Phase 3 takes its row from the landed manifest: `proof_summaries`, owner
`skill:proof-conclusion`, `enforceableAt: ["unit"]` today. What that phase adds
is the `tool` and `hook` planes — both already in the manifest's plane
vocabulary, both claimed by no row yet.

**The hard constraint: the seed must precede route closure.** Measured
2026-08-15 — in Cowork with a connected folder, `init-project` creates both
project files through `device_commit_files`, a route the lockdown's matcher does
not cover. Closing that route *before* a sanctioned creation path exists would
make project creation impossible. That is the satisfiability rule from ADR-0011:
a deny must leave a working alternative, and here the alternative has to be built
first.

---

## Phase 1 — the seed writer: create-on-first-write

**Goal.** No user should have to start an official project before doing work that
persists. The files appear when they are needed.

**Design.** Auto-seed inside the **writer tools**, not in skill bodies. As
SKILL.md prose this is ~20 independently drifting copies; inside
`research_append` / `research_log_append` / the tree writers it is one
implementation with validate-before-persist and nothing to drift. This is
strictly better than the separate seed tool the issue proposes, which still
requires every caller to remember to call it.

**Create on first WRITE, never on read.** This is what keeps the scope boundary
intact:

| Request | Writes? | Effect |
|---|---|---|
| "transcribe this image" | no | nothing created — no project appears in someone's Downloads folder |
| "does this record belong to this person?" | not until the user wants it kept | answered with no files |
| `record-extraction`'s first `research_log_append` | yes | shell created as a side effect of the write it was already making |

That last row is the measured failure: a request needing no project produced real
work (27,699 search results) and lost it at
`{"ok":false,"errors":["research.json not found in projectPath"]}`.

**Closes** #1080. **Cost:** engine tests only; no paid eval run.

**Open product call:** a durable write in an arbitrary folder now creates project
files there. Create-on-write makes that implicitly user-requested, but the first
creation should probably say so out loud. `researcher_profile` stays out of an
auto-created shell — every skill has an absent-profile fallback, and the
narration line must tolerate a missing file regardless.

---

## Phase 2 — route closure on the device bridge

**Goal.** The lockdown covers the route project files are actually written
through.

**Why it is newly tractable.** A canary proved a deny on `device_bash` **and**
`device_commit_files` is honoured, before execution, nothing written. That
removes the doubt on which the 2026-08-11 deferral partly rested — a name-matcher
does bind against a registrar the plugin does not control. The nine-tool bridge
surface is enumerated in the guardrail spec §6.1.

**What is still the hard part**, and what the ruling deferred: the **predicate**.
The only implementation that exists does not distinguish a file as *source* from
a file as *destination*, so it denies `cp research.json /tmp/backup/` and
`jq . research.json > mine.json` — both of which the `Write` half explicitly
permits in the same module. Shipping that makes the two halves disagree.

**Design constraint from four observations.** A blocked agent improvises toward
another route rather than stopping — the `device_bash` write that landed, the
`Bash` `cat` when `Read` was unavailable, an offer of `device_commit_files` as an
uncovered path, and a container-write delivered to the user via `SendUserFile`.
So express the rule as a **property of the file** wherever possible, not as a
list of denied tool names, and give every deny a remedy that actually works.

**Closes** #1499. **Depends on** Phase 1. **Cost:** predicate design + a Cowork
verification session; no paid eval run.

---

## Phase 3 — the first skill-agent pair (proof summaries)

**Goal.** One artifact whose owner is enforceable, end to end, as the reference
implementation of the layer map.

Chosen because proof summaries carry the highest measured bypass rate: **47 of
133 committed runs wrote one without ever launching the skill that owns it.**

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
