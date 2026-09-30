# Phase 4 — the cold start (detailed pass)

**Status:** BUILT, 2026-09-30, on the `research-as-a-job-phase2` branch (unmerged). All
three steps and all four acceptance items are done; see "Order of work" and
"Acceptance" below, each annotated with what landed. Parent:
`docs/plan/research-as-a-job-later-REVISED.md`, "## Phase 4 — the cold start".

What shipped, in the order the plan set:

| Step | Commit | Note |
|---|---|---|
| 1. The decisiveness signal in `person_search` | `bc2222201` | `pick: { decisive, tiedAtTop, reason }` on the RESPONSE, computed by `src/utils/person-search-decisiveness.ts`. Rule DERIVED from a live 8-query probe, which refuted the two rules proposed before it. |
| 2. The ask | `a6d98fd1f` | `init-project/SKILL.md` reads `pick.decisive`: auto-pick when true, `AskUserQuestion` with the top candidates when false. |
| 3. "Say what to expect" | `a6d98fd1f` | `SKILL.md:117`, suppressed when the first message already names a person ID. |
| Eval green | `871860350` | `v6_2026-09-30_13-45-44.json` — 14 pass, 1 partial, zero reds. `ut_init_project_012` (the new Mary-Hales-shaped test) passes; `ut_init_project_004` still auto-picks. Candidate, not released: release needs the genealogist annotation pass. |

**Two gaps this plan named and the first build missed**, closed afterwards:

- **The spec's worked example, Mapping Logic and behaviour table.** The plan called
  contract drift here explicitly. The response-fields table had been updated; the other
  three sites had not, so the example a reader would copy carried no `pick`.
- **Nothing asserted `pick` reaches the response at all.** Deleting
  `pick: decisiveness(results)` from `person-search.ts` left all 48 tests in both
  person-search files green — the RULE was tested exhaustively and the WIRING not at all,
  while `SKILL.md` branches on the field. Closed by `person-search.test.ts` 21a-21d,
  which also carry acceptance item 3 (determinism asserted directly, not inferred).
- A third guard was added that the plan did not ask for: `mcp-fixture-shape.test.ts`
  now checks each `person_search` fixture's `pick` against what `decisiveness()` computes
  from that fixture's own results. The mock serves fixtures verbatim, so a hand-written
  `pick` that disagreed with the rule would teach the eval the wrong behaviour with
  everything green.

## The failure, already captured

`init-project/SKILL.md` says, verbatim: **"In single-turn mode, select the top candidate."**
The agent picks the person for you. When the evidence is decisive that is right and cheap;
when it is not, a wrong pick spends a whole job — now up to $35 — and the parent plan puts a
wrong person at the root of the reported anchoring failure.

**This branch already ran the failure.** The bounded-request scenario "create a research plan
for Mary Hales" matched **35,921 people**; the run could not identify her, and instead of
asking it stalled to `no_progress`
(`docs/captures/2026-09-29-bounded-requests/`). That is this phase's case, observed.

## The rule is decisiveness, not "stop picking"

An eval rewards the current behaviour — `ut_init_project_004` expects the agent to
"select LZNY-BRF as the top candidate (score 4.85, confidence 3)". **That eval is right.**
Its user gave a name, a birth year, a country and a county; the top candidate is decisive.
Auto-picking there saves a turn nobody needed.

So the rule is not *stop auto-picking*. It is **ask when the candidates are not decisive**,
which leaves that eval passing and fixes the Mary Hales case. Framing it as "always ask" would
buy a paid eval slot to make the product worse.

## Computed, not reasoned

