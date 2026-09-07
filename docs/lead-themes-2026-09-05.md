# Themes requiring the lead, by urgency

**Written:** 2026-09-05. **Revised:** 2026-09-07 — re-measured against the raw
SDK session transcripts, against a live probe, and against every cited issue's
comment thread. One headline figure was wrong, two themes collapsed.
**Second 09-07 pass:** Theme 3's class list was refuted by a shipped gate and now
carries the bridge between its two classes; Theme 4 (guards) is new, and the
hosted theme renumbered to 5.
**Source:** all open Backlog issues, read in full, measurements over the 161
committed e2e run logs on `main`, 11 raw session transcripts, and one live
probe on Claude Code 2.1.263.

**What this document is.** The areas where the lead is likely to need to author
PRs himself, not merely rule on them — selected by *where the board has no viable
owner*, not by past authorship. Sorted by urgency.

**How to use it.** Every measured figure below is reproducible; the command is
given inline. Re-derive before quoting — this is a snapshot of a corpus that
moves. Where a number contradicts belief, re-measure rather than reword
(CLAUDE.md, "A measurement that disagrees with belief is re-measured").

**Check the comments before treating an issue as open.** The 2026-09-05 draft
put two themes at medium urgency on the strength of six issues the lead had
already ruled on, two weeks earlier, in comments. Every issue below now says
whether a ruling exists.

---

## What the 2026-09-07 re-measurement changed

| 09-05 claim | Verdict | Now |
|---|---|---|
| "~64K of context per turn, and it is FLAT" | **Wrong denominator** | ~96K per API request. `num_turns` is ~1.4× the number of requests |
| "Something on the order of 64K is present at turn 1 and never leaves" | **False** | Turn 1 is ~23K. Context climbs to ~166K and compacts, 1–6 times a run |
| "Conversation history and compaction tuning are the wrong lever" | **Inverted** | They are the lever. Compaction is what makes per-turn context look flat |
| "Run logs record totals, not composition — instrument before spending" | **Superseded** | The raw transcripts already carry per-request usage and per-attachment composition. No new instrumentation was needed to answer it |
| The eight pairing conversions are "knobs on the symptom" | **Wrong** | A `Skill()` call puts the **whole** body in the main window — measured live at 44,164 characters, uncapped. Pairing is the mechanism that removes it |
| "Cost decomposition is approximate, ~$1.70 unattributed" | **A pricing choice** | At the repo's own calibrated rate the estimate covers 82% — exactly the 0.90x `eval/harness/e2e/pricing.py` documents. Cache **write** is the larger half |
| Themes 4 and 5 need lead rulings | **Mostly already ruled** | Five of six method questions and three of six routing gaps were ruled 2026-08-23 to 2026-09-02 |
| Issue #290 is an urgent beta blocker | **Superseded on the issue** | Iceboxed by lead ruling 2026-08-11 with a stated thaw trigger, and two of its three claims corrected in that same comment |

A finding this revision raised and then **killed with a probe** is recorded under
Theme 1, "What the 20,000-character cap is and is not," so nobody re-derives it
and stops at the wrong conclusion.

---

## Theme 1 — Performance: ~96K of context per API request, and the write side costs more than the read side

**Urgency: highest. The board holds the lever; nothing holds the measurement.**

### The corrected measurement

| Metric (median e2e run) | Value |
|---|---|
| Cost | $7.35 (mean $8.60, p90 $14.00, max $25.24) |
| Wall clock | 54 min (p90 109 min, max 180 min) |
| `num_turns` | 129 |
| **API requests** | **~90** (`num_turns` is ~1.4× requests) |
| **Context per API request** | **~96,000 tokens** |
| Committed corpus total | $1,170 / 171 hours across 161 runs |

The 09-05 figure of 64,469 divided cache-read tokens by `num_turns`, which is
not the number of API calls. Measured on the raw transcripts, where each call
carries a `requestId`: the SDK emits **2.98 assistant records per request**, and
the median **context per request is 95,954 tokens** (per-run range
87,589–103,125 across 11 runs).

