# Themes requiring the lead, by urgency

**Written:** 2026-09-05. **Revised:** 2026-09-07 — re-measured against the raw
SDK session transcripts, against a live probe, and against every cited issue's
comment thread. One headline figure was wrong, two themes collapsed.
**Second 09-07 pass:** Theme 3's class list was refuted by a shipped gate and now
carries the bridge between its two classes; Theme 4 (guards) is new, and the
hosted theme renumbered to 5.
**2026-09-10 pass:** Theme 3's decision half is done — ADR-0011 carries the
ruling and now the bridge, the four issues that were waiting on the mechanism
were ruled 2026-09-07, the last two unruled cards were ruled 2026-09-10, and the
`needs-decision` queue is empty. No gate has been built: every open card named in
Theme 3 sits in Backlog with no assignee.
**Second 2026-09-10 pass:** Theme 2 turned the same corner. Five of its seven
headline cards carry rulings, issue #2212 is closed, and ten of the twelve are
unassigned. Ten of them collapse into two mechanisms — issue #2427 and a rewritten
issue #2234, each investigated against the code and each carrying a correction to
the card that motivated it. A third, issue #2426, was filed and closed the same
day on its own measurement; what survives it is recorded under Theme 2 so it is
not re-derived.
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

So `search-records` (60,807 bytes ≈ **15,200 tokens**, invoked in 159 of the 163
runs committed by 2026-09-10) is resident main-thread mass in almost every run.
Pairing is what removes it, and it keeps shipping: `research-exhaustiveness` is a
5,064-byte skill with a 22,028-byte agent, `proof-conclusion` a 4,755-byte skill
with a 53,424-byte agent, and `person-evidence` — 42,797 bytes resident when this
document was written — landed as a 2,937-byte skill with a 55,326-byte agent on
2026-09-09.

The board holds 7 open conversion cards of the 8 filed (issue #2119 closed —
`search-external-sites` cannot be an agent), 8 effort-floor cards, plus issue
#2243 (`search-records`, the biggest body of all), issue #2410
(`record-extraction`, which a pair conversion cannot reach either) and issue
#1852. What it did not hold was the measurement that says which conversions pay.
That is the table below. Issue #1136 (lead-held, `icebox`, 9 lead comments) tunes
model and effort, and should be priced against it: a cheaper model applied to
15,200 tokens of resident skill body saves less than removing the body.

**Measured 2026-09-10** over the 163 committed run logs, `SKILL.md` bytes ×
the fraction of runs that `Skill()`-invoked the skill:

| skill | SKILL.md | agent | runs invoked | bytes × rate | card |
|---|---:|---:|---:|---:|---|
| search-records | 60,807 | — | 159/163 | **59,314** | issue #2243, blocked on #2123 |
| research-plan | 30,265 | — | 162/163 | **30,079** | issue #2116 |
| question-selection | 17,042 | — | 162/163 | **16,937** | issue #2115 |
| record-extraction | 15,482 | — | 114/163 | **10,827** | issue #2410 |
| locality-guide | 20,751 | — | 72/163 | 9,166 | issue #2117 |
| search-external-sites | 31,537 | — | 26/163 | 5,030 | issue #2119, closed — cannot be an agent |
| check-warnings | 21,022 | — | 36/163 | 4,642 | issue #2118 |
| research-exhaustiveness | 5,064 | 22,028 | 95/163 | 2,951 | done |
| proof-conclusion | 4,755 | 53,424 | 93/163 | 2,712 | done |
| person-evidence | 2,937 | 55,326 | 139/163 | 2,504 | done |
| research | 29,622 | — | 10/163 | 1,817 | — |
| conflict-resolution | 26,505 | — | 9/163 | 1,463 | issue #1852 |
| search-full-text | 17,214 | — | 12/163 | 1,267 | issue #2120 |
| search-images | 15,087 | — | 8/163 | 740 | issue #2121 |
| init-project | 26,120 | — | 4/163 | 640 | issue #2122 |

