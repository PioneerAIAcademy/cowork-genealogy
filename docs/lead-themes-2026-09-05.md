# Themes requiring the lead, by urgency

**Written:** 2026-09-05. **Source:** all 188 open Backlog issues, read in full,
plus measurements over the 161 committed e2e run logs on `main`.

**What this document is.** The areas where the lead is likely to need to author
PRs himself, not merely rule on them — selected by *where the board has no viable
owner*, not by past authorship. Sorted by urgency.

**How to use it.** Every measured figure below is reproducible; the command is
given inline. Re-derive before quoting — this is a snapshot of a corpus that
moves. Where a number contradicts belief, re-measure rather than reword
(CLAUDE.md § "A measurement that disagrees with belief is re-measured").

---

## Correction to an earlier claim in this analysis

An earlier pass asserted `research.json` was "re-read on every turn." **That is
false, and the lead was right to challenge it.** Measured:

| | |
|---|---|
| `research.json` Read calls, whole corpus | 2,140 |
| **Per run** | **median 7** (mean 13.3, max 99) |
| Turns per run | median 129 |
| **Reads per turn** | **0.054 — one read per ~18 turns** |
| Of those reads, **targeted** (`offset`/`limit`) | **79%** |
| Whole-file reads | 21% (450 calls) |

The targeted-read design is working as intended. The 2,140 figure was a
whole-corpus total misread as a per-run rate. The residual 21% whole-file reads
are worth a look but are not the cost story.

```sh
python3 - <<'PY'
import json,glob,collections,statistics
runs=[r for r in sorted(glob.glob("eval/runlogs/e2e/*/run-*.json")) if ".ann." not in r and ".final-" not in r]
shape=collections.Counter(); per=[]
for p in runs:
    d=json.load(open(p,encoding="utf-8")); n=0
    for c in d.get("tool_calls") or []:
        if not isinstance(c,dict) or c.get("tool")!="Read": continue
        a=c.get("args") or {}
        if not a.get("file_path","").endswith("research.json"): continue
        n+=1; shape["targeted" if ("offset" in a or "limit" in a) else "whole file"]+=1
    per.append(n)
print(shape, "median/run:", statistics.median(per))
PY
```

**What the cost actually is** is in Theme 1.

---

## Theme 1 — Performance: ~64K of context re-presented on every one of ~129 turns

**Urgency: highest. Nothing on the board owns this.**

### The measurement

| Metric (median e2e run) | Value |
|---|---|
| Cost | **$7.35** (mean $8.60, p90 $14.00, max $25.24) |
| Wall clock | **54 min** (p90 109 min, max 180 min) |
| Turns | 129 |
| Tool calls | 145 |
| Committed corpus total | **$1,170 / 171 hours** across 161 runs |

Decomposition, and this is the part that matters:

- **90% of wall clock is API time.** Stall waits are 10.8h across all 161 runs;
  judge time 0.9h. Latency and cost are therefore the *same* problem — the fix
  must reduce work done, not scheduling.
- **Cache-read is 8.1M tokens/run against 109K output — a 74:1 ratio.** At list
  rates that is ~32% of spend; with cache writes, **~53% of the bill is context
  re-presentation** versus 23% for output.
- **Per-turn context is ~64,469 tokens — and it is FLAT.** Shortest-quartile runs
  (87 turns) carry 65,636/turn; longest-quartile (190 turns) carry 64,246. It
  does not grow with conversation length.

### Why flatness is the finding

Flat per-turn context means this is **fixed overhead re-billed 129 times**, not
accretion. Conversation history, compaction tuning, and `research.json` read
discipline are all the wrong lever — they would all show growth. Something on
the order of 64K is present at turn 1 and never leaves.

Candidate mass, measured on `main`:

| Surface | Bytes | ≈ tokens |
|---|---|---|
| 46 tool schemas (what `ToolSearch` defers) | 89,674 | ~22,400 |
| `research/SKILL.md` (the orchestrator) | 29,113 | ~7,300 |
| All 27 `SKILL.md` combined | 500,429 | ~125,000 |
| All agent bodies combined | 176,220 | ~44,000 |

**This is a hypothesis, not a result.** The run logs record totals, not a
per-turn breakdown of what occupied the window. The first piece of work is
instrumentation that attributes the 64K — until that exists, every lever below is
a guess.

### Why this needs the lead