```sh
python3 - <<'PY'   # ground truth: dedupe by requestId in a raw transcript
import json,glob,os,statistics as st
for p in sorted(glob.glob(os.path.expanduser("~/.claude/projects/*e2e*/*.jsonl"))):
    seen={}
    for line in open(p,encoding="utf-8"):
        d=json.loads(line)
        if d.get("type")!="assistant": continue
        u=(d.get("message") or {}).get("usage") or {}
        seen.setdefault(d.get("requestId"), u.get("cache_read_input_tokens",0)
            + u.get("cache_creation_input_tokens",0) + u.get("input_tokens",0))
    v=list(seen.values())
    print(f"{p.split('T-e2e-')[1].split('/')[0][:30]:32s} requests={len(v):4d} "
          f"ctx/req={sum(v)/len(v):9,.0f} turn1={v[0]:7,} max={max(v):8,}")
PY
```

**Honest about the conversion.** The committed corpus records `num_turns`, not
requests, so its 67,684-per-`num_turn` figure can only be converted using the
2.98 ratio measured on those same 11 transcripts — that is a calibration, not an
independent second source. It is corroborated at ~6% by a chain that shares no
inputs with it: the corpus records 1.05 tool calls per `num_turn`, the
transcripts 1.42 tool-use blocks per request, implying 0.99. **Treat ~90–96K as
the number and 64K as retired.**

### The shape of a run

Per-request context is **not flat** and is **not fixed overhead**:

- **Turn 1 is ~23,000 tokens** in all 11 transcripts (22,875–23,678). That is
  the real fixed preamble.
- It **climbs to ~166,000** (161,899–167,841), compacts, and climbs again —
  **1–6 times per run** (median 3).
- The `invoked_skills` block re-attached at each compaction carries the last 5
  skill bodies at ~22,900 tokens.

Per-turn context looked flat across run-length quartiles because **compaction
caps it**, not because nothing accretes. A capped sawtooth and a fixed overhead
produce identical flatness; the 09-05 draft read the second from evidence that
cannot distinguish them.

The 09-05 candidate-mass table can be retired. Tool schemas are not the mass:
`ToolSearch` results average **40 tokens** across the 182 calls in the 11
transcripts (the committed corpus records 2,304), because deferral is on.

### Where the money goes

Priced at `eval/harness/e2e/pricing.py`'s own calibrated table (Sonnet, 1-hour
cache-write rate), over the 136 runs carrying both cost and tokens:

| Component | Share of recorded bill |
|---|---|
| **Cache write (churn)** | **31%** |
| Cache read | 29% |
| Output | 22% |
| Unattributed | 18% |

Median estimate/recorded is **0.90x** — exactly what that module documents, so
the 09-05 caveat about $1.70 unattributed was a pricing choice, not a gap.

**Cache write is the larger half of context spend (51% of it).** A block that is
byte-identical every turn bills at the read rate; a block where a few hundred
tokens change invalidates everything downstream and re-bills at the write rate.
Every compaction and every rotation of the skill block is a write event.
**Attribute by stability, not only by size.**

Latency and cost remain the same problem: median
`duration_api_ms / duration_ms` is **0.988**, against stall waits of 10.8h and
judge time of 0.9h across 171.3h.

### The lever the board already owns

A `Skill()` call puts the skill's **entire body** into the main-thread window.
Probed live on Claude Code 2.1.263 with a 44,164-character skill carrying
canaries at bytes 119 / 9,020 / 18,552 / 21,003 / 34,078 / 44,115 — **all six
came back**. An `Agent()` call contributes only its description; the whole agent
listing is ~2,100 tokens.

So `search-records` (60,807 bytes ≈ **15,200 tokens**, invoked in 157/161 runs)
and `person-evidence` (42,797 ≈ **10,700**, 137/161) are resident main-thread
mass every run. Pairing is what removes it, and it is already shipping:
`research-exhaustiveness` is now a 5,127-byte skill with a 21,001-byte agent,
`proof-conclusion` a 4,755-byte skill with a 50,143-byte agent.