Thirteen further skills score **zero** — `citation` (31,665 bytes), `timeline`
(21,833), `hypothesis-tracking`, `project-status` and the rest are never
`Skill()`-invoked in this corpus. Read that as the harness, not as disuse: the
e2e corpus is autonomous-only, and those are the user-invoked skills.

What it says:

- **The top three are 106K of the 115K on the board**, and `search-records`
  alone is more than half of it. Unblocking issue #2123 is the highest-value
  move in this theme.
- **`record-extraction` was fourth and had no card** — filed as issue #2410. A
  pair conversion cannot reach it: it is already a router delegating to
  `record-extractor` and `image-reader`, and agents cannot nest agents. Same
  class of blocker as the one that closed issue #2119, different mechanism.
- **A low score is not a reason to shelve a card — resident mass is half the
  payoff.** The other half is what a step costs *when it runs*, and only an agent
  can be tuned there: `model:` and `effort:` are inert on a skill. Measured over
  the same 163 logs, tool calls per skill episode:

| skill | episodes | calls in them | calls/episode | skill entered / its tools used |
|---|---:|---:|---:|---|
| search-full-text | 12 | 839 | **69.9** | 12 runs / 58 |
| search-images | 8 | 443 | **55.4** | 8 runs / 25 (`image_search`) |
| search-records | 208 | 7,398 | 35.6 | — |
| person-evidence | 158 | 5,465 | 34.6 | — |
| proof-conclusion | 98 | 2,064 | 21.1 | — |
| init-project | 4 | 68 | 17.0 | — |
| question-selection | 252 | 1,310 | 5.2 | — |

  **The two densest steps in the system are the two that score lowest on resident
  mass**, so a low score is not a verdict on a card. Their reasons differ, and only
  the first is a routing gap:

  - **`search-full-text` has no routing row at all.** `fulltext_search` runs 305
    times in 58 runs while the skill is entered in 12, and only 72 of those calls
    fall inside its own episodes — 112 land in `search-records`, whose body names
    full text as the next step and then refuses to route there. Issue #1860 rules
    that it gets a row; that lands before issue #2120's conversion.
  - **`search-images` already has a row** — digitized-but-unindexed sets, or
    indexed and full-text exhausted. Its low entry count is a narrow cue being
    rarely met, not an unreachable skill. What is left is one question worth a
    read: 27 of 47 `image_search` calls land outside the skill, in 18 runs.
    `volume_search`'s 240 calls are **not** evidence of bypass — 100 are
    `locality-guide` and 50 `research-plan` doing planning-time survey — and
    `image_transcribe`'s 456 are the `image-reader` delegation any caller may make.

  Episode attribution credits the last-launched skill, the same bias the phase split
  carries.
- **`init-project` cannot be priced from this corpus at all.** `project_create` is
  called **0 times in 163 runs** — every fixture ships a seeded project — so its
  640 measures the harness, not the skill. In production it runs once per project,
  with a 26,120-byte body, in the session that forms the researcher's first
  impression.
- **Issue #1852 is funded on its guardrail argument**, never on cost: 47 of the 56
  runs that write a conflict never invoke it.
- The `person-evidence` conversion did what it promised: 42,797 resident bytes
  down to 2,937.

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

**Urgency: highest. It does not gate Theme 1, and that matters. As of 2026-09-10
what is left is a build, not a decision** — the same turn Theme 3 took, three days
later.

The grading apparatus is unreliable in ways that are documented. The 09-05 draft
called six of the seven below "genuinely unruled," and that is now false:

