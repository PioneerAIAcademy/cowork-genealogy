# Phase 4 — the cold start (detailed pass)

**Status:** NOT BUILT. Written 2026-09-30 after phase 3's items 1, 3, 4 and 5 landed on the
`research-as-a-job-phase2` branch (unmerged). Parent:
`docs/plan/research-as-a-job-later-REVISED.md`, "## Phase 4 — the cold start".

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

1. **The decisiveness signal in `person_search`.** Tool-side, no skill edit, no eval slot.
   Valuable alone: it is the number the next step needs.
2. **The ask.** When not decisive, the agent presents candidates and waits — which needs no new
   mechanism, because the decision exit and its card are built. R6 already ruled the pick does
   not wait for phase 3; it now does not have to.
3. **"Say what to expect"** — a line before the first search, so a job that runs an hour does
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
- **Candidate cards carrying parents and spouse.** The parent asks for cards showing what
  FamilySearch uses to tell namesakes apart — lifespan, places, **parents and spouse** — and
  itself notes that `person_search` strips relatives by design (pinned by test 17). The Mary
  Hales run shows why it matters: its top candidate had almost no distinguishing data. So
  step 2 may present candidates a researcher still cannot tell apart. The open mechanism
  question is enrich `person_search` versus a `person_read` per candidate; deferred, not
  dropped.

## Acceptance — runnable, with a named test

"Ends the turn `decision`, not `no_progress`" was **unrunnable as written**: the `decision`
outcome and its card exist only on the unmerged `research-as-a-job-phase2` branch, and no
Mary-Hales-shaped test exists anywhere — the captures are one-off feeds, not repeatable
fixtures.

1. **A new unit test and fixture** carry the real check: a `person_search` mock with
   `totalMatches: 35921` and tied top scores, and a `judge_context` requiring the agent to
   present candidates and ask — calling neither `person_read` nor the project writers.
2. `ut_init_project_004` **still auto-picks and still passes**, against a fixture updated to
   probed values. A threshold that reclassifies it is wrong.
3. The signal is computed from the response alone, so the same input gives the same answer on
   every run — asserted directly, not inferred from a run.
4. The `decision`-outcome half is gated on the phase-2 branch merging, and is stated as a
   precondition rather than assumed.