The board holds 8 conversion cards, 8 effort-floor cards, plus issue #2243
(`search-records`, the biggest body of all) and issue #1852. What it does not
hold is the measurement that says which conversions pay. Issue #1136
(lead-held, `icebox`, 9 lead comments) tunes model and effort without it.

**First action:** rank pair conversions by `bytes × invocation rate`. That puts
`search-records` and `person-evidence` first, and it is a morning's work over
data already committed.

Two corrections to the 09-05 issue notes: issue #1157 is **not** iceboxed — the
lead reopened it 2026-08-31 with a `Touches:` line after building the
cross-check its closing condition demanded. Issue #1487 is.

### What the 20,000-character cap is and is not

Recorded because this revision raised it as a top-priority finding and then
falsified it, and the half that survives is easy to over-read.

**True:** Claude Code truncates a skill body to 20,000 characters and appends
`[... skill content truncated for compaction; use Read on the skill path if you
need the full text]`. Ten of 28 skills exceed the cap. In all 11 transcripts the
`invoked_skills` attachment count **equals the compaction count exactly** (33 and
33), and every attachment follows, within a few records, a system record whose
`subtype` is `compact_boundary`.

**False — and this was the tempting reading:** that long skills are therefore
delivered truncated. They are not. The probe above delivered 44,164 characters
intact, with **zero** truncation markers and **no** `invoked_skills` attachment,
because nothing compacted. The cap applies only to the copy *carried across a
compaction boundary*, and in every observed run each skill had already run its
course before the first compaction.

**Consequence, correctly scoped:** after a compaction, the tail of a long skill
is unavailable for later reference until that skill is invoked again. Worth
knowing; not a cause of the compliance failures in Theme 3, and specifically
**not** an explanation for issue #1837 — the instruction it concerns is
delivered whole at invocation.

---

## Theme 2 — Nothing can tell whether a change worked

**Urgency: highest. It does not gate Theme 1, and that matters.**

The grading apparatus is unreliable in ways that are documented and, unusually
for this board, **genuinely unruled** — six of the seven below carry no lead
comment at all:

- **issue #2191** — the judge does not obey rules written in its own prompt and
  rubric, and nothing measures a prompt edit. *No ruling.*
- **issue #2057** — one failing validator skips the *entire* judge, leaving
  every judged dimension ungraded on an unrelated failure. *No ruling.*
- **issue #1687** — a fixture README states the verdict and the judge reads it
  in full: an answer key handed to the grader. *No ruling.*
- **issue #2234** — the annotation UI appends comments, silently fails to save,
  and can write to the wrong test. Annotations *are* the calibration corpus and
  the UI is the only sanctioned writer, so there is no workaround. *No ruling.*
- **issue #2190** — negative-test framing ignores `grade_on_invariant`. *No ruling.*
- **issue #2212** — no place-search Georgia fixture. *No ruling.*
- **issue #1790** — an invented `OWNERSHIP_TABLE` in a merge test's
  `judge_context`. *Ruled 2026-08-23; sequencing blocker cleared 2026-09-07.*

Also issues #1913, #2196, #2110, #1442, #1605.

**Correction to the 09-05 draft: this does not gate Theme 1.** The draft's
header said it did; its own action list correctly put instrumentation first.
Resolve in favour of the action list. Context attribution, request counts and
cost decomposition are **token accounting** — no number in Theme 1 passed
through a judge. The judge gates only the second, later question: *did removing
the overhead hurt research quality?* Theme 1 can run at full speed now, in
parallel.

**Why it is still first among equals.** Theme 3 records three cases of a fix
that did not bind. With the judge in this state the team cannot distinguish "the
fix did not work" from "the grader did not see it."

**Bench depth:** `eval/harness/judge/` took **12 commits from 6 authors in 90
days, 7 of them the lead's** — five of the other authors have one commit each.
The path has its own CODEOWNERS line precisely because nothing else covered it.

```sh
git log --since="90 days ago" --format='%an' -- eval/harness/judge | sort | uniq -c | sort -rn
```

---

## Theme 3 — Prose does not bind, and there is no general replacement

**Urgency: high. ~40 issues queue behind one decision that does not exist.**