| Issue | What it is | Status |
|---|---|---|
| #2191 | the judge does not obey rules written in its own prompt and rubric, and nothing measures a prompt edit | **Ruled 2026-09-09** — instrument only, `prompt.md` untouched; rule 2b blocks and only a fresh `make eval-skill` run clears it; `make judge-regrade` is the card's other deliverable |
| #2057 | one failing validator skips the *entire* judge, leaving every judged dimension ungraded on an unrelated failure | **Ruled 2026-09-07** — judge every non-aborted run; defective runs graded for diagnosis, excluded from the modal. **Ready** |
| #2190 | negative-test framing ignores `grade_on_invariant`, and on four tests tells the judge the skill should route to itself | **Ruled 2026-09-07** — surface the judge's 1, do not soften the framing |
| #1913 | a research-plan rubric dimension scored 3 in 67 of 67 and every axis is already deterministic | **Ruled 2026-09-09** — delete the dimension |
| #2110 | two collections-search fixtures contradict each other on collection 1999196 | **Ruled 2026-09-09** — both serve `personCount: 0`; the validator is unchanged |
| #1687 | a fixture README states the verdict and the judge reads it in full | Unruled |
| #2234 | the annotation UI appends comments, silently fails to save, and can write to the wrong test | Unruled |
| #1790 | tree-edit's only merge test grades against a rule its `judge_context` asserts, and no merge ever completes in it | **Ruled 2026-08-23 and twice on 2026-09-10** — authorize the write by tool identity (PR #2442), and let a skill clear a stale `primary` flag (PR #2446). What is left needs a paid `tree-edit` run |

Also issues #1605, #1442, #2196 (**Ready**), and #2212 — which is **closed**, merged
into #2110 on 2026-09-07. Its symptom did not reproduce on the 09-07 run
(`ut_research_plan_wzk` passed, no `fixture_not_found`); the gap on disk is real
but it no longer owns a red.

**Ten of the twelve are unassigned.** Issues #2057 and #2196 are Praise-Enato's
and sit in Review behind PR #2444, which is not a draft and carries
CHANGES_REQUESTED; issue #1790 is half built behind PR #2442. The rest are in
Backlog, and none is in Ready.

**Correction to the 09-05 draft: this does not gate Theme 1.** The draft's header
said it did; its own action list correctly put instrumentation first. Resolve in
favour of the action list. Context attribution, request counts and cost
decomposition are **token accounting** — no number in Theme 1 passed through a
judge. The judge gates only the second, later question: *did removing the
overhead hurt research quality?* Theme 1 can run at full speed now, in parallel.

**Why it is still first among equals.** Theme 3 records three cases of a fix that
did not bind. With the judge in this state the team cannot distinguish "the fix
did not work" from "the grader did not see it."

**Bench depth:** `eval/harness/judge/` took **12 commits from 6 authors in 90
days, 7 of them the lead's** — five of the other authors have one commit each.
The path has its own CODEOWNERS line precisely because nothing else covered it.

```sh
git log --since="90 days ago" --format='%an' -- eval/harness/judge | sort | uniq -c | sort -rn
```

### Three general fixes, filed 2026-09-10

Investigated against the code rather than inferred from the cards. Ten of the
twelve issues above collapse into three mechanisms.

**Issue #2427 — the judge prompt is assembled from unlabelled human prose, and
93 of 96 scenario READMEs state the verdict.** The anchor card. Eleven slots feed
the judge prompt; three carry static text the skill cannot see, and none of the
three is labelled with where it came from. All 96 scenario READMEs were read:
three are clean. **Far more than eight are *titled* with the answer** — the
malformed-fixture family alone is ten (`-bad-enum`, `-bad-id-prefix`,
`-bad-sidecar`, `-broken-fk`, `-broken-fk-refs`, `-cross-file`, `-dangling-ref`,
`-missing-field`, `-stale-plan`, `-typo`), and `census-household-absent-spouse`
names in its directory the very absence its own README insists the scenario
"**never states**". The worst read as neutral state —
`ma-birth-record-unsearched` names the record the test exists to see whether the
skill finds; six `mid-research-flynn-*` malformed-fixture READMEs give the
expected validator error verbatim (a seventh, `-with-evaluation`, states a
*pass*: "valid, 0 errors"). `mid-research-flynn` reaches 134 tests across 21
skills. Subsumes the general half of #1687, #2190 and #2191's tool-call-slot
finding.

