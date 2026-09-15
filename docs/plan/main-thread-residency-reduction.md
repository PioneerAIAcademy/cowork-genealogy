# Reduce main-thread residency

**Status:** Not started. Instrumentation (`result_chars`, `usage.message_usage`,
`usage.thread_windows`) landed on branch `worktree-main-thread-instrumentation`;
levers 1–2 below are ready to scope now, 3–6 are gated on the first instrumented
run. Nothing here is filed as an issue yet — this doc is what the board draws
from, not a substitute for it.

## Objective

Every token resident in the orchestrator's context window is re-read on every
subsequent turn. That is three costs at once — latency per turn, cache-read
spend, and compaction (which is information loss, not just a token event). The
goal is to move work off the main thread, not to buy a bigger window.

**Raising the context window is explicitly the last resort.** It masks the
problem at 5× and improves nothing about subagent windows or cost; every lever
below improves all three.

## What is measured, and how well

From the 172 committed e2e runs on `main` (exact) and the four instrumented runs
on `origin/2491-harness-closeout` (marked):

| fact | value |
|---|---|
| Tokens added to the main thread per run | **449,000** median, 436k–695k (n=4, instrumented) |
| Main-thread window ceiling | ~167–172k = 83.6–85.9% of **200,000** — auto-compaction, not a 1M window |
| Share of tool calls made on the main thread | **71%** (133/run main vs 53/run all subagents, n=33) |
| Baseline before the first tool call | **~27,000** — 16% of the window, spent standing still |
| All skill bodies, resident | ~48,000/run (11% of the total) |

Main-thread bytes by tool (args + captured result, n=33). **The args half is
exact; the result half is a floor**, capped at `_RUNLOG_MAX_CHARS = 4000`:

| tool | calls/run | ~tok/run | share |
|---|---|---|---|
| `research_append` | 17.5 | **15,614** | 28.0% |
| `record_search` | 15.0 | 8,839 | 15.9% |
| `Agent` | 11.7 | 8,455 | 15.2% |
| `research_log_append` | 8.8 | 4,504 | 8.1% |
| `research_query` | 9.8 | 3,408 | 6.1% |
| `record_read` | 5.9 | 2,920 | 5.2% |
| `Read` | 10.6 | 1,802 | 3.2% |

Captured total ≈ **55,700 tok/run**, against 449k added. So roughly **88% of what
fills the main thread is still unattributed** — truncated result bodies, subagent
return payloads, thinking, and narration.

**`Read` is the most understated row in that table.** 452 of 2,160 research.json
reads (21%) pass no `offset`/`limit`, and the file is a median 76 KB / max 356 KB
— ~20k tokens a read, ~91k at worst, almost all of it hidden behind the cap.

## What the first instrumented run settles

Run one baseline `ogletree-children` with the new fields, then read:

1. **`result_chars` on the saturated rows** — the true size of `record_search`,
   `record_read` and full `Read` payloads. This re-ranks levers 3–5 and is the
   only thing that can.
2. **Window growth minus result size, per turn** — `message_usage` gives
   per-message window growth; `result_chars` gives the tool bytes in that turn;
   the difference is **thinking + narration**. This is the only measurement that
   says whether thinking is a residency problem at all.
3. **`thread_windows.sub.message_count`** — expected `0` on CLI 2.1.271
   (measured: subagent turns never surface as `AssistantMessage`).

**Do not size the thinking levers before (2) exists.** Thinking tokens are
*output*; whether they occupy the window afterward depends on whether the runtime
replays prior-turn thinking. If it does not, lowering `effort` cuts cost and
latency but not residency — and `effort: high` is pinned to match Cowork, so it
trades quality for a saving that may not exist.

## The levers

Ranked by measured size over confidence. Each names what it touches and what
would falsify it.

### 1. Stop the orchestrator writing through its own window

`research_append` + `research_log_append` = **36% of captured main bytes**
(~20,100 tok/run), and both are **writes** — the orchestrator pushing content it
did not author (a median 3,163 chars of args per `research_append`) through the
thread whose only job is routing.

The content is already produced by whoever found it, and the agents that found
it already hold the tools: `person-evidence`, `record-extractor` and
`proof-conclusion` all declare `research_append`; `record-extractor` declares
`research_log_append`. These are main-thread calls the orchestrator makes inline.

- **Touches:** `packages/engine/plugin/skills/research/SKILL.md`, plus whichever
  sub-skill bodies write inline.
- **Acceptance:** main-thread `research_append` calls per run fall below 5 on an
  instrumented run, with no drop in `assertions[]` written to `research.json`.
- **Risk:** `docs/specs/schemas/ownership.json` governs who may write each
  section. Any move has to keep the ownership row true, and the `log` row is
  already stale (it lists five `skill:` callers and no `agent:` one, while
  `record-extractor` has written the log 9 times across 7 committed runs).
- **Cheapest falsifier:** if most of those 17.5 calls are sections only the
  orchestrator may write, the lever is much smaller than 28%. Check the
  `section` argument distribution before scoping.

### 2. Route `Read` of research.json to `research_query`

The scoped accessor already exists and is already used 9.8×/run. 2.6 full reads
of a 76 KB file per run is ~52k tokens to obtain three routing fields.

- **Touches:** `research/SKILL.md` routing prose, and any sub-skill that reads
  the file directly.
- **Acceptance:** zero full-file `Read`s of `research.json` on an instrumented
  run (`result_chars` makes this checkable for the first time).