| Issue | Evidence | Ruled? |
|---|---|---|
| #1837 | 58 of 156 runs wrote a relationship without ever calling `person_warnings`, the cheapest guardrail in the system | No |
| #1852 | 47 of 56 runs that wrote a conflict never invoked `conflict-resolution` | Acceptance criterion set 2026-09-02 |
| #2030 | Three measured runs ordered the plan identically despite the rule, varying their own wording between runs | Ruled 2026-08-31 |
| #1624 | Wrong grandparents attached across two independent fix attempts | Comment 2026-09-07 |
| #2230 | Byte-identical validator failure in 2 of 5 committed run logs | No |

Issue #1837's rate re-derives higher on today's corpus — 84 of 148 runs (57%)
under the definition "any writer tool called with relationship data, and no
`person_warnings` call anywhere in the run." Either way it is about half.

**The classes have different ceilings, and the general ruling must say which
class an issue is in:**

- **Decidable from the project documents alone** → a writer-tool precondition,
  where it binds everywhere and cannot be argued with. Issue #1837 is this
  shape: `tree_edit` can refuse the write. This is ADR-0011's first question.
- **Requires observing that a skill ran** → no precondition can reach it.
  Nothing observes skill completion — the same argument that already made the
  caller-attributed recency check permanently shadow-only. Issue #1852 is this
  shape *as written*, but see the bridge below before accepting that.
- **Bridgeable: require the step to deposit its output, then gate on the
  output.** A rule that looks like the second class becomes the first when the
  step is made to write a durable artifact, because the artifact is a project
  document. **This is shipped, not theoretical.** The mentor gate in
  `research-append.ts` refuses `project.status = "completed"` while any proof
  summary backing a resolved question lacks a `proof-critique` entry in
  `evaluations[]` — a pure foreign-key join over data already in memory,
  snapshotted pre-call so a batch cannot append the verdict and consume it in
  the same write. It never observes that `gps-mentor` ran; it observes what
  `gps-mentor` left behind.

  The arc is the whole argument of this theme, walked to the end on one rule:
  `research/SKILL.md` has carried "verify BOTH gates, in order — do not write
  `completed` until both hold" since PR #1029, **23% of completed runs in the
  committed corpus reached `completed` with an uncritiqued summary anyway**, and
  the precondition is what closed it. Prose stated it, measurement killed it, a
  writer tool now holds it.

  So the second class is smaller than it looks. The test is not "can we observe
  the skill" — it is **"is there a later write we can gate, and can the step be
  made to leave something behind."** Issue #1852 has both: a conflict is written,
  and a question resolution follows it. Calling it structurally unreachable is
  at minimum unproven, and the ruling should not enshrine that.

A reference implementation cited against a case it structurally cannot cover
will discredit the mechanism — and so will one that declares a case unreachable
when a shipped gate already reaches its shape. Four issues are stalled asking
for that mechanism one at a time: **issues #2182, #2184, #2086, #2108** (two of
the four unruled).

**Highest delegation leverage on the board** — a general precondition mechanism
converts a large class of stalled doctrine work into ordinary developer tasks.

---

## Theme 4 — Our guards are proven on one shape, in one direction, and only where the output is a document

**Urgency: high, and it rises the moment Theme 3 is ruled.** Theme 3's answer is
"build preconditions." This theme is the ceiling on that answer: nothing here can
currently tell a working gate from a decorative one.

*Provenance: the first two sections below were raised by a new developer reading
the repo cold (2026-09-07). Both were checked against the code and both hold. The
third is this pass's own finding, from checking the first two.*

### One shape is not a proof

CLAUDE.md's new-lint rule — break the repo, watch the check fail — is right and
stays. But its three named ways a check silently passes are all about the check's
**reach**: a grep pattern that excludes its own tree, a `git grep` that skips
untracked files, a field-name match that collides with an unrelated key. None is
about the **shape of the input at the site**, which is the other way through:
unquoted, commented out, wrapped, a stringified argument, a null, a missing
token.

The rule as written asks for one broken shape — the one its author already had in
mind. That is the weakest possible proof, and it reads as a strong one, which is
CLAUDE.md's own "worse than no check" argument turned back on the rule.