`person_search` already returns everything the judgement needs: `totalMatches`, and per
candidate `score` and `confidence`. So decisiveness is computed in the TOOL and returned, not
left to a model to weigh — the same principle the parent applies to the gaps offer ("computed
rather than reasoned"), and the same lane as every other rule decidable from the data.

A model asked to judge "is this decisive?" gives a different answer on different runs. A
number does not.

**One of the three candidate signals is already refuted by the two exhibits.** The decisive
Flynn pick is **confidence 3**; the hopeless Mary Hales top-ten are **all confidence 4**. So
`confidence` cannot gate decisiveness upward, and any rule that reads "high confidence means
pick it" is wrong before it is written.

**And `score` is not comparable across queries** — the tool spec says so outright. A
within-response first-vs-second GAP is therefore safe; a fixed absolute score threshold is not,
and proposing one would contradict the spec. Either the rule uses the gap, or the spec line
changes on probe evidence.

**To pin before building**, with the refuted one removed:

All three are now answered by the probe below: the gap is the wrong signal, `totalMatches`
alone does not separate the cases, and an absent score counts as not decisive.

### Step 0 DONE: probed live, 2026-09-30 — and the rule I proposed was wrong

`dev/probe-person-search-decisiveness.ts`, eight live queries spanning qualified, flood and
the middle cases, responses committed beside it. What it found:

| Probe | totalMatches | top-5 scores | tied at top |
|---|---|---|---|
| `flynn-qualified` | 1,281 | 5.2936, 5.2836, 5.2736, … | **1** |
| `mcandrew-qualified` | 54 | 5.1186, 4.3879, 4.3779, … | **1** |
| `mogan-middle` | 58 | 4.6236, 4.6136, 4.1236, … | **1** |
| `hales-flood` | 35,920 | 3.6236 × 5 | **5** |
| `smith-flood` | 781,746 | 3.6236 × 5 | **5** |
| `hales-year` | 4,356 | 4.1236 × 5 | **5** |
| `hales-year-place` | 1,115 | 5.1136 × 5 | **5** |
| `broyles-middle` | 1,508 | 4.1186 × 4 | **4** |

**The first-second GAP is the wrong signal, and the probe proves it.** `flynn-qualified` — the
very case `ut_init_project_004` is right to auto-pick — has a gap of **0.01**. Any gap
threshold above that misclassifies the eval's own case. My proposed rule would have been built
and then found wrong by a paid run.

**`totalMatches` alone is also wrong.** `flynn-qualified` (1,281) is decisive while
`broyles-middle` (1,508) is not, so no count threshold separates them.

**The signal is TIES AT THE TOP SCORE**, and it separates all eight cleanly. When several
candidates score identically the tool has no basis to prefer one — because the same few fields
matched for all of them — so a person must choose. Under-specified queries produce flat runs of
identical scores (3.6236 five times); a query with enough to work on produces a strictly
descending list.

**Derived rule:** decisive iff exactly one candidate holds the top score. An absent score
counts as not decisive, since a pick the tool cannot justify is exactly the one a person should
make.

**And the mock fixture is fiction.** `person-search-flynn.json` carries `totalMatches: 3` and
scores 4.85 / 3.21 / 2.10 — a gap of 1.64 that occurs nowhere in eight live queries, where real
gaps are 0, 0.01 or 0.73. Deriving a threshold from it would have encoded a world the API does
not produce. It is updated to probed values, which under the derived rule stays decisive (a
unique top score) and keeps `ut_init_project_004` passing.

## Order of work

1. **DONE (`bc2222201`). The decisiveness signal in `person_search`.** Tool-side, no skill edit, no eval slot.
   Valuable alone: it is the number the next step needs.
2. **DONE (`a6d98fd1f`). The ask.** When not decisive, the agent presents candidates and waits — which needs no new
   mechanism, because the decision exit and its card are built. R6 already ruled the pick does
   not wait for phase 3; it now does not have to.
3. **DONE (`a6d98fd1f`, `SKILL.md:117`). "Say what to expect"** — a line before the first search, so a job that runs an hour does
   not begin in silence.

## Edit sites the response change actually touches

Adding a signal to `person_search`'s response is not one file:

- `docs/specs/person-search-tool-spec.md` — the response table (which currently asserts
  personId/score/confidence are the ONLY non-GedcomX fields), the worked example, the mapping
  steps and the behaviour table. Contract drift otherwise.
- `tests/tools/person-search.test.ts` test 17b pins per-candidate keys to exactly
  `[confidence, gedcomx, personId, score]` — it breaks if the signal is per-candidate, which is
  an argument for putting it on the RESPONSE instead.
- The four `eval/fixtures/mcp/person-search-*.json` fixtures. Required field → all four fail
  `mcp-fixture-shape.test.ts`; optional → the mock serves them verbatim and the eval never
  exercises the signal. Either way they are backfilled, which stales referencing skills'
  run logs (warn-only arm).
- `init-project/SKILL.md` for step 2 — **which buys an init-project eval re-run and an
  annotation round.** "No skill edit, no eval slot" is true of step 1 ONLY; step 2's cost was
  left unsaid and is now priced.

## Not in this pass

- **The gaps offer** waits on #1689 and #2696, both OPEN: it rests on relatives' attached
  sources being imported, and they are not.
- **Candidate cards carrying parents and spouse** — now MEASURED, and smaller than it
  looked. The parent asks for cards showing what FamilySearch uses to tell namesakes
  apart: lifespan, places, **parents and spouse**. Two of those four already arrive.

  `dev/probe-candidate-distinguishability.ts`, four live queries, responses committed
  beside it (2026-09-30). Every flood query returned birth/death facts on **5 of 5** of
  its top candidates, and the top five were distinguishable from one another 4/5
  (hales-flood), 2/5 (smith-flood) and 5/5 (hales-year-place):

  | Probe | totalMatches | tiedAtTop | top-5 with any fact | distinct life-events |
  |---|---|---|---|---|
  | hales-flood | 35,920 | 20 | 5/5 | 4/5 |
  | smith-flood | 781,745 | 20 | 5/5 | 2/5 |
  | hales-year-place | 1,020 | 16 | 5/5 | 5/5 |
  | flynn-qualified (control) | 146 | 1 | 5/5 | 5/5 |

  So **lifespan and places need no enrichment** — `person_search` already carries them,
  and the ask is answerable today for a researcher who knows roughly where their person
  was born. What is genuinely absent is parents and spouse, stripped by design.

  Two things the probe also settled, neither of which was known when this section was
  written:

  - **The Mary Hales claim that "its top candidate had almost no distinguishing data"
    was right about the top candidate and wrong as a generalisation.** `LBF1-LHF` is
    indeed blank — and the next three carry a birth year and place, one with a full
    date and a death. The blanks are a minority, not the rule; smith-flood is the bad
    case at 4 of 5 blank.
  - **`tiedAtTop` is 20 in a real flood, not 5** — the tool returns 20 by default and
    all 20 share the top score.

  The open mechanism question (enrich `person_search` versus a `person_read` per
  candidate) therefore narrows to parents and spouse alone, for the minority of
  candidates that carry no life events. Still deferred, now priced against evidence.

- **The flood fixture is unrealistic, and this probe is what shows it.**
  `eval/fixtures/mcp/person-search-hales-namesakes.json` gives its five tied candidates
  **no facts at all**, so `ut_init_project_012` measures an ask over five identical
  blank options — a question no researcher could answer, and not the one the product
  will face. It does not change the RULE under test (decisiveness is computed from
  scores, so `pick.decisive: false` is right either way), only the realism of what the
  agent then presents. Correcting it restales the v6 run log and buys another
  init-project eval, so it is named here rather than done in passing.

## Acceptance — runnable, with a named test

"Ends the turn `decision`, not `no_progress`" was **unrunnable as written**: the `decision`
outcome and its card exist only on the unmerged `research-as-a-job-phase2` branch, and no
Mary-Hales-shaped test exists anywhere — the captures are one-off feeds, not repeatable
fixtures.

1. **MET.** `ut_init_project_012` + `eval/fixtures/mcp/person-search-hales-namesakes.json`; passes in `v6_2026-09-30_13-45-44.json`. **A new unit test and fixture** carry the real check: a `person_search` mock with
   `totalMatches: 35921` and tied top scores, and a `judge_context` requiring the agent to
   present candidates and ask — calling neither `person_read` nor the project writers.
2. **MET.** Passes in the same run. `ut_init_project_004` **still auto-picks and still passes**, against a fixture updated to
   probed values. A threshold that reclassifies it is wrong.
3. **MET** — `person-search.test.ts` 21d asserts it directly by calling the tool three times on the same response and deep-comparing `pick`. It was NOT met by the first build: nothing asserted `pick` reached the response at all (deleting it left all 48 tests green), so 21a-21c close the wiring and 21d this item. The signal is computed from the response alone, so the same input gives the same answer on
   every run — asserted directly, not inferred from a run.
4. **STANDS AS A PRECONDITION**, unchanged — this branch is still unmerged, so the `decision`-outcome half remains unverified end-to-end and is not claimed. The `decision`-outcome half is gated on the phase-2 branch merging, and is stated as a
   precondition rather than assumed.
