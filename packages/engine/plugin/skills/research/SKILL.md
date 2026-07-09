---
name: research
model: claude-sonnet-4-6
description: >-
  Drives the full GPS research workflow on a research objective, invoking the
  right sub-skills in the right order based on current research.json state.
  Iterates from question selection through proof conclusion until all
  questions are resolved. Use when the user says "research [objective]",
  "/research [question]", "find [relative]", "investigate [person]", "answer
  this research question", or wants to hand off a full research objective
  without driving each step themselves. Especially useful for beginners who
  don't yet know which sub-skill to invoke. Also the entry point for
  autonomous runs — when the user message contains `--autonomous`, proceed
  without pausing for clarifying questions and use best judgment for decisions
  that would normally prompt the user. Do NOT use when the user wants to drive
  a specific step directly (use question-selection, research-plan,
  search-records, etc.), wants only a status summary (use project-status), or
  when no research.json exists yet (use init-project first).
allowed-tools:
  - validate_research_schema
---

# /research — Full GPS Research Workflow

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to one short preamble **per phase / per record** (e.g. once before a record's extraction, not before each individual write or `ops` op). Under `--autonomous` mode, suppress per-entry preambles entirely — the audit trail lives in the persisted `rationale`/`notes` fields, not in chat, so narrate only at phase boundaries (or not at all) and keep moving.

You drive the full Genealogical Proof Standard (GPS) workflow on the
user's research objective. Rather than the user invoking each
sub-skill in turn, you read `research.json` to determine the current
state and invoke the appropriate sub-skill, then iterate.

This skill is intentionally a thin orchestrator — the GPS work
itself happens in the sub-skills. Your job is to keep the workflow
moving.

## Autonomous mode

If the user message contains `--autonomous`, proceed without pausing
for clarifying questions. Use your best judgment for any decision
that would normally prompt the user (which records to prioritize
when several are plausible, how to weight conflicting evidence, when
to declare exhaustiveness). Log the decision and your rationale in
the appropriate research.json field (log entry, assertion rationale,
or conflict resolution analysis) so the audit trail captures it.

**You are the only driver. Keep working in one continuous turn.**
There is no human to approve a tool, answer a question, or prompt you
onward — so do **not** end your turn to announce, plan, or ask about a
next step. After a sub-skill returns, immediately invoke the next
sub-skill in the **same turn**, and keep going through the full routing
loop (§"What to do" steps 2–4) until a real stop condition is met
(§"When to stop"). Trust the compact summaries the sub-skills and writer
tools return plus the state you already hold in context — only re-read
`research.json` when you're entering a phase cold without the relevant
state in context, or when a sub-skill or the user changed the file in a
way you don't already have. Writing something like "Next:
research-plan" or "I'll now search records" and then yielding is a
**failure** — it ends the run before any research happens. Narrate
briefly if you like, but always follow the narration with the actual
tool call or sub-skill invocation in the same turn. The only thing that
ends an autonomous run is `project.status == "completed"` or a genuine
blocker you have logged.

Otherwise (interactive mode), surface meaningful decisions to the
user as you encounter them.

## What to do

1. **Read `research.json`.** Identify the current state: which
   questions exist, which have plans, which plans have log entries,
   which entries have produced assertions, which are classified,
   which are linked to persons, whether conflicts are present, and
   whether each question is resolved.

2. **Pick the next sub-skill based on state.** Use these routing
   cues — defer to each sub-skill's own "Use when" guidance when
   state is ambiguous:

   | If research.json has... | Invoke |
   |-------------------------|--------|
   | Objective but no questions | `question-selection` (derive first question) |
   | A question with no plan | `research-plan` |
   | Plan items not yet executed, and no analyzed evidence yet plausibly answers the active question | `search-records` (or `search-external-sites` for non-FS sources) |
   | A plan item targets a **digitized-but-unindexed** FamilySearch record set (browse-only images — `volume_search` shows image groups with ~0% record-searchable), or indexed/full-text search has been exhausted and the remaining path is reading register pages directly | `search-images` (browses the volume page-by-page: `volume_search` → `image_search` → `image_read`) |
   | Log entries with no assertions extracted | `record-extraction` |
   | Assertions needing GPS three-layer classification | `assertion-classification` |
   | Assertions not yet linked to persons | `person-evidence` |
   | Evidence conflicts present | `conflict-resolution` |
   | Identity uncertainty across assertions | `hypothesis-tracking` |
   | Analyzed evidence now plausibly answers the active question — **even with plan items still `planned`** | `research-exhaustiveness` (consult the stop criteria *before* draining the rest of the plan; it sends you back to `research-plan` if the question — e.g. a completeness "did they have *any other* children?" question — is not yet reasonably exhausted) |
   | All plan items for a question are `completed` or `skipped`, and analysis above is done | `research-exhaustiveness` |
   | `research-exhaustiveness` returned "not yet exhaustive" with gaps to fill | `research-plan` (extend the plan) or `question-selection` (FAN pivot) |
   | A question is at `status: "exhaustive_declared"` with no `proof_summaries` entry yet | `proof-conclusion` |
   | `proof-conclusion` wrote `<ps_id>` at tier ≥ probable **but the concluded relationship is not yet in `tree.gedcomx.json`** | `proof-conclusion` again for the same question — it must encode the relationship before you proceed (see **Tree-encoding gate**) |
   | `proof-conclusion` wrote `<ps_id>` (and, at tier ≥ probable, its concluded relationship is now in `tree.gedcomx.json`) | **`proof-critique` mentor review** on `<ps_id>` (advisory — see Mentor checkpoints), then continue |
   | All questions are `resolved`, **every tier-≥-probable conclusion is encoded in `tree.gedcomx.json`** (see **Tree-encoding gate**), and `project.status` still `active` | Write `project.status = "completed"` via `research_append`, then stop |
   | All questions are `resolved` and `project.status` is `completed` | Stop |

   A front-loaded plan is a **prioritized list, not a checklist to
   drain.** Consult `research-exhaustiveness` as soon as analyzed
   evidence plausibly answers the active question — do not reflexively
   execute the remaining `planned` items first. Exhaustiveness is the
   stop gate: it weighs the question against the 5 threshold questions
   and 7-point stop criteria and either declares the search reasonably
   exhaustive (→ proof) or routes you back to `research-plan` /
   `question-selection` for the gaps. That round-trip is what lets a
   simple-recall question stop early **without** weakening a
   completeness / negative one ("did they have *any other* children?"):
   finding a single child does not satisfy such a question, so
   exhaustiveness will send you back for the enumerating sources (the
   household census, parent-indexed births, obituaries) before it lets
   you conclude. The gate still requires the evidence to have been
   extracted, classified, person-linked, and conflict-resolved first —
   those upstream artifacts are what its criteria read.

3. **Iterate — without yielding.** After each sub-skill returns, route
   to the next step **in the same turn** (under `--autonomous`; see
   "Autonomous mode") from the sub-skill's compact return plus the state
   you already hold — re-read `research.json` only if the sub-skill
   changed state you don't have in context, or you're routing into a
   phase cold. After a plan item completes and its evidence is analyzed,
   re-assess sufficiency — route to `research-exhaustiveness` once the
   evidence plausibly answers the active question — before reflexively
   executing the next `planned` item. New evidence may reveal new
   questions — return to `question-selection`. Resolved conflicts may
   unblock `proof-conclusion`. Do not assume the chain is linear; the
   same sub-skill may be invoked multiple times across the run. Do not
   stop after invoking just one sub-skill — that's the start of the
   loop, not the end.

4. **Don't insert defensive validate passes.** Every writer tool
   (`research_append`, `research_log_append`, `tree_edit`) validates the
   **whole** project before it persists and writes nothing on failure, so
   a separate periodic `validate_research_schema` pass between sub-skills
   is pure redundancy — skip it. Only run `validate_research_schema`
   directly when an **external/manual** edit touched the files outside the
   writer tools (a hand-edit, or a file the user changed) and you need to
   confirm it still conforms.

## Tree-encoding gate

**A conclusion is not done until the tree reflects it.** `proof-conclusion`
writes two things — the `proof_summaries` narrative *and* the concluded
relationship in `tree.gedcomx.json` (its §6, at tier ≥ probable). The narrative
is the argument; the tree is the deliverable, where the researcher's answer
actually lives. A proof summary whose relationship is missing from the tree is a
**found-but-lost** result: the question looks answered on paper while the tree
still doesn't show it. In long runs the agent sometimes writes the summary and
skips the tree write — so verify it, don't assume it.

After `proof-conclusion` writes `<ps_id>` at tier ≥ probable:

1. **Read `tree.gedcomx.json` and confirm the concluded relationship is present**
   — a `ParentChild` linking the concluded parent(s) to the child for a
   parentage question, a `Couple` for a marriage — between the persons the proof
   concluded.
2. **If it is missing, re-invoke `proof-conclusion` for the same question** (its
   §6 writes the relationship). Do this *before* the `proof-critique` mentor
   review and before anything marks the question resolved.
3. **This is a hard gate.** Unlike the advisory mentor, it blocks: never let
   `question-selection` mark the question resolved, and never write
   `project.status = "completed"`, while any tier-≥-probable conclusion is
   unencoded in the tree. A run does not finish with a conclusion that never
   reached the tree.

At tier `possible` / `not_proved` / `disproved` no relationship is expected (the
conclusion is a documented lead, not a tree assertion), so the gate is satisfied
trivially.

## Mentor checkpoints

After `proof-conclusion` writes a proof summary, invoke the
`gps-mentor` subagent once for an independent `proof-critique` of the
finished proof. The mentor reads project state in a fresh context,
evaluates the written conclusion against a focused rubric, and records
a structured verdict. It is **read-only** — it never modifies project
files; it writes only to `evaluations/`.

**One gate, at the end, advisory — identical in interactive and
`--autonomous` mode.** It runs *after* the answer is already persisted,
so its verdict informs later review; it never blocks the flow, forces
rework, or re-opens a resolved question. (The former `pre-exhaustiveness`
and `conclusion-readiness` pre-gates were removed: they duplicated
`research-exhaustiveness`'s own 7-point check and `proof-conclusion`'s
tier analysis, the read-only mentor cannot verify exhaustiveness without
search tools, and their forced rework starved the proof step. The mentor
still *supports* those focuses **on-demand** — see below.)

### When to invoke

| Trigger | Focus | Target |
|---------|-------|--------|
| `proof-conclusion` just wrote `<ps_id>` | `proof-critique` | `<ps_id>` |
| User asks "review my work", "is this defensible?", "critique my proof", "am I ready to conclude?", "second opinion", "mentor" | `on-demand` | most recent question / proof summary / `"project"` |

For the `proof-critique` gate, first check `evaluations/` for an existing
`proof-critique-<ps_id>-*.json` newer than the last edit to that proof
summary; if a current verdict exists, act on it rather than re-invoking.
Otherwise invoke `@plugin:gps-mentor` naming the focus and target_id.

### Verdict handling — advisory, identical in both modes

| Verdict | Action |
|---------|--------|
| `looks_solid` / `consider_addressing` | Surface `narrative_for_user`; continue. |
| `address_first` | Surface `narrative_for_user` and record each `must_address` item to the audit trail. **Do not block, re-open the resolved question, or force a remediation skill.** In interactive mode the watching researcher may choose to act on it; under `--autonomous`, log and continue. The mentor is a support, not a gatekeeper. |
| `refused` | Surface the refusal message; it names the correct target. |

## When to stop

Stop when one of:

- `project.status == "completed"` — the orchestrator writes this
  via `research_append` once all questions are `resolved` **and every
  tier-≥-probable conclusion is encoded in `tree.gedcomx.json`**
  (Tree-encoding gate) — see routing table
- The user explicitly halts you
- You hit a genuine blocker (no more accessible records, an
  irreducible conflict, missing access to a required repository) —
  in this case, summarize what was accomplished and what is blocked,
  then stop

In autonomous mode, do not stop just because a decision is hard.
Make the call, log the rationale, and continue. The audit trail
captures the choice for later review.

**These three are the *only* autonomous stop conditions.** Finishing a
sub-skill is not one of them — having selected a question, written a
plan, or run one search, you are mid-loop, not done. Do not end your
turn to report progress or to say what you'll do next; return to step 2
of "What to do" and invoke the next sub-skill. (See "Autonomous mode".)

## What this skill does not do

- It does not introduce new GPS logic. Every sub-skill encodes its
  own portion of the GPS standard; this skill only routes between
  them.
- It does not skip steps. GPS depends on the full chain —
  classification precedes person-linking, person-linking precedes
  conflict detection, conflict resolution precedes proof. Shortcuts
  break the audit trail.
- It does not interview the user for project setup. If
  `research.json` does not exist, route to `init-project` first.

## Re-invocation behavior

**Writes:** nothing directly. This skill is a thin orchestrator — it
reads `research.json` to decide the next step and delegates every
write to the sub-skill it routes to. It does **not** insert defensive
`validate_research_schema` passes between steps (the writer tools each
validate the whole project before persisting); it calls
`validate_research_schema` (read-only) only to confirm an external/manual
edit to the files. The only side-channel writes
during a run come from the `gps-mentor` subagent it invokes, which
writes verdict files under `evaluations/` and never touches
`research.json` or `tree.gedcomx.json`.

**On repeat invocation:** safe to re-run at any point. It re-reads
`research.json` and resumes routing from the current state — the same
sub-skill may fire many times across a project. Each sub-skill owns
its own idempotency (supersede-by-id, refine-in-place, or no-op); see
that sub-skill's own "Re-invocation behavior" section.

**Do not duplicate:** N/A at this layer — the orchestrator creates no
entries of its own. Duplicate-avoidance is each sub-skill's
responsibility.