Two instances in a single recent PR, both found by review rather than by a guard
(PR #2044):

- `--limit abc` parsed to `NaN`, selected zero images, and **exited 0 having done
  nothing**.
- `--only` / `--variants` were plain `includes()` filters, so a typo ran nothing,
  exited 0, and still made a paid ground-truth call.

The encoding lint became an AST lint for the same reason: greps failed on shape,
not on reach — a compliant call whose `encoding=` sat on a later physical line,
and a bare offender inside a multi-line call.

### A guard fails in two directions, and the graduation instrument sees one

A guard can wrongly block legitimate work, and it can wrongly let the bad thing
through. Break-then-restore tests one bad shape and one good tree — a single
point in each direction, not a proof in either.

The sharper problem is the instrument that decides whether a guardrail ships.
`eval/harness/e2e/guardrail_shadow_report.py` replays a shadow check across the
committed corpus, and ADR-0011 names it *"the instrument that produces a
satisfying-shape rate before a graduation."* **In a replay the guard is both the
detector and the ground truth.** It can count what it would have blocked; it has
no term at all for what it would have missed. Read the shadow-to-graduate table
in `guardrail-enforcement-spec.md` with that in mind — every column counts
firings, and none could report a miss.

The population is pre-filtered the same way. This document's own Caveats already
say committed run logs are converged states, so runs that failed and were re-run
are absent — which is why every compliance rate here is stated as a floor. The
same filter applies to a shadow replay.

Related, and unwritten for guards: when a bug turns out to be the second instance
of a class already fixed, the remedy is one shared guard, not a second one-off.
"Code reuse" in CLAUDE.md covers implementation; "redundant guards are
untestable" is a different rule. The AST encoding lint replacing three greps is
an unwritten instance of exactly this.

### Coverage is shaped by section, not by agent — and two agents have no gate at all

There is no general mechanism to check an agent's output, and the reason is
structural rather than an omission. `docs/specs/schemas/ownership.json` states it
of the only plane that binds in every environment: a writer-tool precondition is
**caller-agnostic** — *"it constrains the WRITE, never who made it."* So a gate
can only ever be "check this section," never "check this agent." The eight
`*Invariants` functions in `research-append.ts` are keyed on sections, and agent
coverage is whatever falls out of which section an agent happens to write. The
one plane that can discriminate by caller is the `PreToolUse` hook, which fails
open and is claimed by two rows. Nothing reads the manifest at runtime; it is
kept in step by review.

The consequence: **an agent whose deliverable is a return summary has nothing to
gate.** Of five plugin agents, three write documents and are covered
incidentally — `gps-mentor` (`evaluations[]`), `proof-conclusion`
(`proof_summaries`, plus `proofSummaryInvariants`), `research-exhaustiveness`
(`exhaustive_declaration`). Two are not covered at all, and they are where the
worst measured failures sit:

- **`record-extractor`'s identity assessments go in its return summary by
  design** — `extraction_append` refuses the `person_evidence` section, which is
  the correct fix for the write and leaves the judgement unauditable. That is the
  lane that produced *"a fabricated identity link carrying a match score no tool
  had computed."*
- **`image-reader`'s transcription is returned as text.** The image-transcribe
  spec's own closing line is "Nothing checks a transcription against its scan."

And what coverage exists checks **existence or shape, never judgement**. The
mentor gate asks whether a `proof-critique` verdict is on record. Nothing
anywhere asks whether the verdict is any good.

**First action:** add the input-shape requirement to the new-lint rule, and give
`guardrail_shadow_report.py` a stated false-pass term or a written admission that
it has none. Both are cheap. The third section is a design question and belongs
with the Theme 3 ruling, since it bounds what that ruling can promise.

---

## Theme 5 — Hosted / control plane

**Urgency: medium, with one urgent item. Delegable in principle, thin in practice.**

- **issue #1915** — hosted runner wedges when subagents outlive a turn; 4 of 8
  extractions lost in a real session. Highest-severity live bug on the board,
  `senior`, `reviewed`, and **already ruled 2026-08-26** — the lead wrote the
  issue and then specified the fix to three numbered steps in
  `apps/server/app/agent/real_agent.py`, with two further sightings recorded
  2026-08-31. It needs a senior developer, not a ruling.
- **issue #2037** (a security control no required check tests), **#1127**,
  **#1124** — all unruled. **issue #1489**, **#1120**, **#1036** (53 open
  Dependabot alerts, 4 with a rationale) carry lead comments.

