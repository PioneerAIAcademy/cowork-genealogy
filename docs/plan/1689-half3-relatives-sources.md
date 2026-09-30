# Issue #1689 Half 3 — relatives' attached sources

**Status:** NOT BUILT. Written 2026-09-30 on `1689-half3-relatives-sources`, branched from
`origin/main` at `ee0b68541`. **Revised the same day** after a plan review found two
blocking defects — including one that would have made the feature fetch everything and
still drop it. Issue: #1689, assignee `Praise-Enato`, board column **In Progress**.

## What this is

A relative comes back from `person_read` as a person, facts and relationships with **no
sources of their own**, so a project that starts from a well-sourced tree node starts blind
to every source hanging off its relatives, and re-derives what is already attached.

**Decided (lead, 2026-08-27) — the tool returns them.** As **ordinary entries in
`sources[]` with no discriminator** — the same shape ruling 2 set for memories. The
skill-loop alternative was declined: anything else reintroduces a downstream branch, and a
skill-side rule for when to spend N calls is a rule the model can skip silently. **Nothing
here is open for redesign** — this plan implements a decided ruling.

## Why it matters, from two live cases

- **#1795** ("Pancho Villa's Children"). FamilySearch lists **63 children**; the run
  confirmed 4. One `person_read` for the session, **zero** `source_attachments` calls, no
  second read for any child.
- **#1948** ("Morgan Texas move"), independent tester, different tree — and it adds what
  #1795 does not. Eugenia Morgan's profile records her marriage as *"of Liberty, Amite,
  Mississippi"*. The agent went straight to record search, found the couple's **Texas**
  marriage, and never saw the Mississippi claim, so a contradiction that belongs in
  `conflicts[]` was never raised.

**That second case sets the bar.** A relative's attached source is not merely cheaper
evidence; it is evidence that **contradicts** the search. Skipping it produces a confident
wrong answer rather than a slow right one.

## What is already true — verified on `main`, and re-verified by the review

