# Narrative-craft dimension for gps-mentor — plan

> **Status:** Proposed — not started. Authored 2026-07-24 from a review of
> `DigitalArchivst/Open-Genealogy` (external repo, cloned and read directly).
> No implementation branch yet. Touches
> `docs/specs/gps-mentor-agent-spec.md`, the source of truth the shipped
> `packages/engine/plugin/agents/gps-mentor.md` must conform to — this is a
> spec delta, not a direct prompt edit.
> **Goal:** give `gps-mentor` a way to evaluate whether a finished write-up
> is actually good to read, not just GPS-defensible — without taking on the
> multi-file cost of a new closed-enum value unless usage later proves it's
> worth it.

## 1. Why (verified, not assumed)

`gps-mentor`'s rubric (`docs/specs/gps-mentor-agent-spec.md` §6) has three
focus modes — `pre-exhaustiveness`, `conclusion-readiness`, `proof-critique`
— and every check in all three is GPS-evidentiary-compliance-focused: tier
defensibility, hedging-vs-tier consistency, narrative self-containment (can
a reader follow the *argument*, a comprehension check, not a craft one),
the BCG peer-reviewer test, Standard 43. `proof-critique`'s job (§6.3) is
"would a BCG peer reviewer certify this" — nothing asks "would a family
member or a local historical society enjoy reading this."

Open-Genealogy's `benchmark/rubrics/genealogical-writing-rubric.md` scores a
finished write-up across three layers (60 points total); Layers 2–3 —
narrative clarity, audience calibration, context provision, engagement
value, verifiability, research leads, contribution to knowledge — are
dimensions we score nowhere.

These are genuinely different axes, not a subset of what we already check:
a proof can pass every existing `proof-critique` check (fully defensible)
and still be tedious to read, under-contextualized for its intended
audience, or leave the reader nowhere to go next.

## 2. Design — where this hooks in (two options, real cost difference)

The `focus` field is a **closed enum**, in three places today: `research.
schema.json`'s `$defs/evaluation_entry.focus` (spec §12.5, currently
`["pre-exhaustiveness", "conclusion-readiness", "proof-critique",
"on-demand"]`), the matching `evaluation_focus` hardcoded set in
`validator.ts` (spec §12.6), and — per this project's own enum-change
convention — the mirrored TS union in `packages/schema/src/index.ts`. That's
real, multi-file cost, and it's the deciding factor between the two options
below.

### Option A (recommended) — extend `on-demand`, no schema change

§6.4 `on-demand` is already the flexible catch-all: "apply rubric checks
from whichever focus mode most fits the current state of the target… a
quick read, not a full audit." Add a narrative-craft checklist — adapted in
our own words from Open-Genealogy's Layer 2/3 axes: audience calibration,
engagement, context-setting, verifiability of claims made in the prose, and
a research-leads check ("where would you look next") — that `on-demand`
draws on when the user's request is about presentation rather than GPS
compliance ("is this a good read", "polish this for my family", "prepare
this to share").

Zero schema, validator, or `packages/schema` changes. This is a prose-only
addition to the spec (§6.4) and, once that lands, to `gps-mentor.md`.

### Option B — a new closed-enum `focus` value

E.g. `"narrative-craft"` or `"publication-readiness"`, wired as a 4th
orchestrator-invocable mode alongside the existing three. Costs: the
3-file enum change above, a new §6.5 rubric section, and a real open
question — should this be able to **block** progress the way
`proof-critique`'s `address_first` verdict does, or stay advisory-only?
Only worth it if the answer to that question is "yes, it should gate."

**Recommendation: Option A.** Lower cost, same user-facing value (a
narrative-craft review, available on request), and it sidesteps deciding
"mandatory gate or not" before anyone has used the check even once.
Promote to Option B later only if usage shows it should be a standing
gate — the same "earned, not assumed" discipline this same spec already
applies to the (unrelated) mentor-cost-reduction question in its own §17.1.

## 3. Changes by area (Option A)

- `docs/specs/gps-mentor-agent-spec.md` — extend §6.4 `on-demand` with the
  narrative-craft checklist (own words — Open-Genealogy's rubric prose is
  CC BY-NC-SA; the axes it measures are not copyrightable, its sentences
  are). Add a row noting Option B was considered and explicitly deferred
  (not silently dropped), per this repo's convention of recording *why* a
  path wasn't taken.
- `packages/engine/plugin/agents/gps-mentor.md` — the actual prompt update,
  once the spec delta lands (spec-first, per this repo's existing
  convention that the agent body must conform to the spec).
- No changes to `research.schema.json`, `validator.ts`, or `packages/schema`
  under Option A.

## 4. Decisions

1. **Option A vs. B** — *(proposed: A; see §2 recommendation.)*
2. **Exact checklist wording and scoring** — needs the GPS/spec owner's
   pass; this plan does not fix it (the spec is explicitly "the source of
   truth… the implementation must conform to what is written here" — a real
   design decision, not a placeholder to rubber-stamp).
3. **If Option A later argues for Option B** — that's a new spec delta on
   top of this one, not a reopening of it; keep the audit trail the way
   `evaluations[].superseded_by` already does for re-evaluations.

## 5. Sequencing

1. Spec delta (§6.4 extension in `gps-mentor-agent-spec.md`).
2. `gps-mentor.md` prompt update to conform.
3. **(blocked on existing, unrelated work — not new to this plan)** an eval
   fixture: per the same spec's own §17.1, the e2e harness does not yet
   stage `packages/engine/plugin/agents/` into the sandboxed workspace —
   `build_workspace` copies only `plugin/skills/` — so `gps-mentor` is
   invisible to e2e today, regardless of this change. A narrative-craft
   fixture needs either a unit-level harness path that can invoke the agent
   directly, or to wait on the broader agent-staging work already tracked
   in that §17.1. Don't re-derive that gap here — it already blocks
   measuring the three existing gates too.
