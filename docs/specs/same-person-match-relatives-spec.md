# `same_person` — match-relatives mode — Spec

> **Status:** Draft for implementation (junior dev). Tracks issue
> [#263](https://github.com/PioneerAIAcademy/cowork-genealogy/issues/263)
> ("Add match-relatives mode to `same_person`").
>
> **Read with:** `docs/specs/same-person-tool-spec.md` (the existing single-pair
> contract this extends) and `docs/specs/match-merge-workflow-spec.md` §9
> (matching-mob assembly — this spec revisits that §9 decision; see §1).

This adds an **optional second mode** to the existing `same_person` MCP tool.
Today `same_person` scores exactly one pair — the focus person in `gedcomx1`
against the focus person in `gedcomx2`. This spec adds a `matchRelatives` flag
(default `false`, so existing behavior is unchanged) that, when `true`, instead
matches the **relatives** of the two focus persons (parents, spouses, children)
and returns a list of `(targetId, candidateId, score)` triples — using cheap
local heuristics to avoid an N×M explosion of FamilySearch API calls.

---

## 1. Why this exists (and the §9 reconciliation)

When matching a **household** record to the tree (a census listing head +
spouse + children), you don't just want "is the head the same person?" — you
want to know **which** record-child corresponds to **which** tree-child. Today
that pairing is done by the `person-evidence` skill reasoning over names and
dates by hand (`match-merge-workflow-spec.md` §9 deliberately kept this on the
caller side: *"`same_person` is a pass-through … assembly is the caller's
responsibility, not a tool change."*).

This spec **revisits that decision** for the relative-pairing piece only. The
pairing requires one FamilySearch `matchTwoExamples` call per candidate pair —
network work that **must** run on the host (per the architecture rule in
`CLAUDE.md`: network → MCP tool, not skill). So we add a host-side mode that
does the heuristic pairing + scoring, and the skill consumes the result instead
of hand-reasoning it. The single-pair pass-through (`matchRelatives: false`)
**still works exactly as before** — this is purely additive. When this lands,
update `match-merge-workflow-spec.md` §9 to reference this mode.

---

## 2. Scope

**In scope**
- A new `matchRelatives?: boolean` input on `same_person` (default `false`).
- Gathering parents / spouses / children of each focus person from the input
  GedcomX.
- A deterministic, no-network **pre-pairing heuristic** (§5) that reduces the
  candidate pairs each role contributes.
- Fanning out one `matchTwoExamples` call per surviving pair (bounded
  concurrency) and returning the per-pair scores.

**Out of scope**
- Changing the single-pair path in any way.
- Matching relatives-of-relatives (grandparents, in-laws) — parents, spouses,
  and children of the two focus persons only.
- Optimal (Hungarian) assignment — greedy one-to-one is sufficient (§5.3).
- Deciding the merge / writing anything — this tool is read-only and returns
  scores; `person-evidence` / `proof-conclusion` decide.

> **Before you build — confirm the one load-bearing assumption.** This whole
> design assumes `matchTwoExamples` scores correctly when the
> `sourceDescription` anchor (`buildRawWithAnchor`) points at a **relative**,
> not the document's "main" person. The API doesn't distinguish focus from
> relative — it matches whichever two persons the anchors name, using the rest
> of the GedcomX as context — so it almost certainly works. But spend 10
> minutes first: with `dev/try-same-person.ts`, run a single pair anchored on a
> child of each side and confirm you get a sane score back. If that fails, stop
> and raise it before building the heuristic. Everything else here is cheap
> local code; this is the only external unknown.

---

## 3. Input

Add one optional field to `SamePersonInput`
(`packages/engine/mcp-server/src/types/same-person.ts`) and the tool schema
(`src/tools/same-person.ts` `samePersonSchema.inputSchema`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `gedcomx1`, `primaryId1` | as today | yes | The **focus** person on side 1 — relatives are gathered relative to this person. |
| `gedcomx2`, `primaryId2` | as today | yes | The focus person on side 2. |
| `matchRelatives` | `boolean` | no (default `false`) | When `false`: today's single-pair behavior, unchanged. When `true`: match the focus persons' relatives (§4) instead of the focus persons themselves. |

`primaryId1` / `primaryId2` are **still required** in relatives mode — they
identify whose relatives to gather on each side. Validation (`validateInput`)
is unchanged.

---

## 4. Behavior when `matchRelatives: true`

Algorithm (all of step 1–3 is local/no-network; only step 4 calls FamilySearch):

1. **Gather relatives per role, per side.** For the focus person `P` in a
   GedcomX document, walk `relationships[]`:
   - **parents** = every person `Q` with a `ParentChild` where `child === P`
     (the parent is `relationship.parent`).
   - **children** = every person `Q` with a `ParentChild` where `parent === P`
     (the child is `relationship.child`).
   - **spouses** = every person `Q` with a `Couple` where `person1 === P` or
     `person2 === P` (the spouse is the other id).
   Resolve each id to the `persons[]` entry; skip ids not present in `persons[]`.
   Do this for both the target side (`gedcomx1`/`primaryId1`) and the candidate
   side (`gedcomx2`/`primaryId2`). (This is the same relationship walk
   `Mob.collectRelatedIds` / `getParents` / `getChildren` / `getSpouses` already
   does in `src/utils/mob.ts:299-336` — model on it; do **not** import the
   warnings-domain `Mob` class. A small local helper, or a new
   `src/utils/relatives.ts` shared with future callers, is fine.)
   Cap each role list at `MAX_RELATIVES_PER_ROLE = 40` (mirrors Java's
   `MAX_CHILDREN_TO_COMPARE`); if a list exceeds the cap, keep the first 40.

2. **Pre-pair within each role (the heuristic, §5).** For each role
   independently, compute a cheap local `preScore` for every
   target×candidate pair, then greedily assign one-to-one pairings. This
   collapses N×M into at most `min(N, M)` pairs per role (fewer if the floor
   cuts weak pairs).

3. **Collect the surviving pairs** across all three roles into one work list of
   `{ role, target, candidate, preScore }`.

4. **Score each surviving pair via FamilySearch.** For each pair, call the
   existing single-pair scoring path with the **full** documents and the
   relatives' ids as the anchors:
   `scorePair(gedcomx1, target.id, gedcomx2, candidate.id, token)`. Run these
   with **bounded concurrency** (`mapWithConcurrency`, cap ~5) wrapped in
   `withRetry` (both in `src/utils/place-resolver.ts`). Reuse one OAuth token
   for the whole batch (call `getValidToken()` once).

5. **Return** the list (§6).

> **Refactor first:** extract the body of the current `samePerson` (lines
> 20–72, token → `buildRawWithAnchor` → `fetch` → parse `entries[0]`) into a
> reusable internal `async function scorePair(gedcomx1, id1, gedcomx2, id2,
> token): Promise<SamePersonResult>`. The single-pair path becomes
> `scorePair(...)` with the focus ids; relatives mode calls it per pair. The
> error handling (`throwForBadStatus`) and `buildRawWithAnchor` are reused
> as-is.

---

## 5. The pre-pairing heuristic (the crux — implement carefully)

The goal: given target relatives `T₁…Tₙ` and candidate relatives `C₁…Cₘ` of
the **same role**, pick the most-likely one-to-one pairings **without** calling
FamilySearch, so we only spend an API call on pairs that are plausibly the same
person. Worked example from the issue:

```
target children:    Bob 1810,  Mary 1812, John 1815
candidate children: Robert 1810, Mary 1813, John 1816
→ heuristic pairs:  (Bob,Robert) (Mary,Mary) (John,John)   ← 3 calls, not 9
```

### 5.1 Local pre-score for one (T, C) pair

All inputs come from the `persons[]` entries; no network.

- **Gender gate.** If both `T.gender` and `C.gender` are set and differ →
  `preScore = 0` (a male relative cannot be the same person as a female one;
  for spouses this compares the two *spouses* to each other, both of which are
  normally opposite-gender to the focus, so they should share gender).
- **Name score.** `nameScore = nameSimilarity(fullName(T), fullName(C))` where
  `fullName` = normalized `given + " " + surname`
  (`nameSimilarity` + `normalizeString` from `src/utils/string-similarity.ts`;
  it handles nicknames poorly but "Bob"/"Robert" still beats "Bob"/"Mary" —
  good enough as a *pre*-filter, since the real FS call makes the final call).
- **Year score.** Extract each side's **birth year** from a `Birth` fact's
  `standard_date` (fall back to any birth-like fact — `Christening`/`Baptism`;
  the set is `BIRTHLIKE_FACT_TYPES` in `src/utils/mob.ts`, but reference the
  constant, don't import `Mob`). `standard_date` is a normalized string seen in
  the data as `"1810"`, `"15 Jun 1810"`, or `"+1810-06-15"`; for the heuristic
  just pull the first 4-digit run with `/(\d{4})/` and parse it — full date
  precision is unnecessary for a pre-filter. Take the earliest such year if a
  person has several. If both sides have a year:
  `yearScore = max(0, 1 − |yearT − yearC| / YEAR_TOLERANCE)`,
  `YEAR_TOLERANCE = 10`. If either is missing: `yearScore = 0.5` (neutral — do
  not penalize for missing data).
- **Combine:** `preScore = 0.6 * nameScore + 0.4 * yearScore` (after the gender
  gate). The 0.6/0.4 split and `YEAR_TOLERANCE` are tunable constants — declare
  them as named constants at the top of the module with a comment.

### 5.2 Per-role pairing (greedy one-to-one)

```
pairs = []
candidatePreScores = [ (T, C, preScore(T,C)) for all T in targets, C in candidates ]
sort candidatePreScores by preScore DESCENDING,
     tie-break by (T.id, C.id) ASCENDING   # deterministic → stable, testable output
usedT = {}, usedC = {}
for (T, C, s) in candidatePreScores:
    if s < PRE_SCORE_FLOOR: break        # PRE_SCORE_FLOOR = 0.2
    if T in usedT or C in usedC: continue
    pairs.push({ role, target: T, candidate: C, preScore: s })
    usedT.add(T); usedC.add(C)
return pairs
```

- One-to-one: each target relative and each candidate relative is used at most
  once per role.
- `PRE_SCORE_FLOOR = 0.2`: a pair this dissimilar is almost certainly not the
  same person — don't spend an FS call on it. Tunable constant.
- Greedy (sort-then-assign) is deliberately chosen over optimal assignment
  (Hungarian): it's O(N·M·log(N·M)), trivial to reason about, and for ≤40
  relatives the difference from optimal is negligible. **Do not** implement
  Hungarian.

### 5.3 Bounding total work

After collecting pairs across all roles, cap the total at
`MAX_PAIR_CALLS = 30` (defensive — a pathological input shouldn't fire 120 FS
calls). If the floor + caps drop pairs, that's fine; if the cap is hit, keep the
highest-`preScore` pairs and **log/return** how many were dropped (don't
silently truncate — see `CLAUDE.md` "No silent caps").

---

## 6. Output

When `matchRelatives: true`, the tool returns a **different shape** from the
single-pair result (the schema description must make this explicit so the LLM
knows what it's getting):

```ts
export interface SamePersonRelativeMatch {
  role: "parent" | "spouse" | "child";
  targetId: string;        // persons[].id in gedcomx1
  candidateId: string;     // persons[].id in gedcomx2
  score: number;           // float 0-1 from FamilySearch (the real answer)
  confidence?: number;     // integer 1-10 bucket, omitted on no-match
  preScore: number;        // the local heuristic score (transparency/debugging)
}

export interface SamePersonRelativesResult {
  matchRelatives: true;    // discriminant so callers can tell the modes apart
  matches: SamePersonRelativeMatch[];
  droppedForCap?: number;  // present + > 0 only when MAX_PAIR_CALLS truncated
}
```

- `matches` is sorted by `role` then `score` descending.
- Roles with relatives on only one side, or whose every pair fell below
  `PRE_SCORE_FLOOR`, simply contribute nothing.
- The single-pair path's return type (`SamePersonResult`) is unchanged.
  `samePerson` becomes
  `Promise<SamePersonResult | SamePersonRelativesResult>`; callers discriminate
  on the `matchRelatives` field (absent on the single-pair result).

---

## 7. Edge cases

| Case | Behavior |
|---|---|
| `matchRelatives` omitted / `false` | Exactly today's single-pair behavior. No relative gathering, no extra calls. |
| A role has relatives on only one side | No pairs for that role (nothing to compare). |
| Unequal counts (3 target children, 2 candidate) | At most `min(N,M)` = 2 pairs; the unmatched target child is simply absent from `matches`. |
| A relative has no name and no date | Its `preScore` against everything is low (name 0, year neutral) → usually cut by the floor; never throws. |
| Gender conflict | `preScore = 0` → never paired, never called. |
| Same person id appears under two roles | Handle each role independently; a `(role, targetId, candidateId)` triple is unique. |
| Focus person has zero relatives on a side | Empty `matches` (or only the roles that do have relatives). |
| An FS call for one pair fails after retries | That pair is omitted from `matches` (or carries `score: 0`); one bad pair must not fail the whole batch. Decide one and state it in the impl comment. |
| `matchRelatives: true` but `gedcomx`/`primaryId` invalid | Same `validateInput` errors as today (the focus ids must still resolve). |

---

## 8. Errors

Reuse the existing `throwForBadStatus` per call. Token/WAF/4xx/5xx errors are
unchanged from `same-person-tool-spec.md` §"Error handling". The only new
decision is the per-pair failure policy (table above) — pick "omit the failed
pair, continue the batch" unless there's a reason not to, and comment it.

---

## 9. Code reuse (point the junior at these)

- **`src/tools/same-person.ts`** — extract `scorePair(...)` from `samePerson`;
  reuse `buildRawWithAnchor`, `throwForBadStatus`, `parseArkFromTitle`.
- **`src/utils/place-resolver.ts`** — `mapWithConcurrency` (bound the fan-out),
  `withRetry` (retry transient FS failures).
- **`src/utils/string-similarity.ts`** — `nameSimilarity`, `normalizeString`.
- **`src/utils/mob.ts:299-336`** — the canonical relationship walk to model the
  relative gathering on (do not import `Mob`; lift a small shared helper or
  inline it).
- **`src/auth/refresh.ts`** — `getValidToken()` once per batch.

No new MCP tool, no `manifest.json` change, no `tool-schemas.ts`/`index.ts`
dispatch change — `same_person` is already registered; only its input schema +
return type grow. (Keep the schema in sync with the new field; the packaging
drift test only checks tool *names*, so it won't catch a stale schema — review
by hand.)

---

## 10. Skills to update

### `person-evidence` — **required** (primary consumer)

`packages/engine/plugin/skills/person-evidence/SKILL.md`. Today it builds the
matching mob (Step 2) and calls `same_person` per persona for the **focus**
match, then the **Cross-person consistency check** (added under Step 7) asks
Claude to verify by hand that the household pairs cohere. Wire the new mode in:

- **Step 2 / Step 7:** when matching a **household** record (multiple
  co-enumerated personas), after the focus `same_person` call, call
  `same_person({ gedcomx1, primaryId1, gedcomx2, primaryId2, matchRelatives: true })`
  **once** to get the relative pairings + scores in one shot, instead of
  hand-reasoning each child/spouse/parent pair.
- Use the returned `matches` to:
  1. **drive the Cross-person consistency check** — the `(role, targetId,
     candidateId, score)` triples *are* the household pairing evidence; an
     incoherent assignment (a child that pairs to no candidate, or pairs with a
     low score) is the flag the consistency check looks for; and
  2. **seed the always-pair merge set** — each high-scoring relative match is a
     `[treePersonId, recordPersonaId]` pair with a ready confidence, so
     `person-evidence` doesn't re-derive it.
- Keep the existing per-link match-threshold policy: the relative `score` /
  `confidence` feeds confidence the same way the focus score does (a low
  relative score caps the link, a qualitative conflict still overrides).
- Note it's **optional** for non-household single-person matches (default
  `false`) — only reach for `matchRelatives: true` when there's a household to
  pair.

### `search-records` — **optional / future** (note only)

`search-records` already uses `same_person` for triage. `matchRelatives` could
help disambiguate which of several candidate households a record belongs to,
but that's a follow-up — call it out in the skill's "future" notes, don't wire
it now.

### `proof-conclusion`, `check-warnings`, `tree-edit` — **no change**

They consume the merge set / run the coherence gate; they don't call
`same_person` directly.

### Spec cross-reference — **in this PR, not before**

`match-merge-workflow-spec.md` §9 currently says relative assembly is the
caller's job and `same_person` is "not a tool change." That is **accurate for
the already-merged match-merge code** — so do **not** touch §9 until this
feature actually exists. Update it **as part of this same PR** (the PR that adds
the tool mode + the `person-evidence` adoption), so the spec and code change
together: note that relative *pairing* now has an optional tool-side mode (this
spec), while the focus match stays a pass-through. Editing §9 earlier, or in a
separate change, would describe behavior that isn't shipped.

### Ownership (so nothing breaks on hand-off)

- **Tool (§3–§9): the junior's lane.** Pure TS + tests, no eval coupling.
- **`person-evidence` SKILL.md edit: coordinate with the senior.** Editing any
  file under a skill flips that skill's eval run logs inactive, and the
  `check-runlogs` CI **blocks the PR** until the skill's eval is re-run and a
  fresh run log is committed (`eval/CLAUDE.md` "GitHub Action rules"). That
  re-run needs an `ANTHROPIC_API_KEY` + the eval harness — confirm who runs it
  before bundling the skill change into the PR.
- **§9 spec edit:** trivial prose, lands in the same PR (above).

---

## 11. Testing

- **Unit — heuristic (pure, no network):** test `preScore` (name + year +
  gender gate), and the greedy per-role assignment on the issue's Bob/Robert
  example → exactly `(Bob,Robert) (Mary,Mary) (John,John)`; plus unequal counts,
  gender conflict, missing dates, and the floor/cap. These are deterministic and
  should be the bulk of the coverage.
- **Unit — tool (mock FS):** mock `fetch` (as `same-person.test.ts` does for the
  single-pair path) and assert: (a) `matchRelatives: false` is byte-identical to
  today; (b) `matchRelatives: true` issues exactly the heuristic-selected number
  of `matchTwoExamples` calls (not N×M) and assembles the `matches` list with the
  right ids/roles; (c) a per-pair failure omits that pair without failing the
  batch.
- **`dev/try-same-person.ts`** — extend (or add `dev/try-same-person-relatives.ts`)
  to run relatives mode against two live `record_search` results for manual
  verification.
- Run via `make engine-test`; `same_person` is auth'd, so live verification uses
  the `dev/try-` script per `eval/CLAUDE.md`.

---

## 12. Decisions for the senior to confirm

- **Heuristic weights/constants** (`0.6/0.4`, `YEAR_TOLERANCE=10`,
  `PRE_SCORE_FLOOR=0.2`, `MAX_PAIR_CALLS=30`): sensible defaults; tune against a
  real census household once it's running.
- **Per-pair failure policy:** omit-and-continue (recommended) vs. `score: 0`.
- **Return-shape discriminant:** `matchRelatives: true` on the result (chosen
  here) vs. a separate field — confirm it reads cleanly for the LLM.
- **Greedy vs. optimal assignment:** greedy is specced; confirm that's
  acceptable (it is for ≤40 relatives).