| | |
|---|---|
| Subject's person-level sources | **carried** (PR #3066). `persons[].sources` as `{ref, page?, quality?}` |
| Relatives' source **refs** | **already in the tree-read body** — as **full URLs** to descriptions FamilySearch does not send in that body |
| What happens to them now | **dropped.** `keepResolvablePersonSourceRefs` (`person-read.ts:1115`) removes every ref whose target is not an id in `sources[]`; a dangling ref makes `project_create` refuse the whole tree |
| Measured | probe 2026-09-30: subject **17/17**, **24/24**; relatives **0/102**, **2/79** |
| **The flags are IGNORED** | `relatives` and `sourceDescriptions` are accepted and do nothing — both always read (lead rulings 2026-09-22 via #2666, 2026-09-27; `person-read.ts:68-75, 93-95`). **So this fetch runs on EVERY `person_read`, for every caller** — not only `init-project` but `forget-and-rederive`, `source-evaluation`, and the `gps-mentor` / `tree-edit` agents |
| Shared deadline | `person_read` anchors `OCR_PHASE_BUDGET_MS = 40_000` before the tree read (`:104, :230`), shared by the parent fan-out and memories paging, sized against the 60s Cowork bridge abort |
| The spec | `person-read-tool-spec.md:131` ends "**Carrying relatives' own sources is not in scope.**" |
| Half 2 constraint | relatives' sources are **not** transcribed |

**Always-on does not reopen the 2026-08-27 ruling — it strengthens it** (there is no flag
for a skill to forget). But the premise has changed since the ruling was written, and per
the repo's rule that is named rather than glossed: **every caller now pays this cost.**

## The mechanism, corrected — a merge alone is NOT enough

The first draft said: fetch the descriptions, merge them into `sources[]` before
`keepResolvablePersonSourceRefs`, and the refs resolve. **That is wrong, and it fails
silently.**

`keepResolvablePersonSourceRefs` matches by **exact string equality** —
`ids.has(r.ref)` against `result.sources.map(s => s.id)` (`:1116-1119`). A relative's ref
is a full URL; a merged description carries a **bare id**. A URL never equals an id, so
after fetching and merging, **every relative ref is still dropped** — the feature would do
its work and throw it away, with all tests green.

**So there is a third step the draft missed: rewrite the ref.** The bare id is already in
the upstream payload as `descriptionId` beside the URL (pinned at
`tests/tools/person-read.test.ts:1725-1726`), and `simplifySourceRef` discards it — it
reads only `ref.description` through `stripFragment`, which strips a leading `#` and passes
URLs through untouched (`utils/gedcomx-convert.ts:105-108, 377-382`).

Two candidate rewrites, and the probe decides:
- **Carry `descriptionId` through `simplifySourceRef`** — uses what upstream already sends.
- **Strip the URL to its last path segment**, as `extractPersonRef` does for person refs.

Prefer the first if `descriptionId` is always present; the second is a derivation that can
disagree with the id it is meant to name.

## Step 0 — probe before writing the fetch

Same discipline Half 2 used. New `packages/engine/mcp-server/dev/probe-relative-sources.ts`,
responses committed beside it. It must answer:

1. **What shape is a relative's ref?** Full URL, `#fragment`, or mixed — per relative and
   in aggregate. "Mostly URLs" is not a contract, and **the two of 79 that DID resolve need
   explaining** before code assumes either shape.
2. **Is `descriptionId` always present** alongside a URL-form ref, and **does the URL's last
   segment equal it?** This decides the rewrite above. If they ever disagree, say which is
   authoritative.
3. **What resolves a description from that ref?** In cost order: (a) GET the ref URL; (b) a
   batch descriptions endpoint; (c) `GET /platform/tree/persons/{pid}/sources` per relative.
   Report which works, its auth, and whether it is one call or N.
4. **How many calls, AND elapsed wall time**, at 4 relatives and at 63 — measured against
   the **40s `OCR_PHASE_BUDGET_MS`** the read already shares. A per-relative endpoint at 63
   relatives could blow it and time out the whole read. Call count alone does not answer
   this.
5. **THE MEASUREMENT THE RULING DEMANDS**: response size for #1795's 63-child subject,
   **reported in the PR body**. *"If it is large enough to threaten the context budget, come
   back with the number rather than inventing a cap."* A cap invented here is out of scope.
6. **Size all three axes at once** — fan-out (Half 1), memories (Half 2), relatives'
   sources — not three times.
7. **Duplicates.** When two relatives share a source, does the description come back twice?
   `sources[]` ids must stay unique or the tree write breaks.

## Order of work

1. **The probe.** No production code until its answers are in the issue.
2. **The fetch** — `src/utils/relative-sources.ts`, beside `memories.ts` (`person-read.ts`
   is already 1,209 lines). **Takes `deadline`**, like `fetchMemories`, so it shares the
   40s budget rather than adding a fourth unbounded axis.
   **Fail-soft exactly as memories does**: catch, write one line to **stderr**, return the
   tree read unchanged. No response-side marker — see acceptance #5.
3. **The ref rewrite** (above). Without it steps 2 and 4 are wasted.
4. **The merge**, before `keepResolvablePersonSourceRefs`. Verified call order:
   `mergeMemories` (`:124`) → `keepResolvablePersonSourceRefs` (`:133`) → staging
   (`:139-143`). Inserting before `:133` preserves the staged-equals-returned invariant
   (spec test 25) and does not touch `dropStrandedPersons`.
5. **Dedupe** by source id before the tree write.
6. **Spec, tests, and the skill check.**

## Edit sites

- `src/tools/person-read.ts` — the fetch call, the merge, ordering vs
  `keepResolvablePersonSourceRefs`, **and the `sourceDescriptions` schema description at
  `:72-75`**, which currently reads "Ignored: attached sources are always returned."
  (**not** `tool-schemas.ts`, which only imports the schema)
- `src/utils/relative-sources.ts` (new) — fetch + fail-soft + deadline
- `src/utils/gedcomx-convert.ts` — **only if** the rewrite carries `descriptionId` through
  `simplifySourceRef`. If so, `docs/specs/gedcomx-convert-spec.md` and
  `docs/specs/simplified-gedcomx-spec.md` come with it
- `src/types/person-read.ts` — if the response shape needs it
- `docs/specs/person-read-tool-spec.md` — `:131`'s closing sentence is now false;
  behaviour **row 3 (`:982`)** and **row 29 (`:1008`)**
- `tests/tools/person-read.test.ts` — **test 29 at `:1737` REVERSES.** It asserts
  `expect("sources" in kid).toBe(false)` for the child whose only ref is a full URL —
  exactly the behaviour this change undoes. Its old expectation becomes the
  fetch-failure case. Naming it here so an implementer does not "fix the test" and miss
  that the drop is the thing being changed

**No schema sites.** No new fields anywhere — `persons[].sources` refs and `TreeSource`
entries already exist (landed with #3066) — so `packages/schema`, `validator.ts` and
`tree-shape.ts` need no edit, and no eval fixture carries a full-URL ref that would break.

## The eval slot, and why a run would measure nothing

`init-project/SKILL.md:141` already says to include "all source descriptions in the
top-level `sources` array", so extra entries may flow through with no skill edit.

**But the stronger fact is that the init-project eval runs against canned fixtures**
(`eval/fixtures/mcp/person-read-*.json`, staged via `stagePersonRead`), so a tool-only
change is **invisible to the eval regardless** — a paid run would measure nothing new
unless the fixtures are also enriched.

The flip side: then nothing exercises the behaviour this change exists for — a 63-child
response with relatives' sources reaching the skill, whose own prose already warns results
may be "too large to `Read` directly".

**Pick one in the PR body, explicitly:** fixtures stay frozen (no run, and say the eval
cannot see this), or fixtures are enriched (which holds the contended slot — this branch's
sibling `research-as-a-job-phase2`, PR #3064 and PR #3000 also hold it, and whoever lands
second rebases and re-runs).

**The issue's cost line is stale.** It says all three halves "land in one PR, on one paid
run and one annotation pass". Halves 1 and 2 landed separately (#2593, #2586), so that
arithmetic no longer holds. Say so in the PR body.

## Acceptance

1. `person_read` on a subject whose relatives carry attached sources returns those sources
   as **ordinary entries in `sources[]`** — no discriminator, top level still exactly
   `{persons, relationships, sources}` (**without `projectPath`**; staging adds
   `staged`/`stagingError`).
2. The relatives' `persons[].sources` refs **resolve and are kept**, where today they are
   dropped — which requires the rewrite, not just the merge. Asserted on a fixture built
   from the probe's real response.
3. **The #1948 shape, pinned to something checkable**: a fixture from Eugenia Morgan's real
   read asserts the description containing *"of Liberty, Amite, Mississippi"* is present in
   `sources[]` and ref'd from her person entry. The `conflicts[]` half is downstream agent
   behaviour and is **out of this PR's scope** — a unit test cannot assert "the
   contradiction is visible".
4. A subject whose relatives have no sources returns output **identical to today**
   (**without `projectPath`**; staging embeds a `randomUUID()` filename and a `retrieved`
   timestamp).
5. The fetch failing (500, timeout) returns the **unmerged tree read**, asserted by test,
   and logs one line to **stderr**. **No response-side marker** — acceptance #1 pins the
   top level, and the memories fail-soft this mirrors is likewise silent to the agent. If
   an agent-visible report is ever wanted it touches the 2026-08-27 shape ruling and is the
   lead's call, not this PR's.
6. Relatives' sources are **not** transcribed.
7. `sources[]` ids stay unique when two relatives share a source.
8. The measured response size for #1795's 63-child subject is **in the PR body**, per the
   ruling.

## Not in this pass

- **A size cap.** The ruling forbids inventing one.
- **Transcribing relatives' memories** — Half 2 ruled it out on the 63-child case.
- **An agent-visible failure report** — see acceptance #5.
- **`research-plan`'s "review what is already attached" prose** — the #1948 tester found no
  plan item says this; the issue puts it in `research-plan`'s lane with #1917, "deliberately
  not part of this card".
