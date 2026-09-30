# Phase 3 — the loop (detailed pass)

**Status:** NOT BUILT. Written 2026-09-30, after phase 2 landed **on the
`research-as-a-job-phase2` branch (unmerged — `main` has none of it)**. Parent:
`docs/plan/research-as-a-job-later-REVISED.md`, "## Phase 3 — the loop". Revised after
plan-critic round 1, which found five blocking defects; all applied.

**Not blocked by the Before-phase-2 acceptance.** Phase 3 names neither #2927 nor #2793, and
nothing here needs the three-run measurement.

## What the evidence settles, and what it does not

| | |
|---|---|
| `AskUserQuestion` calls in the 133-minute capture | **0** |
| `AskUserQuestion` calls in the committed UNIT corpus | **15, across 6 skills, unprompted** |
| Plan items in the capture | 15 — 12 completed, 3 skipped |
| Fields on a plan item recording an OUTCOME | **none** (nine required, all describing the plan) |
| `plan_item_status` today | `planned`, `in_progress`, `completed`, `skipped` |

**The 0 is real but must not be read as a rate.** That capture's objective was *chosen* so the
run could reason its way to an answer alone; it was selected to be autonomously answerable. And
the unit corpus calls `AskUserQuestion` 15 times across 6 skills unprompted. The design
conclusion — a rare, unmissable surface — rests on the parent's ruling, **not** on n=1 with
selection bias.

## 1. The decision card

Phase 1's exit already carries the signal (`DECISION_TOOL` in `proto/worker/options.py`, the
`decision` outcome in `continue_policy.py`). **This is the card, not the mechanism.**

Today the browser renders one line — `'Waiting on you — see the question above.'`
(`chatEvents.ts`). The card the parent describes is unbuilt `apps/web` work.

**[BLOCKING, from review] Three things must be pinned before any code, because the ruling as
written cannot be implemented:**

1. **Where the recommendation lives.** R9 says *not sure* continues on the option the agent
   **recommended** — but `AskUserQuestion`'s input carries `questions`/`options` with **no
   recommendation marker**. There is nowhere to read it from. Pin the convention: how the model
   marks its recommendation, and where the client reads it.
2. **Who acts on *not sure*.** The web client synthesizing the next message, or the worker?
   Nothing today does either.
3. **The rendering site.** `ChatPane.tsx` — the card replaces the one-line label for a turn
   that ended `decision`.

Ruled and not to be re-litigated: *not sure* continues on the **recommended** option (R9), and
**no bigger model is consulted** — same evidence, added latency and spend, and `gps-mentor`
already gives a second opinion on conclusions.

## 2. Errands, and the three kinds of nothing (one item, per R5)

An errand is work only the researcher can do. It pauses the job and waits, as
`search-external-sites`' wait does (ruled 2026-09-27).

### The three kinds of nothing is a `log_outcome` VALUE, not a field

**[BLOCKING, corrected]** An earlier draft said "a field, not a status". That contradicts the
parent, which settled it: a search that was not run gets a `log_outcome` value of its own —
**`not_searched`**, written in place of `negative`. That makes this a **second closed-enum
change**, with R5's own site list: `search-external-sites/SKILL.md` steps 3–4, the graded
fixture `eval/tests/unit/search-external-sites/autonomous-defer-external-search.json` (which
currently *requires* `negative`), and its `rubric.md`. **`search-records/SKILL.md` is owned by
PR #2971, still open** — the collision warning still binds.

### The real cost is the readers, not the four schema files

**[BLOCKING, restored]** A closed-enum change costs the enum sites *and* every site that
reasons about the values. For `waiting` on `plan_item_status`:

- **Schema:** `enums.schema.json` in BOTH trees, `CLOSED_ENUMS` in `validator.ts`, the prose
  tables in `research-schema-spec.md`. The TS union is **generated** — `gen-enums.mjs` throws
  rather than let a hand-written one shadow it.
- **If what-is-needed becomes a FIELD on the item:** `plan_item` is
  `additionalProperties: false`, so that is the *new-field* list — `research.schema.json` in
  both trees, the spec prose table, `validator.ts`, and the `packages/schema/src/index.ts`
  interface.
- **If it becomes a separate errand RECORD:** that is a new section, which additionally needs
  a row in `docs/specs/schemas/ownership.json` — a packaging test fails until it exists.
- **Semantic readers, each a paid eval slot:** `agents/research-exhaustiveness.md` (declares
  only when every item is `completed` or `skipped` — a `waiting` item either blocks that gate
  forever or does not, and nothing decides which), `skills/project-status/SKILL.md` (active =
  `planned`|`in_progress`, so `waiting` items vanish from the count),
  `skills/research-plan/SKILL.md` (enumerates the legal values and transitions),
  `skills/search-external-sites/SKILL.md` (the wait table mapping handed-over → `in_progress`
  — the exact rows `waiting` replaces), `validators/test_search_external_sites.py` and its
  `rubric.md`, `agents/search-images.md`, `skills/search-records/SKILL.md`.

### Sequencing

**[BLOCKING, restored]** Three other `plan_item_status` changes are in flight and the parent
says none is sequenced: **#1830** (open — `skip_reason`/`skip_category`), **#2539** (open — the
gate rewrite), **#2475** (absorbed #1821). A `waiting` value lands on top of all three.
Sequence against them before touching the enum, or two of the four collide in the same file.

### Open questions, to answer before any code

1. Does `waiting` replace `in_progress` on the item, or sit beside it? An item can be started
   and blocked at once.
2. Do plan-driven errands **also** mirror what-is-needed onto the item? (Narrowed: the parent
   already settles that an errand record exists regardless, since an ad-hoc errand has no plan
   item to live on.)
3. **Does an outstanding errand permit `completed`?** The parent pins this explicitly as
   undefined; an earlier draft dropped it.
4. Does answering an errand resume the same session, or start a turn?

## 3–5. Corrections, change review, dead ends

Deferred to their own passes, named so they are not lost: a correction is recorded state rather
than a chat turn; change review opens on what a conclusion rests on (R8: one of its three
claimed data sources does not exist); dead ends become next actions.

## Order of work

Item 1 first — smaller, its ruling made, no schema change — but only after its three pins
above. Item 2 second, after its four questions are answered and sequenced against
#1830/#2539/#2475.

## Acceptance — with a run that can actually be made to fire

**[BLOCKING, corrected]** "A decision card fires when the agent genuinely cannot proceed" has
no stopping condition on a surface that fired zero times in 133 minutes. The parent named two
forcing scenarios and an earlier draft dropped both:

- **Replay issue #2864's Fold3 thread**: the petition is raised **once**, carrying its
  identifiers, the turn ends waiting, and a reply of "later" resumes **without re-raising**.
  Never-re-raised is the core defect — it was raised **7 times in 8 turns** — and must be
  asserted, not assumed.
- **A `bagley-father-1884` replay as the negative control**: shows no card at all.

Plus: *not sure* continues on the recommended option and the run reaches a conclusion; and an
errand leaves its plan item readable as *waiting on the researcher*, distinguishable from one
searched and found nothing.

The decision exit itself is a **`PreToolUse` arm**, already unit-tested in
`tests/test_proto_worker.py` — an earlier draft wrongly said the unit harness could not reach
it because it "binds no Stop hook". What only a live run proves is the **rendering and the
resume**, which is exactly why the forcing scenario has to be named.