The board holds ~45 issues touching context and cost, and every one is a **knob
on the symptom**: the eight pairing conversions (#2115–#2122), the five
model/effort floors (#2238–#2242), #2034 (init-project's 41KB), #1275
(prompt-budget ceiling). None owns the 74:1 ratio. The two projection issues that
would bear on it — **#1487** (`tree_query`) and **#1157** (logIndex) — are both
**iceboxed**.

**#1136** (reasoning-effort and model A/B) is lead-held and marked the largest
single latency lever, but it tunes the knob without the attribution.

**First action:** instrument per-turn context attribution before spending
anything on #1136 or the pairing conversions. A cheaper model applied to a 64K
fixed overhead saves less than removing the overhead.

---

## Theme 2 — Nothing can tell whether a change worked

**Urgency: highest. This gates Theme 1 and every delegation.**

The grading apparatus is unreliable in ways that are documented but unowned:

- **#2191** — the judge does not obey rules written in its own prompt and rubric,
  **and nothing measures a prompt edit.**
- **#2057** — one failing validator skips the *entire* judge, leaving every
  judged dimension ungraded on an unrelated failure.
- **#1687** — a fixture README states the verdict and the judge reads it in full:
  an answer key handed to the grader.
- **#1790** — the only merge test invents an `OWNERSHIP_TABLE` in its
  `judge_context`.
- **#2234** — the annotation UI appends comments, silently fails to save, and can
  write to the wrong test. Annotations *are* the calibration corpus, and the UI
  is the only sanctioned writer, so there is no workaround.

Also #1913, #2190, #2196, #2110, #2212, #1442, #1605.

**Why this is first among equals.** Theme 3 records three separate cases of a fix
that did not bind (#2030 across three runs, #1624 across two independent
attempts, #2230 intermittent in 2 of 5 logs). With the judge in this state, the
team **cannot distinguish "the fix did not work" from "the grader did not see
it."** Performance work is unverifiable for the same reason.

**Bench depth:** only 6 people have touched `eval/harness/judge/` in 90 days —
the thinnest on the board, and the path has its own CODEOWNERS line precisely
because nothing else covered it.

---

## Theme 3 — Prose does not bind, and there is no general replacement

**Urgency: high. ~40 issues queue behind one decision that does not exist.**

Measured instances of a written rule failing to change behavior:

- **#2030** — the rule is in `SKILL.md`; three measured runs ordered the plan
  identically anyway, varying their own wording between runs (so they were
  reasoning freshly and still ignored it).
- **#1624** — wrong grandparents attached across **two independent fix attempts**.
- **#2230** — byte-identical validator failure in **2 of 5** committed run logs on
  a rule `init-project/SKILL.md:159` already states unambiguously.
- **#1837** — **58 of 156** runs wrote a relationship without ever calling
  `person_warnings`, the cheapest guardrail in the system (no LLM, no network).
- **#1852** — **47 of 56** runs that wrote a conflict never invoked
  `conflict-resolution`.

CLAUDE.md's lane-4 doctrine already says to prefer a writer-tool precondition.
What is missing is a **general answer plus a reference implementation**, so each
case stops being re-litigated individually. Four issues are stalled asking
exactly this, one at a time: **#2182, #2184, #2086, #2108**.

**Highest delegation leverage on the board** — a general precondition mechanism
converts a large class of stalled doctrine work into ordinary developer tasks.

---

## Theme 4 — Shipped capabilities are never reached

**Urgency: medium-high. Needs a ruling more than a PR.**

Measured non-invocation:

| Capability | Evidence |
|---|---|
| `timeline` | `timelines[]` empty in **all 157** committed e2e final states |
| `translation` | never invoked, while **29%** of fixtures are non-English (#2074) |
| `search-full-text` | nothing routes to it; autonomous runs never search full text (#1860) |
| `conflict-resolution` | 47 of 56 conflict-writing runs skip it (#1852) |
| `source_attachments` | never consulted before a gap-filling search (#2208) |
| `gps-mentor` | zero eval coverage of any kind (#1253) |

Filed individually as routing bugs; together they say the **orchestrator's
routing model does not work**. **#1335** ("reconcile the four contradictions in
its prose") is the closest thing to an owner — `senior`, and blocked on the lead.

---

## Theme 5 — Method-level product questions

**Urgency: medium. Ruling only; genealogists implement.**

Senior genealogists contradicting shipped enforcement:

- **#1828** — should a full-text search ever be scoped to a collection? We ban it
  in prose, a rubric, **and a hard validator**; a senior genealogist says the ban
  is wrong.
- **#1831** — can a project start from a record instead of a tree person? All
  three bootstrap paths end at a tree node.
- **#1827** — a tree node may not correspond to one person, at the moment
  conflation is most likely.
- **#1830** — must a reasonably accessible source be searched? The plan-time test
  never asks.
- **#1824, #1829.**

These would invalidate shipped enforcement. Genealogists can supply the rule;
only the lead can accept the blast radius.

---

## Theme 6 — Hosted / control plane

**Urgency: medium, with one urgent item. Delegable in principle, thin in practice.**

- **#1915** — hosted runner wedges when subagents outlive a turn; **4 of 8
  extractions lost** in a real session. Highest-severity live bug on the board.
- **#290** — one developer's tailnet is the compiled-in production default for
  four tools, in every hosted sandbox and every installed `.mcpb`. Flagged a beta
  blocker.
- **#2037** (required-check ruleset — "the lead's call"), **#1489**, **#1127**,
  **#1124**, **#1120**, **#1036** (53 open Dependabot alerts, only 4 with a
  rationale).

The lead is 59% of commits here across 105 commits and 21 authors — but this is
conventional infrastructure work, and it is the theme most amenable to being
handed to a senior developer once #1915 and #290 are clear.

---

## What to do first

1. **Instrument per-turn context attribution** (Theme 1). Without it, #1136 and
   the eight pairing conversions are guesses.
2. **Fix the judge** (Theme 2) — specifically #2191 and #2057. Everything else,
   including Theme 1, is unverifiable until this holds.
3. **Rule once on preconditions-vs-prose** (Theme 3), with a reference
   implementation. Unblocks ~40 issues.
4. **Drain `needs-decision`** — 19 open items, excluded from ranking until
   answered, and the work behind them is often junior-sized. `/make-decisions`
   is cheap and converts lead time into other people's PRs at the best available
   ratio.

Themes 4 and 5 need rulings, not PRs. Theme 6 is delegable after #1915 and #290.

---

## Caveats

- **Cost decomposition is approximate.** Token counts were priced at Sonnet 4.6
  list rates; the three components sum to $5.63 against a recorded $7.35 median,
  leaving ~$1.70 unattributed (subagent calls at other rates, most likely). The
  **74:1 ratio and the flat 64K/turn are robust** — they come from recorded token
  counts, not from pricing.
- **The 64K composition table is a hypothesis.** Run logs record totals, not
  per-turn window composition. That is what item 1 above exists to establish.
- **136 of 161 runs carry cost data**; all 161 carry wall clock. Medians are over
  whatever each metric had.
- The corpus is not production (`docs/architecture.md` §9.4) and runs at lower
  concurrency than a hosted session.