The recommendation is structural, not lexical: a separate `judge-brief.md` that
the slot reads, so an absent brief renders empty instead of leaking a README
written for a human. A `## Setup` heading cannot work — 50 of 96 READMEs have no
`##` heading at all, and a missing heading yields an empty slot with nothing red.

**Split 2026-09-10.** #2427 keeps the mechanism — the slot, provenance framing on
every slot, splitting the negative framing's machine lines from the test
author's, and the acceptance regrade. **Issue #2437** takes the 96 briefs, in the
genealogist lane, because that half is prose judgement about what each scenario
may tell a grader and it would otherwise bury four Python functions under a
96-file review. The guard — every scenario referenced by a test has a brief —
lands with #2437, since it cannot go green until the sweep finishes.

The split forces one design call that neither card had to make while they were
one: the mechanism ships before any brief exists, so a literal "absent brief
renders empty" empties the slot for all 96 scenarios at once. Fall back to the
README while a brief is missing, **count the fallbacks visibly**, and make
removing the fallback the sweep's last step. An invisible fallback becomes
permanent — the same failure as `rule2b_judge_prompt`, warn-only and dark long
enough to ship a regression green.

**Issue #2426 — split the run-log snapshot into skill-side and judge-side —
was filed and closed the same day, not planned (lead ruling 2026-09-10).** It is
recorded here because the investigation behind it produced three facts that
outlive it and that the next person to reach for this idea will otherwise
re-derive.

Its premise was sound: `build_snapshot` embeds `rubric.md`, the scenario README
and each test's `judge_context`, none of which the skill can see —
`workspace.py` stages only `research.json`, `tree.gedcomx.json` and `results/`.
Its own measurement killed it. **1 of 1009 PR-level commits since 2026-06-01
changed a judge-side file with no skill-side file**, and 122 changed both. The
queue it would have served is three ruled prose deletions, which do not carry a
17-file change. The honest counter — the gate is what makes judge-side edits
expensive, so 1-in-1009 may be measuring suppression rather than demand — is an
argument, and reopening needs a measurement.

What survives it:

- **`make judge-regrade` was never this card's**, it is issue #2191's ruled
  deliverable. Everything that actually needed a regrade still has one: issue
  #2427's acceptance check, issue #2057's 110 ungraded runs, and #2191's own
  need to price a candidate prompt.
- **The merge gate was one row of three.** `rubric.md` and a test's
  `judge_context` block on rules 2 and 3; the scenario README matches
  `FIXTURE_PATH_RE` and lands in `fixture_touched_skills`, which
  `check_runlogs.py` keeps "in a set separate from `touched_skills` so it never
  feeds the blocking rules" — **warn-only** since issue #1094. The assembly code
  in `orchestrator.py` / `judge.py` fires no runlog-discipline rule (it is still
  covered by blocking pytest — `.github/workflows/eval-harness-tests.yml` matches
  `^eval/harness/`, and 10 `render_prompt` tests pin it). So the 96-file sweep
  was never gated, and any cost quoted for it is discipline, not CI.
- **`rubric_hash` is named as a run-log field in four places in
  `unit-test-spec.md` and exists in no schema, no module and no run log.** Live
  spec drift; delete it from the spec, since nothing will build it now.