- **Why it's second despite being cheapest:** its true size is behind the cap.
  If `result_chars` shows those reads are mostly small, it drops. **This is the
  lever most likely to be re-ranked upward by the run.**

### 3. Use the staging sidecars that already exist

`stageSearchResults` (`record-search.ts:1074`) already writes full results to
`results/<log_id>.json` and returns a `resultsRef` handle;
`compactStagedRecordSearch` already slims what the agent sees. `search-records`
references `staged.resultsRef` in its body. Yet `record_search` is still 15.9% of
captured main bytes with 51 of 520 results saturating the cap.

So either the compaction is not aggressive enough, or triage pulls the full set
back into the window. **Determine which before building anything** — the
machinery is already there, and this may be a tuning change rather than a
feature.

- **Acceptance:** `record_search` `result_chars` p90 drops materially with no
  loss in records triaged per run.

### 4. Convert `search-records` to a skill-agent pair

Already on the board: **#2123** (move the reference layer onto the wiki) gates
**#2243** (the conversion) and **#2241**. 60,807-byte body — 41% of all skill
resident mass at ~19,900 tok/run — *and* it drives the `record_search` /
`record_read` traffic in rows 2 and 6. Both halves leave main together.

Ranked fourth only because it needs a paid eval slot and is already sequenced
behind #2123. **Do not re-file it.** The `cluster:pair-conversion` items
(#2115–#2121, #2263–#2270) cover skill *bodies*; nothing on the board covers
main-thread *traffic*, which is what levers 1–3 are.

### 5. Decompose the ~27k baseline

16% of the window before the first tool call, re-read every turn: system prompt,
MCP tool schemas, agent descriptions. `ENABLE_TOOL_SEARCH` already defers the ~38
genealogy schemas, which is why it is 27k and not far worse; agent
*descriptions* stay resident and several are long.

Nobody has decomposed it. `ClaudeSDKClient.get_context_usage()` returns exactly
this breakdown by category (plus `memoryFiles`, `mcpTools`, `agents`, and
`autoCompactThreshold`). It is a client method and the harness uses one-shot
`query()`, so this needs a transport change — bounded, but real work.

- **Acceptance:** a per-category table of the baseline, and one named reduction
  with its measured size.

### 6. Narration — small by bytes, nearly free to fix, and the rule is already being broken

Measured directly from `narration[]` in the 27 committed runs that carry it (no
new run needed): **median 18,210 chars ≈ 4,552 tokens/run**, mean 5,078, max
12,295, across a median **57 assistant narration turns averaging 358 chars
each**.

Be honest about the size: that is **~1% of the 449k** added to the main thread.
It will not move the compaction count. Two reasons to do it anyway:

- **It costs a prose edit.** No architecture, no eval slot, no measurement
  dependency. The cheapest item in this document.
- **The shipped instruction is already being violated.** 26 of 27 skills say
  *"default to a one-line preamble per action"*; 358 chars is three to five
  lines, a ~4× overshoot. And `search-records` already carries the tighter rule
  the others lack — *"one short preamble per phase / per record … Under
  `--autonomous` mode, suppress per-entry preambles entirely — the audit trail
  lives in the persisted `rationale`/`notes` fields, not in chat"*. **The e2e
  corpus is autonomous-only**, so on every run measured above that suppression
  should have applied and 57 narration turns should have been near zero.

So the work is not "write a shorter rule" — it is "find out why the rule that
exists is not binding", which is a lane-4 question under `docs/skill-lifecycle.md`
(a rule the model reads is not a rule the model follows) before it is a wording
change.

- **Touches:** the `**Narration:**` line in the 26 skills that carry the loose
  default. Re-derive the exact list with
  `grep -rL '\*\*Narration' packages/engine/plugin/skills/*/SKILL.md` —
  `search-wikipedia` is a deliberate exception and must not gain the line.
- **Acceptance:** median narration chars/run falls below 6,000 on an
  instrumented autonomous run, with no dimension regression in the affected
  skills' suites.
- **Caveat:** narration is *output*. At ~4,552 tokens/run it is roughly $0.07 of
  a $20 run and perhaps 1–2 minutes of a 60-minute run. Do it because it is
  cheap and the rule is being ignored, not because it is a residency lever.

## Not in this plan

- **The 1M context window.** Last resort by the lead's ruling, and a cheap
  reachability probe was inconclusive (a padded one-shot prompt never reaches the
  API oversized — the CLI manages context itself). Settling it properly needs a
  long run where the autocompact threshold is observable. At 5× headroom it would
  hide the problem rather than fix it.
- **Lowering `effort`.** Gated on measurement (2). It is a quality trade against
  a saving not yet shown to exist.
- **Compaction as a designed checkpoint.** Project state already persists to
  `research.json` and `tree.gedcomx.json`, so the durable answer is on disk, not
  in the window — a deliberate checkpoint-and-restart could reload only what is
  needed instead of an SDK prose summary. It is the only idea here that attacks
  the 449k total rather than shaving items off it, and it is too speculative to
  plan until levers 1–3 are measured.

## Sequencing

1. The baseline instrumented run (in progress) → read the three items above.
2. Scope levers 1 and 2 from `result_chars`; they need no eval slot and no
   architecture change.
3. Answer lever 3's "tuning or feature?" question free, from the same run.
4. Levers 4–6 follow the measurement, not this doc's ranking.

Re-rank after step 1. Four of the six levers are ranked on a floor, and the run
exists to replace it.