**Correction: issue #290 is not urgent lead work, and the 09-05 bullet repeated
claims the lead had already corrected on the issue.** It was **iceboxed by lead
ruling 2026-08-11**, with a stated thaw trigger — "a real deployment URL
existing, whether ours or FamilySearch's" — and the hosting is fs-eng's. Two of
the three claims in the 09-05 bullet were corrected in that same comment: the
hosted override **shipped** (`wiki_api_url` / `pop_stats_url` are `Settings`
fields that `hosted_config()` writes, refreshed on every connect, 10 tests), so
redirecting hosted traffic is a one-line deploy change, not an engine rebuild;
and the 28% / 35% failure rates are **episodic** — 138 of 162 unreachable calls
fell on six days — with 103 of 304 non-success responses being the service
correctly reporting it holds no data (issue #1552).

What survives is narrower and still unowned: the desktop `.mcpb` and both eval
harnesses have no override path, and a failed or empty wiki call silently thins
the locality guide with no marker in the output.

**Bench:** `apps/server` took 77 commits from 15 authors in 90 days, 42 of them
the lead's (55%). Conventional infrastructure work; the theme most amenable to a
senior developer once issue #1915 is clear.

---

## What collapsed on re-check

Two of the six 09-05 themes were built on issues that had already been ruled on.
Both are now delegable implementation work, not lead work.

### "Shipped capabilities are never reached" — three of six already ruled

| Capability | 09-05 claim | Actual |
|---|---|---|
| `timeline` | never invoked; needs a ruling | **Ruled 2026-08-27 (issue #1836): deliberately not routed.** Empty `timelines[]` is "equally consistent with nobody needing it as with it being missing." Goes in the routing check's allow-list |
| `search-full-text` | "nothing routes to it; autonomous runs never search full text" | **Ruled 2026-08-27 (issue #1860): it gets a routing row.** And the second half is false — the `fulltext_search` **tool** was called 305 times in **58 of 161** runs. The *skill* ran 12 times. The capability is reached; the skill is bypassed |
| `citation` | (not listed) | **Ruled 2026-08-27: stays user-invoked, deliberately, with the reason recorded** |
| `translation` | never invoked, 29% non-English | **Ruled 2026-09-02 (issue #2074): run the falsification first.** Junior-genealogist work off committed logs |
| `conflict-resolution` | 47 of 56 skip it | Acceptance criterion set 2026-09-02 (issue #1852) |
| `source_attachments` | never consulted (issue #2208) | Unruled |
| `gps-mentor` | zero eval coverage (issue #1253) | Direction given 2026-09-01 and 2026-09-05: build the missing agent-invocation path once, shared with issue #2246 |

Issue #1335 ("reconcile the four contradictions") carries **ten** lead comments.
The 2026-09-01 one says "Both rulings landed 2026-08-25 and neither has reached a
skill body. **Nothing here is blocked**" — but four lead comments come after it,
and they re-open the cost question: `research` gained a unit suite on 2026-09-01,
so editing `research/SKILL.md` now buys a paid run, PR #2249 still edits that
file (PR #2237 landed 2026-09-07), and that day's comment says "**Re-price this
card before scheduling it.**" It needs that re-pricing before it needs an owner.

`timelines[]` is empty in **161 of 161** committed final states, not 157.

### "Method-level product questions" — five of six already ruled

| Issue | Actual |
|---|---|
| #1828 (collection-scoped full text) | **Ruled 2026-08-23: "not a decision" — `needs-decision` removed, `icebox` stays** |
| #1831 (start from a record) | **Ruled 2026-08-27: stays iceboxed, with a real trigger** |
| #1830 (must an accessible source be searched) | **Ruled 2026-08-27 and again 2026-09-02**; out of the icebox, defects scoped |
| #1824 (what makes a source original) | **Ruled 2026-08-23 and 2026-09-02**: treat all images as original; ARK-or-fields, never free text |
| #1829 (what full-text queries actually search) | **Promoted out of the icebox 2026-08-23** |
| #1827 (a tree node may not be one person) | **Genuinely unruled** — the only one |

The theme reduces to one open question. Genealogists can supply the rule; only
the lead can accept the blast radius.

---

## What to do first

1. **Rank pair conversions by `bytes × invocation rate`** (Theme 1). It puts
   `search-records` and `person-evidence` first, runs over committed data, and
   precedes spending on issue #1136 — a cheaper model applied to 15,200 tokens
   of resident skill body saves less than removing the body.
2. **Fix the judge** (Theme 2) — issues #2191 and #2057 specifically. It gates
   every *quality* claim, though not the token accounting in Theme 1, which can
   proceed in parallel.
3. **Rule once on preconditions-vs-prose** (Theme 3), naming the classes and the
   bridge, with a reference implementation. Unblocks ~40 issues. Read Theme 4's
   third section first — it bounds what the ruling can promise, because no gate
   can reach an agent whose deliverable is a return summary.
4. **Drain `needs-decision`** — 18 open items, excluded from ranking until
   answered, and the work behind them is often junior-sized. `/make-decisions`
   is cheap and converts lead time into other people's PRs at the best available
   ratio.

Theme 4's first two sections are junior-sized and need no ruling: put the
input-shape requirement into the new-lint rule, and either give
`guardrail_shadow_report.py` a false-pass term or write down that it has none.
Do them before the Theme 3 ruling multiplies the number of gates.

Theme 5 is delegable after issue #1915. The two collapsed themes need owners,
not rulings — except issue #1335, which needs re-pricing first.

---

## Standing correction: `research.json` is not re-read on every turn

An earlier pass asserted it was. **That is false, and the lead was right to
challenge it.** Measured:

| | |
|---|---|
| `research.json` Read calls, whole corpus | 2,140 |
| **Per run** | **median 7** (mean 13.3, max 99) |
| Reads per `num_turn` | 0.054 — one read per ~18 turns |
| Of those reads, **targeted** (`offset`/`limit`) | **79%** |

The targeted-read design is working as intended. The 2,140 figure was a
whole-corpus total misread as a per-run rate.

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

---

## Caveats

- **The raw transcripts are the new evidence and they are narrow.** 11 runs
  across 3 fixtures, captured 2026-08-16 and 2026-08-23 on Claude Code 2.1.139,
  living outside git (`.gitignore` excludes `*.session.jsonl`). The live probe
  is on 2.1.263. Anything not corroborated by the committed corpus or the probe
  is 11 runs' worth of evidence.
- **The per-request context figure rests on a calibration, not two independent
  sources.** See "Honest about the conversion" in Theme 1.
- **Tool-result composition is per-call, not per-run.** Those 11 runs are heavy
  users of `fulltext_search`; the corpus average is 1.9 calls/run. Weight
  per-call sizes by corpus call counts, never by these runs' counts.
- **Measured in the harness, not in Cowork.** The harness runs Claude Code as an
  SDK subprocess and stages skills into `.claude/skills/`; Cowork loads the
  plugin as a plugin. Skill injection should behave the same, but nobody has
  checked a Cowork session — and per ADR-0004 the three environments already
  differ in how they namespace tools.
- **136 of 161 runs carry cost data**; all 161 carry wall clock. Medians are
  over whatever each metric had.
- **Committed run logs are converged states.** Runs that failed and were re-run
  are not in the corpus, so every compliance rate here is a floor.
- **The corpus is not production** (`docs/architecture.md`, "What nothing
  checks") and runs at lower concurrency than a hosted session. Its dates skew
  hard to July 2026 (132 of 161 runs).
- The board moves: 48 tools now, not 46; 28 skills, not 27; 18 open
  `needs-decision`, not 19.