And one requirement that transferred to #2427 rather than dying: a regrade
substitutes for a re-run only if it **re-renders the prompt from disk** rather
than replaying a stored one. **Prove that on the rendered prompt hash, never on
the scores.** `JUDGE_TEMPERATURE = 0.0` is greedy decoding, not a determinism
guarantee, so "an unchanged tree reproduces the stored scores" passes just as
happily when a stored prompt is being replayed. A no-model dry-run over the
renderer separates them, and is cheap enough to live in `make harness-test`: an
unchanged tree renders byte-identically twice; one character into a `rubric.md`
moves every prompt hash for that skill; one scenario brief moves the hash for
exactly the tests referencing it; and a `SKILL.md` edit moves **no** prompt hash
— the break a per-directory predicate survives at step two and fails here.

Found while checking it: **`rubric_hash` is named as a run-log field in four
places in `unit-test-spec.md` and exists in no schema, no module and no run log.**
Half of this card is live spec drift.

**Issue #2234 — the eval app's write path** (rewritten, not re-filed). Three
failure modes, three distinct causes, none of them the filesystem layer, which is
correct. Mode 2: `DimensionRow`'s unmount cleanup clears the 500 ms commit timer
without committing, so switching tests inside 500 ms discards the edit silently.
Mode 3: `focusedDim` is cleared on the score picker's blur, and a focused element
removed from the DOM fires no blur — so the `1`/`2`/`3` shortcut writes to the
test you just left. Mode 1 is not a save bug at all: `buildPrComment` embeds the
box's current text at its own trailing `Junior:` slot, so copy → paste → copy
nests a block per cycle, and the header snapshots the score at copy time.

### What the investigation corrected

- **Issue #1790's premise is false, and the 2026-08-23 ruling rests on it.** The
  `OWNERSHIP_TABLE` is not invented — it is `docs/specs/schemas/ownership.json`,
  loaded by `eval/harness/harness/ownership.py` and frozen in
  `test_ownership_manifest.py`. The three mappings the `judge_context` quotes are
  correct. Outside that test (`eval/tests/unit/tree-edit/person-merge-stub-into-fs-person.json`)
  the bare token appears only in `docs/specs/unit-test-spec-v2.md` and as an echo
  of the same test in one committed run log — the earlier "three other places"
  counted this document and that echo. mercyokum
  said so on 2026-08-24 and the body still carries the original wording, so
  whoever implements ruling item 2 deletes a true sentence for a false reason.
  The real defect on that card is the **scoring imperative** — "Judges MUST score
  Merge correctness as `pass`" — not a phantom rule.

  Re-ruled 2026-09-10 once the manifest's two fields were separated: **`callers`
  is enforced and `writerTools` fed no authorization decision** (it is read, by
  `ownership-manifest.test.ts`'s "carries every required field, non-empty" and
  "resolves every writer tool to a registered tool name" — both lints on the
  declaration, neither on any write), so the 2026-08-23 ruling's
  "add the tool to the four rows" was a documentation edit with no effect.
  PR #2442 makes the field real — a section diff is authorized by the calling
  skill *or* by a declared writer tool whose own id permutation explains the
  whole delta. Rejected: adding `skill:tree-edit` to `callers`, which grants the
  section by any path and reopens the failure the `person_evidence` row names.
  The source-vs-manifest guard in PR #2442 — still open — **found a fifth section
  on day one** — `proof_summaries` carries person refs, is enforced on the unit
  plane, and listed only `research_append`.

  The card's absorbed issue #1813 half was ruled the same day on the same test:
  **if the state is only reachable the way the test reaches it the test is bad,
  otherwise fix the tool.** It is reachable — 10 persons across 9 e2e final trees
  carry a vital type with two facts and a stale `primary`, against 0 across the
  97 scenario fixtures, and the path is `materialize_facts`, which never sets
  `primary` and surfaces the conflict. Not merges: `mergeFacts` already clears
  and re-marks. PR #2446 makes `primary: false` an instruction at the tool
  boundary rather than a stored value, so the omit-when-false convention and the
  schema are both untouched.
