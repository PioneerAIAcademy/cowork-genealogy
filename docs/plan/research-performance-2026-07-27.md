# Research-session performance — measured plan

**Status:** DRAFT rev.2, for review (dev + genealogist) · **Date:** 2026-07-27
**Source:** alpha-feedback bundle `feedback-2026-07-27T14-24-48-034883Z.zip`
(project "James L. Stephens's Parents"; tester note: *"This took a long time and
cost a lot of money. How can we speed things up in the future?"*)
**Relationship to existing plans:** this is the Phase 0 re-measurement that
[`research-latency-reduction-plan.md`](research-latency-reduction-plan.md) §3 asks
for, against a session ~8× longer than the Kenneth Quass baseline it was written
from. It confirms that plan's headline finding (tool latency ≈ 0).
[`orchestrator-state-diet-plan.md`](orchestrator-state-diet-plan.md) is referenced
but not absorbed — see §6.

> **rev.2 supersedes rev.1 after adversarial review.** Four rev.1 findings were
> wrong and are corrected in place: F2's mechanism (§2 F2), F1's cause and cost
> (§2 F1), the nil-search population (§2 F5), and the payload-diet ceiling
> (§2 F3). Two changes were dropped and the priority order inverted. §7 records
> what was refuted so the same mistakes aren't re-derived.
>
> **rev.2a** then reworked C2 around the diagnosis that *we* starve the subject we
> hand to FamilySearch's matcher (§3 C2), added C5 (§3), and downgraded the
> search+rank+log fold from "excluded" to "deferred pending C2" after one premise
> of the original owner decision — re-ranking a logged search later — was measured
> as never exercised (§6).

---

## 1. The measurement

One research question ("find the parents of KVG8-28S"), hosted web platform,
`claude-sonnet-4-6`, reasoning effort `high` on all 309 turns.

| | |
|---|---|
| Wall clock | 19h 12m |
| Idle (tester away, incl. overnight; >180 s gaps) | 14h 20m |
| **Active** | **4h 52m** |
| — main-thread generation | 3h 48m (78%) |
| — **compaction summarisation** | **56m (17%, 23 events, median 137 s)** |
| — tool + FamilySearch API | 9m |
| — human typing | 7m |
| Model turns | 309 (659 tool calls, 2.1/turn) |
| Output tokens | 865,371 |
| Context: median / max | 108,916 / 178,054 |
| **Auto-compactions** | **23** |
| Est. cost, main thread | ~$37 |
| Produced | 4 sources, 81 assertions, 115 log entries, 1 "probable" proof |

**The governing equation.** Generation time is linear in output tokens with a
near-zero intercept — measured across all 309 turns, bucketed by turn size:

| output tokens | n | median out | median gen | rate |
|---|---|---|---|---|
| 1k–2k | 45 | 1,419 | 27.1 s | 53 tok/s |
| 2k–3k | 52 | 2,508 | 47.7 s | 54 |
| 3k–4k | 32 | 3,572 | 65.8 s | 54 |
| 5k–6k | 14 | 5,574 | 98.0 s | 56 |
| 7k–8k | 5 | 7,351 | 131.2 s | 58 |

Marginal rate ≈ 57 tok/s, intercept ≈ 2 s. `record_search` averages 0.4 s
host-side. **There is no I/O to optimise; wall-clock is the time to emit output
tokens.**

> **Therefore the only levers are (a) fewer tokens emitted per turn and (b) fewer
> turns.** Any proposal that does not move one of those does not make the product
> faster, however much it improves the code.

Output-token composition: **~85% reasoning** — 27% stored thinking blocks, **58%
unstored**. See F0, which is the finding this plan is organised around.

**Caveats on cost.** Assumes public `claude-sonnet-4-6` pricing, main thread only:
the transcript has zero sidechain records, so the 28 subagent runs (24
`image-reader`, 4 `record-extractor`) and 23 compaction calls are excluded. $37 is
a floor; use the relative breakdown, not the absolute.

### 1.1 What entered the context

5.13 MB of tool results ≈ 1.31M tokens.

| Source | Calls | Size | ≈ tokens |
|---|---|---|---|
| `record_search` results | 140 | 3.05 MB | 780k |
| `record_read` results | 114 | 904 KB | 231k |
| `Read` (mostly `research.json`) | 75 | 672 KB | 172k |
| everything else | 330 | 0.5 MB | 128k |

**But tool results are only ~60% of window pressure.** Measured compaction
dynamics: context before compaction median 163,894, after median 61,967 —
~105k reclaimed per event, median 8.5 turns between events. Over 23 events that
is ~2.4M tokens of churn against 1.31M tokens of tool results. The missing ~1M is
the model's **own 865k output tokens**, which re-enter context every turn. Any
payload diet is capped at the 60%.

---

## 2. Findings

### F0 — 58% of output tokens are unreachable by any tool change

The largest single component of the only quantity that matters. Measured
chars-per-billed-output-token across all 309 turns: **1.67 aggregate, median 1.73,
p5 1.00, p95 2.87** — a uniform ~2× deficit, not a few outlier turns hiding
content.

`claude-sonnet-4-6` defaults to `thinking.display: "summarized"`; thinking is
billed in full and summarised before it reaches the transcript. So the 58%
"unstored" is **billed reasoning**, ≈ 500k tokens ≈ **2.6 h at 53 tok/s**.

Its only levers are **reasoning effort** and **model choice**. `effort: high` on
all 309 turns, and nobody chose it — `apps/server/app/agent/real_agent.py`
`build_options` sets `model` from env and never sets effort.

**This is the headline.** Every other change in this plan competes for the other
42%. See §3 C0 and §6 for why it is still sequenced behind the cheap wins.

### F1 — `research_log_append` rejects 20% of calls; cause is a missing convention, not the schema

**30 of 153 calls** failed with Claude Code's `InputValidationError`. All 30 share
one signature — the opening quote on the `query` value is missing:

```
"query": Read Arkansas marriage records S8 and S9: ark:/61903/1:1:FQ1F-QMN and ark:/61903/1:1:F79T-WXG, "outcome": "negative
```

**rev.1 claimed the `query: type "object"` schema was unsatisfiable for read-style
entries. That is false.** The model satisfied it 52 times in this same session —
`record_read`/dict 33, `image_transcribe`/`image_read`/dict 19 — and all 115
persisted entries carry a dict `query`, with `recordId` in 19, `ark` in 22,
`imageArk` in 9. The same pattern holds across `eval/runlogs/e2e/`, including runs
with zero failures.

Two confounders tested, both **rejected**:

| | failed (n=30) | succeeded (n=123) |
|---|---|---|
| payload chars (median) | 1,070 | 1,148 |
| context tokens at call (median) | 101,735 | 120,012 |

What survives is **episodic clustering** — failures by session decile:
`0/6, 6/15, 0/4, 9/30, 1/29, 0/9, 14/36, 0/19, 0/5`. Three burst windows, long
clean stretches. Entry kind and session phase are confounded, so the per-kind
split (1.5% search / 35% read / 33% image) is reproducible but **not causally
load-bearing**.

What *is* uniform: quoting that one value repairs all 30 to valid JSON, and there
is no single documented convention for which key a read-style entry should use —
`recordId`, `ark` and `imageArk` all appear in the corpus.
`research-log-editor-spec.md:306` explicitly routes "what to put in `query`" to
the skills' protocol references.

**Cost — rev.1 overstated this ~8×.** The 30 failures sit in 17 turns emitting
84,289 tokens, but those turns also ran 13 `record_search`, 14 `record_read`, 3
`Agent`, 2 `research_append` and more, none discarded. Failed payloads are 36,430
of 147,286 stored chars ≈ **10,400 tokens ≈ 3.3 min**; doubling for retries gives
**~7 min**, not 45–55.

**Constraint that still holds:** all 30 arrived as `__unparsedToolInput` — rejected
by the client before our MCP server ran. No server-side repair is possible.

### F2 — `rank_search_matches` was available, worked, and was still called 14 times out of 128

> **§5.1 supersedes the diagnosis below.** A live probe against a pool containing
> a genealogist-confirmed record put it at **rank 1 of 20, score 0.9414, 33× clear
> of the runner-up**. The near-zero scores quoted below came from pools that
> genuinely held no match — correct negatives. Everything here about degenerate
> scoring, starved subjects and `ark: null` is **refuted**. What stands is the
> adoption gap: 14 calls against 128 eligible searches, for reasons that are not
> "the tool doesn't work". Read §5.1 before acting on any of this.

`search-records/SKILL.md:171`: *"**Always** call `rank_search_matches` after any
search that returns one or more results."* `SKILL.md:162` instructs `count: 50`
*"fetches a deep-enough pool for the match re-ranker."* Observed: **14 calls
against 128 searches that returned results.**

**rev.1 attributed this to the tool being structurally unavailable — that a person
must already be in `tree.gedcomx.json` and the search targets were not. That is
false, and it came from an extraction bug:** `tree.gedcomx.json.bak` stores names
as `given`/`surname`, not `name_forms[].full_text`. I3 **is** Thomas Stephens
(b. after 1828), I8 Nancy, I9 Shake. Search targets: James 23, Shake 19, Thomas 18,
Nancy 13 — **73 of 140 searches (52%) against tree persons**. The agent passed
`subjectId: "I3"` on 6 of its 14 rank calls, from transcript record 221 onward.

The real defect is that the ranker **does not work against these subjects**:

- `subjectResolvable: false` on **9 of 14 calls**
- 129 `matchScore` values: **median 0.00135**, max 0.794, only 9 above 0.1
- **All 9 tree persons have `ark: null`** — local `I*` stubs, never FS-seeded

This is documented, predicted behaviour, not a surprise:
`rank-search-matches-tool-spec.md:92-99` — *"A subject that is a sparse local stub
(few facts, e.g. a not-in-FS `I1` person) can score uniformly near-zero against
every candidate … set `subjectResolvable: false`."* Corroborated at
`person-evidence/SKILL.md:637-643` and `research-append-tool-spec.md:788-790`.

**So the agent tried the prescribed tool, got noise, and rationally stopped using
it** — then hand-triaged up to 50 raw stubs per search in-context, which is most of
the 780k tokens in §1.1. This has a **quality** dimension as well as a cost one:
117 searches were triaged with no working match score at all. That question
belongs to the genealogist reviewing the run, not to this plan.

### F3 — `record_search` stubs are redundant, but less compressible than rev.1 claimed

3,380 rows across 140 searches. Per-field share of row bytes:

| Field | Share | Note |
|---|---|---|
| **`events`** | **18.4%** | *omitted from rev.1's table* — the largest field; duplicate entries and Race/MaritalStatus noise |
| `recordTitle` | 14.4% | embeds `collectionTitle` verbatim a second time |
| `collectionUrl` | 14.0% | derivable from `collectionId`; **the only genuinely free drop** |
| `collectionTitle` | 9.4% | repeated per row; few distinct values per response |
| `primaryId` | 4.6% | **must NOT be dropped** — see C2 |
| `treeMatches` | 2.9% | overwhelmingly `[]` |
| *(whitespace)* | *27.9% of raw bytes* | pretty-printed machine-read payload |

**rev.1's "22% of current size" described a flat TSV re-encoding, not the field
edits it proposed.**

**Measured post-implementation** — the shipped C1 replayed over all 3,380 rows of
this session's 139 parsed searches:

| variant | chars | ≈ tokens | of raw |
|---|---|---|---|
| raw, as delivered | 2,791,175 | 697,793 | 100% |
| **C1 as shipped** (drop `collectionUrl`, hoist `collectionTitle`, omit empty `treeMatches`, dedupe events) | 2,197,716 | **549,429** | **79%** |
| + minified output | 1,563,389 | 390,847 | 56% |
| + `recordTitle` collection-suffix strip | 1,420,826 | 355,206 | 51% |

So C1 alone saves **148k tokens (21%)** — not the ~50% earlier revisions
projected. The 50% figure is only reachable **with minification**, which is not a
`record_search` change at all: every tool serializes via
`JSON.stringify(result, null, 2)` at ~40 call sites in `src/index.ts`.
Minification is worth **more than the entire field diet** (159k tokens on
`record_search` alone) and would apply equally to `record_read`'s 231k tokens and
everything else. **Deliberately not folded into C1 — it is a repo-wide change
that needs its own decision.** See §5.

`recordTitle` suffix-stripping and event *type* filtering were also declined:
`recordTitle` is the human-readable triage label, and `Race`/`MaritalStatus` are
real triage signal, so both trade context for judgement.

And per §1.1 this buys compaction headroom against ~60% of window pressure, not
wall-clock.

### F4 — compaction causes measurable rework

23 compactions. Each discards working memory; the agent rebuilds by hand:

- **48 `Read`s of `/project/research.json`** and **28 `grep`s** of the same file
- **22 of 114 `record_read` calls were repeats** (24% redundant re-fetch)
- **28 `Agent` calls covering 20 distinct images** — one death certificate
  transcribed 4 times, another 3 times
- **`research_query` was called zero times**

A projection tool exists for exactly this and lost to `Read`+`grep` 76 times to nil.

### F5 — one op per call; and the nil-search population is small

- **153 `research_log_append` calls, every one with exactly 1 op**, though the tool
  accepts `ops[]` (`research-log-append.ts:486`; `research_append` batched 37 of
  44). 15 turns did nothing but log, emitting 35,147 output tokens.
- **rev.1 claimed "58 of 115 logged searches returned nothing." That conflated two
  different things.** 58 is the count of `outcome: "negative"` across all 115 log
  entries — of which only 64 are searches at all (the rest are 33 `record_read`,
  18 `image_transcribe`). Of the 45 negative *search* entries, 42 examined >0
  results. **Only 11 of 140 `record_search` calls returned zero rows.**

A negative outcome after triaging 50 stubs is the expensive, *non-batchable* case —
the opposite of what a batch-search tool would help.

### F6 — extraction was late, but not by 75 minutes

92 records read to keep 4 sources; the 4 `record-extractor` calls ran at the very
end. **rev.1 cited "75 minutes after the tester asked" as agent latency. That was
tester idle time:** tester asks at 11:28:34, agent answers at **11:28:53 (19 s)**,
tester replies "proceed with extraction on all of them" at 12:43:13. The gap is
the tester's.

The underlying observation stands — findings not written down are findings
compaction can delete, which is F4 and F6 seen from two ends — but it is not
evidenced by that number.

---

## 3. Changes

### C0 — reasoning-effort A/B *(the headline; sequenced last)*
**Addresses F0 — the 58% no other change reaches.**

Drop the orchestrator below `high`; reserve high-effort work for
`proof-conclusion` / `conflict-resolution`. Effort is session-wide and reaches
every skill *and* subagent, so the e2e suite is the gate.

**Prerequisite:** the unit suite cannot serve even as a screen until it pins
effort. `eval/harness/harness/` writes no `effortLevel`, so unit runs inherit the
launching Claude Code session — the exact non-reproducibility the e2e orchestrator
pins against (`e2e/orchestrator.py:349-362`, default `"high"` "to match Cowork").
Mirror that `settings.json` write into the unit workspace first.

Sequenced after C1–C3 because all of them move turn count and compaction count, so
an A/B run now would be invalidated.

### C1 — `record_search` payload diet
**Addresses F3. 780k → ~390k tokens (~50%), or ~290k with `events`.**

Drop `collectionUrl`. Trim `events` (dedupe; drop Race/MaritalStatus). Hoist
`collectionTitle` into a per-response collection map. Strip the collection suffix
from `recordTitle`. Omit empty `treeMatches` (type flip at
`types/record-search.ts:215`). Emit minified JSON.

**Do NOT drop `primaryId`.** `rank-search-matches.ts:73` skips any candidate
lacking it — `matchScore: null` → `subjectResolvable: false` → the ranker silently
returns search order, with no error and no `scoringErrors` increment (a test pins
that a skip is not an error: `tests/tools/rank-search-matches.test.ts:309`). Four
other consumers: `research-append.ts:1246-1253`, `same-person.ts:188`,
`packages/schema/src/index.ts:482` (**required** on the sidecar type),
`SidecarResultCard.tsx:40,44,87,98`, plus 25 eval fixtures.

The `collectionTitle` hoist and `recordTitle` strip are cross-package (viewer
heading, both schema mirrors, `fulltext_search` emits the same field name) — not
"mechanical". Spec: `record-search-tool-spec-v2.md`, which **predates staging
entirely** (zero matches for `staged`, `resultsRef`, `rank_search_matches`) and
needs a refresh pass regardless.

### C2 — subject enrichment + honest degradation
**Shipped. But read §5.1 first: the premise below was refuted after
implementation, and C2's value is now almost entirely C2b.**

> **Post-implementation correction.** C2a was built to fix "the matcher is
> starved". The live probe showed the matcher was never starved — it puts a
> confirmed record at 0.9414/rank 1 and correctly reports ~0 when the pool holds
> no match. C2a moves a true match by **+0.0008**. It is retained because it is
> free and cannot hurt (it only ever adds evidence the project already holds, and
> dedupes against the tree), **not** because it earns its place. C2b — telling a
> true negative apart from an unscoreable subject, and saying which — is the part
> that carries weight. C2c/C2d stand on their own.

FamilySearch's matcher is excellent when both sides carry information and
near-random when either side is starved. The candidate side we cannot change.
**The subject side is entirely ours, and we are starving it.**

`buildSubjectDoc` (`rank-search-matches.ts:150-177`) is one line of substance —
`return { persons: [subject] }` — the bare tree person: a name, a fact or two,
`ark: null`. Meanwhile this project held **81 assertions, 4 sources and 6
`person_evidence` entries** about that same human, none of which reached the
matcher. The probe that validated this tool used `KNS4-P6W`, a well-populated
*FamilySearch* person, and scored a 0.72–1.0 match cluster against ≤0.009 for
non-matches — i.e. it validated the rich-subject regime and deferred enrichment
("*Future: enrich with 1-hop relatives — deferred*") on the strength of the one
case that never needed it.

**C2a — enrich the subject doc from the project's own evidence.** Build it from
the person's assertions, `person_evidence` and attached sources, not the bare
tree person. No FamilySearch change required. This is the cause fix and the only
part of C2 that must land.

**C2b — withhold the ranking when the scores carry no signal.** Today
`subjectResolvable` is inferred *after* scoring, as "no score cleared
`DEGENERATE_FLOOR`" (`:119-121`) — which conflates a **starved subject** with an
**empty pool**, two situations needing opposite responses ("my scoring is broken"
vs "not here, page deeper"). Disambiguate by inspecting the subject doc, and when
the subject is the problem, do not return `matches` at all. Today the tool slices
the noise-sorted array into a ranked-*looking* top-10 regardless and sets a flag;
that is the silent-degradation path. Return instead an explicit diagnostic naming
what is missing ("subject has name only — add a birth year or a county").

**C2c — carry a per-candidate evidence count on each stub** (`toStub`, `:180`).
Free, additive, no threshold, no behaviour change. It supplies the data behind
the existing but unbacked guardrail in `record-search-compaction-scope.md`
("sparse records are unstable — two dateless obituary stubs differing only by a
middle initial scored 0.086 vs 0.668"). **The skill guidance that consumes it is
quality doctrine and is excluded here** — same principle as F6, see §6.

**C2d — fix the circular fallback.** `search-records/SKILL.md:253-256` currently
says that on `subjectResolvable: false` the skill should hand-score with
`same_person` using *"the subject from `tree.gedcomx.json`"* — **the same starved
subject that just failed**. It cannot work, and it is why the agent abandoned the
tool rather than following the escape hatch. Point it at the enriched subject from
C2a, or at narrowing the query (`SKILL.md:250-252` already prescribes narrowing
first on broad searches).

**Explicitly rejected: thresholding low scores to zero or a floor.** The repo's own
probe shows the bands overlap — a genuine record at **0.632**, a different
same-name man at **0.716**, and its own conclusion that *"no single threshold
separates cleanly."* A floor at 0.1 would zero the 0.086 obituary that may be the
right record, and the spec already rejects the general form (*"**No local
pre-filter** … a name/date gate would re-drop the buried-but-correct records this
tool rescues"*). Mechanically it also backfires: flattening noise to a constant
makes the sort tie-break into **search order**, which is today's failure with
rounder numbers.

**Also rejected: an a-priori starvation gate before scoring.** It saves ~12 s of
network time all session (14 calls at 0.9 s) and adds a second uncalibrated
threshold. Its only real value — the diagnostic — is available post-hoc from the
subject doc, and is folded into C2b.

**rev.1 proposed accepting an even thinner ad-hoc subject description. That is
backwards** — it would make the tool *callable* in more cases where it already
produces near-zero output. Dropped.

Spec: `rank-search-matches-tool-spec.md` (§"Thin / unresolvable subject" needs
rewriting around the enriched subject). Gate C2 on a **measured score
distribution**, not on the tool returning without error.

### C3 — default `query` from the staged payload
**Addresses the search slice of F1 and part of F5, at ~5 lines.**

`record-search.ts:513` already puts `query: echoQuery(input)` in the response and
`results-staging.ts:75` stages the whole response as `payload` — **the verbatim
query is already on disk.** Have `research_log_append` default `query` from
`envelope.payload.query` when `stagedResultsRef` is given, so the model never
re-serializes it.

### C4 — name the canonical read-entry `query` key *(lane 3)*
**Addresses the rest of F1. ~7 min recovered.**

One line in the three `references/research-log-protocol.md` copies naming the
canonical key for read-style entries (`recordId` / `imageArk`), plus a worked
example in the tool description. `citation/SKILL.md:413` treats `query` as the
authoritative structured record of search scope, so the convention has a second
consumer.

**This is a lane-3 protocol fix, not the schema change rev.1 proposed.** Per
`docs/skill-lifecycle.md:218-221`, a tool problem is one where the tool never
returned the data; here nothing was rejected — 130 read-style entries with
structured ARKs were accepted across the corpus. Widening `query` to
`["object","string"]` would have touched 8 sites (both `research.schema.json`
mirrors, `packages/schema/src/index.ts:170`, `research-schema-spec.md:309`, the
prose tables, `ResearchLogSection.tsx:159`), and a new `record_ids` field 9 —
including `validator.ts`, since `RESEARCH_SHAPES.log_entry` is a closed set.

### C6 — serialize every tool result compact
**The largest single mechanical win in this plan. ~159k tokens on `record_search`
alone, plus every other tool.**

All 46 tool dispatches in `src/index.ts` used `JSON.stringify(result, null, 2)`.
Whitespace is **27.9% of `record_search`'s raw response bytes** — more than C1's
entire field-level diet, and it applies equally to `record_read` (another 231k
tokens this session) and to all ~40 other tools. Serialize compact.

No information is lost, nothing downstream parses the formatting, and a human
reading a transcript can pipe it through `jq`. Measured on this session's
`record_search` traffic: C1 alone 698k → 549k tokens; C1 + C6 → **391k (56% of
raw)**.

Like C1 this buys compaction headroom rather than wall-clock directly (§1.1) —
but it is the cheapest large reduction available, and unlike C1 it needs no
per-tool judgement about which fields matter.

### C5 — tell the skills that read `research.json` that `research_query` exists
**Addresses ~84% of F4's read volume. One line per skill.**

`research_query` was called **zero** times while `research.json` was read 48× and
grepped 28×. The cause is not the projection design that
`orchestrator-state-diet-plan.md` addresses — it is that the skills doing the
reading were never told the tool exists:

| Skill | mentions `research_query` | state-recovery ops performed |
|---|---|---|
| `search-records` | **0** | **41** (34 `Read` + 7 grep) |
| orchestrator / unattributed | **0** | 23 (10 `Read` + 13 grep) |
| `proof-conclusion` | 8 | 9 |
| `person-evidence` | 5 | 3 |

The two skills that know about it account for 12 of 76 operations; the two that
did 64 of them do not mention it once. Add the pointer to `search-records` and the
`research` orchestrator skill.

**This does not replace the state diet** — the projection work stays where it is
(§6). This is the cheap 84% that does not need it.

---

## 4. Sequencing

| Step | Change | Depends on | Lane |
|---|---|---|---|
| 1 | C4 — protocol convention | — | 3 |
| 2 | C5 — point the reading skills at `research_query` | — | 3 |
| 3 | C6 — compact tool-result serialization | — | 1 |
| 4 | C3 — `query` defaulted from staged payload | — | 1 |
| 5 | C1 — payload diet | — | 1 |
| 6 | **C2 — subject enrichment + honest degradation** | — | 1 |
| 7 | unit-harness effort pin | — | eval |
| 8 | **C0 — effort A/B** | 1–7, re-baseline | eval |

Steps 1–5 are independent and parallel. C0 is last by construction.

**C2 is the gate on one deferred decision.** Whether `record_search` should
perform ranking inline (§6, "folding search + rank + log") turns entirely on
whether C2a produces a usable score distribution. Folding a ranker that returns
noise into the hot path makes every search slower *and* still returns noise. Once
C2 lands and ranking demonstrably works, reopen it — the adoption evidence (14
calls against 128 eligible searches) then argues for it, and a middle option
exists that rev.1 missed: keep the tools separate but have `record_search` return
the ranked view directly when a `subjectId` is supplied, preserving blast radius
and composability while fixing adoption.

**Verification economics.** From the 96 committed e2e runlogs: median $7.29 /
53 min. Two corrections to rev.1's arithmetic: **17 of 96 runs carry no
`total_cost_usd`** (16 `timeout`, 1 `error`), so the $661 total spans 79 runs
while the 98 h spans 96 — imputing at the pooled $0.1504/min puts true spend near
**$886**. And a suite is a *sum*, so scale by the mean, not the median: a
20-fixture pass is ≈ **$185 and ~20.5 h serial**. `run_e2e.py` takes one fixture
per invocation with no concurrency — a batch is a hand-written loop, and nothing
enforces a budget.

---

## 5.1 Probe result — **F2 was wrong; the ranker works**

> This supersedes §2 F2's diagnosis and the first version of this section. It is
> the third revision of F2, and the first one measured against a pool that
> contains a known-correct answer. **Read this before acting on F2.**

`dev/probe-rank-enrichment.ts` against the feedback case, live FamilySearch, both
arms, two different sidecars:

**Pool that contains the right record** (`log_075`, the New Mexico death-certificate
search; `ark:/61903/1:1:FLBW-2LT` is James L. Stephens's own death certificate,
genealogist-confirmed and linked to I1 at `confidence: "confident"`):

| rank | candidate | bare | enriched |
|---|---|---|---|
| 1 | **James L. Stephens** *(the confirmed record)* | **0.9414** | **0.9422** |
| 2 | James Box Stephens | 0.0280 | 0.0280 |
| 3 | James Stephens | 0.0108 | 0.0108 |
| 4–20 | everything else | ≤0.0008 | ≤0.0044 |

**The correct record ranks 1 of 20 with a 33× margin over the runner-up — in the
BARE arm, before any enrichment.** The matcher discriminates cleanly and is
deterministic (five identical calls on one pair returned 0.00409 every time).

**Pool that contains no right record** (`log_001`, the 1870 Shelby County census
search): max 0.008, nothing above the 0.01 floor. The research log records that
same search as negative — *"1870 U.S. Census in Shelby, Jackson, Overton, and
Smith counties, Tennessee — no James Lewis Stephens household found."*

**So the session's near-zero scores were CORRECT NEGATIVES, not tool failure.**
F2 read "median 0.00135 across 129 scores" as the ranker being broken. It was the
ranker correctly reporting that those pools did not contain the target. The
`ark: null` / sparse-subject story was a misdiagnosis — and the design probe's own
subject (`KNS4-P6W`) was ark-less too, which should have been the tell.

What survives from F2, and what does not:

- **DEAD:** "the ranker returns noise", "the subject is starved", "`ark: null` is
  the dominant variable". All refuted.
- **DEAD:** C2a's rationale. Enrichment moved the true match 0.9414 → 0.9422
  (+0.0008). It is harmless and nearly free, but it buys **nothing** measurable.
  Keep it only because it costs nothing; do not cite it as a win.
- **ALIVE, and now the whole of F2:** the tool was called **14 times against 128
  eligible searches**. That adoption gap is real and is *not* explained by the
  tool being useless — it demonstrably works. The cause is something else
  (`count: 50` pools are cheap to eyeball, the "always" instruction is buried in
  Step 4, no structural forcing function), and that is what should be fixed.
- **ALIVE, reframed:** C2b's real value is not "detect a starved subject" but
  **distinguish a true negative from an unscoreable one**, and say which. On this
  evidence the true-negative branch is the common case by a wide margin — the
  `else if (noSignal)` path, which returns the matches *and* names the finding.
  The withhold-entirely branch should fire rarely; if it fires often in practice,
  that is a signal to re-examine, not to widen it.

**Consequence for the plan's shape.** The adoption gap plus a demonstrably
working ranker strengthens the case for the deferred fold (§6): if ranking is
this good and this cheap, the reason to make it automatic is stronger, not
weaker. The counter-arguments there (batching, atomicity, blast radius) are
unchanged — but "the ranker might not work" is no longer among them.

## 5.2 The adoption gap is compaction eating the doctrine

With §5.1 establishing that the ranker works, the remaining question was why it
ran 14 times against 128 eligible searches. Plotting `record_search` and
`rank_search_matches` against the 23 compaction events answers it:

| segment (between compactions) | searches | rank calls |
|---|---|---|
| 0 (before the first compaction) | 2 | 2 |
| 1 | 4 | 4 |
| 2 | 7 | 4 |
| **3 – 14** | **88** | **0** |
| 15 | 8 | 3 |
| 16 – 19 | 24 | 0 |
| 20 | 5 | 1 |
| 21 – 23 | 2 | 0 |

**Compliance in segments 0–2 was 10 of 13 searches (77%). From segment 3 on it
is 4 of 118 (3%).** The behavior did not drift — it fell off a cliff at a
specific point, and that point is compaction.

The mechanism: **`search-records` was invoked exactly once, at 19:09, and never
again.** Its body is 41.6 KB (~10k tokens). A skill enters context once, via the
Skill tool; nothing re-loads it. Successive compactions evicted it, and with it
`SKILL.md:171` — *"**Always** call `rank_search_matches` after any search that
returns one or more results."*

The decisive detail: **15 of the 23 compaction summaries name
`rank_search_matches`**, but the string "Always call" appears in **zero** of the
session's last 400 records. Compaction preserved the *narrative* ("we used a
ranking tool") and dropped the *rule* ("you must use it every time"). The agent
knew the tool existed; it no longer knew it was mandatory.

**This is systemic, not specific to this skill.** Every behavioral instruction in
every SKILL.md degrades the same way over a long session — silently, with no
error, and invisibly to any test that runs a skill once in a fresh context. The
unit suite cannot see it by construction.

Four responses, in rough order of leverage:

1. **A tool contract cannot be compacted away — prose can.** This is now the
   strongest argument for the deferred fold (§6): make ranking part of what
   `record_search` *does* when a subject is supplied, rather than a rule the
   model has to remember. It converts a doctrine-retention problem into an API.
2. **C1 and C6 buy instruction lifetime, not just tokens.** Fewer compactions
   means doctrine survives longer. Their measured 698k → 391k on search payload
   directly extends the window in which a skill body is still resident. This is
   a *behavioral* justification for changes that looked purely economic.
3. **Re-invoke the skill per plan item**, not once per session. The `research`
   orchestrator already loops; re-entering `search-records` on each plan item
   would reload the body. Costs ~10k tokens per reload — cheap against a
   compaction cycle, and far cheaper than 114 unranked searches.
4. **Shrink the skill body.** 41.6 KB is a lot to hold, and a smaller body both
   survives longer and costs less to reload. Out of scope here; flagged for the
   skill stewards.

The order matters: (1) and (2) are already in flight, (3) is a small orchestrator
change with a real cost model, and (4) is prose work that should follow the
measurement rather than lead it.

## 5.1a Superseded — the starved-subject reading

Run `dev/probe-rank-enrichment.ts --project <case> --subject I1 --results
results/log_001.json` against the feedback case, live FamilySearch, 10
candidates, both arms.

| arm | scored | median | max | > 0.01 |
|---|---|---|---|---|
| A — bare tree person (pre-C2) | 10 | 0.00022 | 0.008 | **0** |
| B — enriched subject (C2a) | 10 | 0.00011 | 0.048 | **1** |

**What C2a does:** it lifted the best candidate 0.0082 → 0.0482 (5.9×), across
the floor. Real, and it came entirely from **three name variants** ("James L.",
"J.L.", "James G[?]") linked through `person_evidence` — zero facts were added.
Name variants alone move the score materially; a facts-only view of enrichment
understates it. (`subjectEnrichedNames` exists because of this: the first cut of
the metric counted only facts, reported `0`, and read as "did nothing.")

**What C2a does not do, and this is the important part.** The premise in §2 F2 —
*the subject is starved* — is **false for this subject**. I1 carries a full name,
birth date + place, death date + place, four dated residences and a burial: nine
facts, seven with a date or place. It is a rich subject, and it still scores a
median of 0.0002 against every candidate. The enriched arm's max (0.048) is two
orders of magnitude below the 0.72–1.0 match cluster the original design probe
saw with an **FS-resident** subject (`KNS4-P6W`).

**So the dominant variable is `ark: null`, not subject richness.** The matcher is
deterministic (verified: five identical calls on one pair returned 0.00409 every
time), so this is a real property of scoring an ark-less document, not noise. A
local `I*` person appears to score in a degenerate band whatever it contains.

Consequences for the plan:

- **C2a stays** — it is cheap, it measurably helps, and it costs nothing when
  there is nothing to fold in. But it must not be sold as the fix, and
  `count: 50` should **not** be justified by "the re-ranker will sort it out"
  until an ark-bearing subject is tested.
- **C2b is doing the real work.** Withholding a ranking that would have been
  search order is the honest behavior in the regime this session lived in.
- **Open question, and the highest-value next probe:** does the degeneracy
  disappear when the subject *does* carry an FS ark? Every fixture subject in
  this case was ark-less. If richness only matters once an ark is present, the
  actionable fix is upstream — attach the tree subject to its FamilySearch
  person (or seed the tree from FS) before ranking — and that is a different
  change from anything in §3.
- The deferred local agreement scorer (§5) becomes **more** likely to be needed,
  not less. Do not build it before answering the ark question.

## 5. Risks and open questions

- **C2a may not lift enough subjects out of the starved regime.** If FS's matcher
  fundamentally needs an FS-resident subject, the honest outcome is C2b's explicit
  "cannot rank" plus a documented fallback — not a worse score. Decide after
  measuring the post-enrichment score distribution.
- **Deferred, gated on that measurement: a deterministic local agreement scorer**
  (surname exact / given-name variant / birth year ±N / place containment) as the
  fallback when the subject stays unresolvable. It would beat FS search order,
  which the scope doc measured as worthless (top 21 hits at *identical* score) —
  but building a second unvalidated ranker before knowing how often the starved
  case survives C2a is the wrong order, and narrowing the query is the cheaper
  move already prescribed at `search-records/SKILL.md:250-252`. **TODOs entry, not
  a change in this plan.**
- **C1 + C6's ceiling is ~60% of window pressure** (§1.1); the model's own
  output is the other ~40% and only C0 touches it.
- **C2a is weaker than this plan assumed — see §5.1.** The live probe changed
  the diagnosis.
- **F2 has an unquantified quality cost.** 117 searches triaged without a working
  match score. Whether that changed the *conclusion* is a genealogist question.
- **`count: 50` should be revisited only after C2.** It is correct given a working
  ranker and wasteful without one.

## 6. Deliberately excluded

- **Folding search + rank + log into one `record_search` call — deferred, not
  refused; revisit after C2 (§4).** It reverses a documented owner decision
  (`record-search-compaction-scope.md:110-113`, *"Owner chose separate"*), and
  one of that decision's three stated reasons is now measurably stale: *"composable
  — re-rank a logged search later"* has **never been exercised** (all 14 rank calls
  passed a `results/.staging/<uuid>.json` handle immediately after their own
  search; **zero** used a finalized `results/log_NNN.json` ref). A second reason,
  *"graceful degradation when the matcher throttles"*, protected against a risk
  that did not materialise — the observed failure was silent noise, which degraded
  *invisibly* into FS search order. Only "lower blast radius on the most-shared
  tool" survives intact, and that is a cost of folding, not a benefit of splitting.
  What still argues against folding *today*: it would forfeit the `ops[]` batching
  landed the day before this session (`d85f285e`, #897), put O(n) `validateParsed`
  on the network hot path, and introduce partial-failure states (orphan sidecar /
  dangling `results_ref`) that the split structurally prevents and that
  `search-records/SKILL.md:271` says cannot be repaired by hand. C3 gets its one
  real benefit at ~5 lines meanwhile.
- **A multi-variant batch search.** rev.1 sized this off the 58-negative figure;
  the true nil population is ~11 searches (F5). The stronger reason to drop it:
  **the win is already captured.** The agent issues 2–4 searches per turn on 39 of
  its 83 search-issuing turns (44×1, 24×2, 12×3, 3×4), so 140 searches ran in 83
  turns, not 140 — parallel tool calls already collapsed ~57 turns. The queries
  *are* grid sweeps (`givenName`/`surname` fixed; place/year/collection/recordType
  varying), so they are independent in principle, but a batch tool would save
  tool-call overhead while **turns** are what cost time. Ceiling is small. Dropped.
- **`orchestrator-state-diet-plan.md` (F4's `research_query` half).** Already
  planned and board-queued. F4's numbers here are fresh evidence for it and should
  be appended there rather than duplicated.
- **F6 / extraction ordering.** A doctrine change gated by the unit suite. The
  research quality in this session was good; do not perturb the workflow in a
  performance PR.

Anything deferred out of an implementing PR gets a `docs/TODOs.md` entry in that
same PR.

## 7. Refuted in review — do not re-derive

| rev.1 claim | Why it was wrong |
|---|---|
| Ranker structurally unavailable; targets not in tree | Extraction bug — `.bak` uses `given`/`surname`, not `name_forms[].full_text`. I3/I8/I9 are Thomas/Nancy/Shake; 52% of searches hit tree persons; ranker called with I3 6×. |
| Fix: accept an ad-hoc subject description | Would supply an even thinner subject than `I1`, which already scores ~0. Inverted into C2. |
| `query: type "object"` unsatisfiable for read entries | Satisfied 52× in this session; all 115 persisted entries carry a dict `query`. |
| Malformed writes cost 45–55 min | ~7 min. The 17 affected turns did substantial non-discarded work. |
| 58 nil searches → batch them | 58 = negative *outcomes* across 115 mixed entries. Only 11 searches returned zero rows. |
| Payload diet reaches 22% of current | 22% was a TSV re-encoding; the proposed edits reach 50%. |
| Drop `primaryId` | Silently disables the ranker (`rank-search-matches.ts:73`) + 4 other consumers. |
| 95% of active time is model generation | 78%; 17% is compaction summarisation, previously reported as zero. |
| Extraction ran 75 min after the tester asked | Agent replied in 19 s; 74 min was tester idle. |
