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

## What is measured

Superseded 2026-09-15 by the first instrumented run (`ogletree-children`,
`run-2026-09-15_08-02-58`, $15.39, 93.8 min, 5 compactions, `end_turn`). Every
earlier table in this document was computed on **truncated** results and ranked
the wrong things. These figures are exact.

| fact | value |
|---|---|
| Main-thread tool bytes | **451,080 tokens**, exact — `result_chars`, no cap |
| Main-thread peak window | 164,235 (5 compactions) |
| Messages | 95 main / **98 subagent** |
| Total main-thread window growth | 412,447 |

**Main-thread tool bytes, by tool, one run:**

| tool | calls | ~tok | share |
|---|---|---|---|
| **`wiki_place_page`** | 16 | **82,422** | 18.3% |
| `record_search` | 23 | 68,955 | 15.3% |
| **`external_links_search`** | 5 | **55,746** | 12.4% |
| **`wiki_read`** | 8 | **54,192** | 12.0% |
| `volume_search` | 4 | 41,424 | 9.2% |
| **`wiki_search`** | 4 | **37,743** | 8.4% |
| `Agent` | 17 | 25,295 | 5.6% |
| `Read` | 15 | 19,062 | 4.2% |
| `research_append` | 15 | 16,112 | 3.6% |
| `record_read` | 10 | 12,080 | 2.7% |

**The wiki/external tools are 230,104 tokens — 51% of all main-thread tool
bytes**, and **32 of those 33 calls follow a `Skill: locality-guide`
invocation.** (Args plus result, over the four tools in the table.
`wikipedia_search` adds 2 calls and 44 tokens and is excluded.)
Single results run enormous: `volume_search` 12,680 tokens in one call,
`external_links_search` averaging **11,127 tokens per call** across five.

**`research_append` is 3.6%, not the 28% this document led with.** The pooled
table that produced 28% measured args exactly and results at a 4,000-char cap,
so it ranked the one tool whose payload is mostly arguments. Every
result-heavy tool was invisible. That error is the reason `result_chars` exists.

**Thinking is not a major residency term.** Tool bytes (451,080) exceed total
main-thread window growth (412,447) on their own, so tool payloads account for
the whole of it and thinking plus narration are swamped. Lowering `effort` is
not a residency lever. (The two totals are not directly subtractable — five
compactions evict content mid-run — but the direction is unambiguous.)

## The levers

Ranked by measured size over confidence. Each names what it touches and what
would falsify it.

### 1. Convert `locality-guide` (#2117). It is half the main thread.

Measured exactly on the instrumented run, main-thread tool bytes by the skill
that drove them:

| conversion | drives | tok/run | share of main tool bytes |
|---|---|---|---|
| **#2117 `locality-guide`** | `wiki_place_page`, `wiki_read`, `wiki_search`, `external_links_search` | **230,104** | **51%** |
| #2243 `search-records` (blocked on #2123) | `record_search`, `record_read`, `volume_search` | 122,459 | 27% |
| #2116 `research-plan` | `plan_items` / `plans` writes | 16,112 | 3.6% |

**34 of the 35 wiki/external calls on the main thread follow a
`Skill: locality-guide` invocation.** The per-call payloads are the largest in
the run: `external_links_search` averages **11,127 tokens a call**,
`wiki_place_page` 5,134 across 16 calls, `wiki_read` 6,755 across 8.

**Corpus check on the n=1 figure (all 173 committed runs).** Wiki/external
calls attributed to the last skill invoked:

| skill | calls | share |
|---|---|---|
| **`locality-guide`** | **803** | **78.8%** |
| `research-plan` | 156 | 15.3% |
| `search-external-sites` | 27 | 2.6% |
| everything else | 33 | 3.3% |

`locality-guide` is invoked in 47% of runs, but it is *why* wiki traffic is
heavy at all: the 91 runs that never invoke it make **1.8** wiki calls a run,
against 35 in the instrumented run that did. So the n=1 51% is directionally
confirmed, and #2117 captures 78.8% of the traffic corpus-wide.

**`locality-guide` is skipped in 53% of runs, against its own routing rule.**
`research/SKILL.md:139` routes to it whenever a question has no plan and **no
`localities` entry yet for its jurisdiction**. Of the 91 runs that never invoke
it, **zero** had a pre-existing `localities` entry — so all 91 were rule
violations, not correct skips.

That gate failure is already tracked: issue #2039 (two production tester
reports) was absorbed into **#2475**. What this adds is the denominator — the
board had two anecdotes, the corpus has **91 of 173 runs**.

**It also sharpens the sequencing.** Fixing the gate makes main-thread residency
**worse**, because `locality-guide` would then run on every run instead of half
of them, roughly doubling the wiki traffic that lands inline. So **#2117 should
land before or alongside any fix to #2475's gate**, not after it. The 51%
measured on a run where `locality-guide` did fire is the steady state the system
is supposed to be in.