- **The annotation corpus is clean.** 0 of 5153 corrections name a test absent
  from their run log, 0 carry an `llm_score` disagreeing with the sibling run
  log, 0 run logs hold a duplicate test id. So mode 3 has not silently corrupted
  the ground truth under #2191's, #2196's and #2190's confirmation counts. Six
  corrections across three files carry an incoherent embedded header, including
  the 1743-character one that #2234 said had been cleaned before commit — **it is
  on main.**
- **A lexical guard over judge-visible prose fails in both directions, measured
  twice.** Over the annotation corpus, all 6 comments naming a foreign test id
  are legitimate cross-references. Over the READMEs, the modal verdict pattern
  fires on 79 of 96, misses 16 of the 17 it does not match, and false-flags
  `driscoll-source-audit` — the one deliberately clean file — because it names
  the rule it complies with. The repo has already run this experiment:
  `check_rubric_tool_drift.py` is a lexical lint over this exact prose — **81
  warnings** on 2026-09-11 (`python3 eval/harness/scripts/check_rubric_tool_drift.py`;
  the 68 figure counted only the `rubric.md` + `judge_context` subset, the other
  13 are agent bodies), warn-only. The "about 20% genuine" share is inherited
  from the script's own 2026-07-30 docstring and has never been re-measured.
- **Issue #2057's ~90 is 109 of 2131 runs (5.1%)** on 2026-09-11, all of them
  retroactively gradeable once a regrade target exists. That is the
  validator-caused subset: 133 runs skip the judge in total, of which 16 were
  aborted (nothing to grade) and **8 are judge API/parse failures, which the
  09-07 ruling does not recover** — so "all retroactively gradeable" is true of
  the 109, not of every skip. Consequence nobody has
  costed: those tests are already named in `review_sample`, so filling in their
  dimensions creates rule-3 annotation debt on the next PR touching
  person-evidence and search-records.

### What the sweep is actually worth

The corrected reading, now that the snapshot split is dead: **the 96-file sweep
was never gated by CI**, so no cost quoted for it is a merge gate. What it buys
is honesty about the corpus. Once a scenario brief changes, every committed judge
score for the tests referencing it was measured against different input, and a
regrade under issue #2191 is what makes those scores describe the current inputs
again — cheaply, and in the same run that produces the acceptance evidence.

The acceptance check is the part worth protecting: regrade the
`flynn-record-matching` and `christian-hole-quality` runs, README against brief,
and accept only when no dimension moves on a run where the skill did the work
**and** at least one moves down on a run the corpus already flags as thin.
**If nothing moves either way, the leak was not load-bearing and the sweep should
not be paid for.** That is a finding, not a failure, and it is the cheapest thing
in this theme that could retire a card.

---

## Theme 3 — Prose does not bind, and there is no general replacement

**Urgency: high, and what it is waiting on has changed (2026-09-10). The
decision exists** — ADR-0011 carries the layer map, the decision procedure, the
bridge and the promotion table, and the four issues that were queued behind the
mechanism were ruled 2026-09-07, and issues #1837 and #1624 on 2026-09-10.
**What has not happened is a build.** Every open card below is in Backlog,
unassigned. Gates are shipping from other cards — the
conflict blocking-link derivation, the empty-plan refusal, the relationship
source-ref mint — so the mechanism is in use; it has not reached this list.

| Issue | Evidence | Ruled? |
|---|---|---|
| #1837 | 58 of 156 runs wrote a relationship without ever calling `person_warnings`, the cheapest guardrail in the system | Ruled 2026-09-10 — ship as designed; the gate recomputes `person_warnings` predicates only, and the place-resolution class rides on issue #1907 |
| #1852 | 47 of 56 runs that wrote a conflict never invoked `conflict-resolution` | Acceptance criterion set 2026-09-02 |
| #2030 | Three measured runs ordered the plan identically despite the rule, varying their own wording between runs | Ruled 2026-08-31 |
| #1624 | Wrong grandparents attached across two independent fix attempts | Closed 2026-09-10 — the `same_person` half is issue #1731, the mechanical half re-filed as a `person_evidence` precondition, issue #2409 |
| #2230 | Byte-identical validator failure in 2 of 5 committed run logs | Ruled 2026-09-07 — refuse delta-scoped in every writer, `project_create` stamps a default import source, the healer backfills |

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
  `completed` until both hold" since **PR #811** (merged 2026-07-23; the prose
  landed in `ee088b964`), and **29 of 128 completed runs in the committed corpus
  reached `completed` with an uncritiqued summary anyway** — the 23% headline.

  **The blend is the wrong instrument, and it flatters this theme's own thesis.**
  Date-split over the same 128 runs, re-derived 2026-09-08 over the 161 committed
  run logs:

  | window | rate |
  |---|---|
  | before the prose existed | 23/70 = 32.9% |
  | prose stated, nothing enforcing | 6/53 = 11.3% |
  | precondition live (2026-08-17 on) | 0/5 = 0% |

  **23 of the 29 violations predate the prose.** So "prose stated it, measurement
  killed it" *understates* what prose did — the rate fell by two thirds once the
  sentence existed — and "the precondition is what closed it" rests on n=5, whose
  3/n bound is 60%, the same rule of three this document applies to the
  postconditions table. The direction is monotonic and survives; the number and
  the attribution do not. This is the trap this theme names twice elsewhere: the
  corpus's age wearing a finding's clothes.

  Re-derive: for each `eval/runlogs/e2e/*/run-*.final-research.json` with
  `project.status == "completed"`, flag it when some `proof_summaries[]` entry
  whose `question_id` names a question that is `resolved` has no `evaluations[]`
  entry with `focus: "proof-critique"`, a matching `target_id`, and a null
  `superseded_by`; bucket by the date in the filename.

  So the second class is smaller than it looks. The test is not "can we observe
  the skill" — it is **"is there a later write we can gate, and can the step be
  made to leave something behind."** Issue #1852 has both: a conflict is written,
  and a question resolution follows it, so calling it structurally unreachable is
  unproven. That conclusion is not contested: the lead already ruled on #1852 on
  2026-09-01 (the blocker is gone, and an acceptance criterion for the conversion
  followed on 2026-09-02). The point stands with more support than "unproven"
  claims for it — what remains is to stop citing it as the unreachable case.

A reference implementation cited against a case it structurally cannot cover
will discredit the mechanism — and so will one that declares a case unreachable
when a shipped gate already reaches its shape. Four issues are stalled asking
for that mechanism one at a time: **issues #2182, #2184, #2086, #2108**. All
four now carry a lead ruling dated 2026-09-07 with the `needs-decision` label
removed (13:28, 14:42, 13:29 and 14:18 UTC), every one of them before this
branch's first commit — so what they were stalled on is the mechanism, not a
decision. **As of 2026-09-10 the mechanism question is settled too**: each ruling
names what to build, and all four sit in Backlog with no assignee. Issue #2184 is
the one exception, ruled *not yet* — no `source_ids` on plan items until issue
#2077's supersede op shows the `revision_note` link is insufficient.

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