**This also raises `research-plan` (#2116).** Its 3.6% write share understated
it — it drives **15.3% of all wiki/external calls**, and 90.7% of the wiki
traffic on runs where `locality-guide` never runs. Second-order to #2117, but
not the distant third its write share suggested.

**Every conversion in this document is gated on issue #2246.** #2117, #2116 and
#2243 each open with the same lead ruling (2026-09-07): *"the direct-agent
unit-harness arm lands before any skill→agent conversion starts … Do not start
this card until issue #2246 is closed."* #2246 is open. **#2123 is the only item
here that is unblocked.**

That does not weaken the case — it relocates it. **This measurement is the
argument for prioritising #2246**, because #2246 gates a queue whose top item is
51% of the main thread.

`locality-guide` is a skill, so it runs **inline in the main session** and every
one of those results lands in the orchestrator's window. Converting it to a pair
moves all 230,104 tokens into an agent window that is discarded when the agent
returns — the single largest change available, and it is already on the board,
unblocked, in `cluster:pair-conversion`.

- **Action:** prioritise **#2246** — it gates all three conversions. Start
  **#2123** alongside it (unblocked, and it gates #2243). Then **#2117**
  (51%), **#2243** (27%), **#2116** (3.6% of writes but 15.3% of wiki calls).
- **Acceptance:** main-thread `result_chars` for the wiki/external tools falls
  below 50,000 tok/run on an instrumented run, from 230,104, with no loss in
  locality findings.

#### This ranking replaces two earlier ones, both wrong, in instructive ways

- The **first** ranked `research_append` at 28% and first place. That table
  measured args exactly and results at a 4,000-char cap, so it ranked the one
  tool whose payload is mostly *arguments* and made every result-heavy tool
  invisible. `research_append` is really **3.6%**.
- The **second** ranked by *operation count* (`plan_items` at 27.2 ops/run) when
  operations are not tokens — those ops average ~111 tokens each.

Both are the same error in different clothes: ranking on the quantity that was
easy to measure rather than the one that mattered. **Rank on `result_chars`.**

### 2. Route `Read` of research.json to `research_query`

The scoped accessor already exists and is already used 9.8×/run. All `Read`
calls on the instrumented run came to **19,062 tokens across 15 calls** — an
upper bound on what routing-field reads of `research.json` cost.

- **Touches:** `research/SKILL.md` routing prose, and any sub-skill that reads
  the file directly.
- **Acceptance:** zero full-file `Read`s of `research.json` on an instrumented
  run (`result_chars` makes this checkable for the first time).
### 3. Use the staging sidecars that already exist

`stageSearchResults` (`record-search.ts:1074`) already writes full results to
`results/<log_id>.json` and returns a `resultsRef` handle;
`compactStagedRecordSearch` already slims what the agent sees. `search-records`
references `staged.resultsRef` in its body. Yet `record_search` is still 15.3% of
captured main bytes with 51 of 520 results saturating the cap.

So either the compaction is not aggressive enough, or triage pulls the full set
back into the window. **Determine which before building anything** — the
machinery is already there, and this may be a tuning change rather than a
feature.

- **Acceptance:** `record_search` `result_chars` p90 drops materially with no
  loss in records triaged per run.

### 4. (folded into lever 1)

`search-records` is the **second** largest lever at 27% of main-thread tool
bytes — see lever 1 for the measured comparison against `locality-guide`.

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

Be honest about the size: that is **~1%** of the main thread's traffic (451,080 tokens of tool payload on the instrumented run).
It will not move the compaction count. Two reasons to do it anyway:

- **It costs a prose edit.** No architecture, no eval slot, no measurement
  dependency. The cheapest item in this document.
- **The shipped instruction is already being violated.** **23 of the 28 skills**
  say *"default to a one-line preamble per action"*; 358 chars is three to five
  lines, a ~4× overshoot. And **`research/SKILL.md:22` — the orchestrator skill
  every autonomous run enters through** — already carries the tighter rule the
  others lack: *"one short preamble per phase / per record … Under
  `--autonomous` mode, suppress per-entry preambles entirely — the audit trail
  lives in the persisted `rationale`/`notes` fields, not in chat"*. **The e2e
  corpus is autonomous-only**, so on every run measured above that suppression
  should have applied and 57 narration turns should have been near zero. It is
  not a missing rule; it is a rule the orchestrator states about itself and does
  not follow.

So the work is not "write a shorter rule" — it is "find out why the rule that
exists is not binding", which is a lane-4 question under `docs/skill-lifecycle.md`
(a rule the model reads is not a rule the model follows) before it is a wording
change.

- **Touches:** the `**Narration:**` line in the 23 skills that carry the loose
  default. Re-derive the exact list with
  `grep -l 'default to a one-line preamble per action' packages/engine/plugin/skills/*/SKILL.md`
  — `grep -rL` returns files *without* a match and yields only `search-wikipedia`,
  which is a deliberate exception and must not gain the line.
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
- **Lowering `effort`.** Measured and dropped: tool bytes (451,080) exceed total
  main-thread window growth (412,447) on their own, so thinking is not a
  residency term.
- **Compaction as a designed checkpoint.** Project state already persists to
  `research.json` and `tree.gedcomx.json`, so the durable answer is on disk, not
  in the window — a deliberate checkpoint-and-restart could reload only what is
  needed instead of an SDK prose summary. It is the only idea here that attacks
  the whole 451,080 rather than shaving items off it, and it is too speculative to
  plan until levers 1–3 are measured.

## Sequencing

1. ~~The baseline instrumented run~~ — **done** (2026-09-15). Every figure above
   is from it.
2. **#2246** — the direct-agent unit-harness arm. It gates #2117, #2116 and
   #2243 by lead ruling, so it is the critical path for everything in lever 1.
3. **#2123** (`search-records` reference layer) — the only unblocked item here,
   and it gates #2243. Run it in parallel with #2246.
4. **#2117 `locality-guide`** — 51% of main-thread tool bytes, the moment #2246
   closes.
5. **Lever 2 (`Read` → `research_query`)** — 19,062 tok/run, no eval slot, no
   architecture change, no dependency on #2246.
6. **#2243** (27%), then **#2116**.
7. **Thinking/effort is off the list** — the run showed tool payloads account for
   essentially all window growth.