Two instances, both found by review rather than by a guard, in two PRs merged 59
minutes apart — `ba73881ad` (PR #2042) fixed the `--only`/`--variants` filter and
PR #2044 the rest. CLAUDE.md's version of this rule names no PR and is accurate
as written:

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
untestable" is a different rule. The `encoding="utf-8"` AST lint is the nearest
shipped instance, and it is worth stating precisely rather than as a count:
CLAUDE.md justifies it on a grep being **wrong in both directions** — a per-line
grep false-flags a compliant call whose `encoding=` sits on a later physical
line, and a file-level grep misses a bare offender inside a multi-line call. It
replaced a grep that could not be made right, not a tally of three checks, and
its add-commit deleted no grep check.

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
(`exhaustive_declaration`). Two have **no gate on the deliverable that carries
the failure**, and they are where the worst measured failures sit. "Not covered
at all" would overstate it for `record-extractor`, which writes `sources` and
`assertions` under ownership rows; what is ungated is its identity assessment,
which the bullet below states correctly:

- **`record-extractor`'s identity assessments go in its return summary by
  design** — `extraction_append` refuses the `person_evidence` section, which is
  the correct fix for the write and leaves the judgement unauditable. That is the
  lane that produced *"a fabricated identity link carrying a match score no tool
  had computed."* **Ruled 2026-09-10: accepted, because the write it feeds is
  already gated.** The harm is the link, not the summary, and the link is
  `person_evidence` in `research_append` — issue #1731 has the tool record its
  own `same_person` score, so a `match_score` is checked against a call that
  happened, and issue #2409 refuses a confident link contradicting a documented
  surname. That is the bridge applied to this lane: a covered write reached from
  an uncovered summary.
- **`image-reader`'s transcription is returned as text.** The image-transcribe
  spec's own transcription section closes on "Nothing checks a transcription
  against its scan". **Ruled 2026-09-10: accepted and recorded in that spec, not
  gated.** The bridge buys existence, not fidelity — a persisted transcript
  proves a page was read and says nothing about whether the words match it — and
  an existence gate would police a failure the corpus does not contain (0 of 123
  attributed `image-reader` instances returned without calling
  `image_transcribe`). Fidelity needs a second read, which is the Opus arm that
  was built and retired on a three-way OCR benchmark. What reopens it: a
  confident-garbage instance in a graded run or a feedback bundle, per instance.

And what coverage exists checks **existence or shape, never judgement**. The
mentor gate asks whether a `proof-critique` verdict is on record. Nothing
anywhere asks whether the verdict is any good.

**First action: both halves are done in this PR.** The input-shape requirement is
in CLAUDE.md ("One break is not a proof" and "Prove the other direction too"),
and `guardrail_shadow_report.py` now carries the written admission that it has no
false-pass term, in its docstring and beside the graduation table. Left as
pending, this line invites `/fill-ready` to file two finished tasks. The third
section was a design question belonging with the Theme 3 ruling; it was ruled
2026-09-10, above, and the general half is now a row in ADR-0011: **coverage
follows the artifact, not the agent.**

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
2. **Fix the judge** (Theme 2). It gates every *quality* claim, though not the
   token accounting in Theme 1, which can proceed in parallel. As of 2026-09-10
   the order is settled: **issue #2057** is already in review as PR #2444 — land
   that first (harness code, no paid run, and it grades 109 runs that today
   carry nothing), then
   **#2191**'s regrade target, then **#2427** and the sweep it splits off,
   **#2437**. Ninety-three of 96 scenario READMEs hand the grader the answer —
   the largest single defect in the theme, and the one whose acceptance check is
   cheap enough to retire itself if the leak turns out not to be load-bearing.
   Issue #2234 runs beside all of it: it needs no paid run and no eval slot,
   which makes it the one card here anyone can pick up today without waiting on
   another.
3. ~~**Rule once on preconditions-vs-prose**~~ — **done.** ADR-0011 carries the
   classes, the reference implementation and (2026-09-10) the bridge, so a gate
   author who reaches "not decidable from the documents" is now asked whether the
   step can be made to deposit its output before falling through to prose. Theme
   4's third section still bounds what the ruling can promise: no gate can reach
   an agent whose deliverable is a return summary.
4. ~~**Drain `needs-decision`**~~ — **done: 0 open as of 2026-09-10**, from 18.
   The queue refills, and `/make-decisions` is cheap: it converts lead time into
   other people's PRs at the best available ratio.

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
- The board moves: 48 tools now, not 46; 28 skills, not 27; `needs-decision`
  was 19 open when this document was written, 18 at the 09-07 pass, and 0 on
  2026-09-10.
