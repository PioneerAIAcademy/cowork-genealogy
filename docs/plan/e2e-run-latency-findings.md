# E2E Run Latency — Findings (issue #810)

**Status:** DRAFT — measurement + first lever, for review.
**Scope:** the ~2-hour wall-clock of a single **e2e** research run. Complements
`research-latency-reduction-plan.md` (that plan's baseline was the *record-only*
Kenneth Quass session; it does **not** cover the image-reading path, which this
doc adds). Confirms that plan's headline: **tool/API latency is ~0 — the cost is
model generation and now, in image-heavy runs, the image-reader subagent.**

## 1. Baseline — two Witbeck e2e runs (post-persistence-migration, image-heavy)

Measured from each run's `session.jsonl` (`eval/runlogs/e2e/john-perry-witbeck-vitals/`).

| Bucket | Run 1 `14-34-50` (timeout) | Run 2 `17-13-01` (pass) |
|---|---|---|
| Wall clock | 110.9 min | 116.3 min |
| **Parent model-generation** (thinking/writing between tool calls) | **67.3 min (61%)** | 49.8 min (43%) |
| **Subagent spawns** (`Agent` → image-reader / record-extractor / gps-mentor) | 36.4 min · 32 spawns · avg 68s | **55.9 min · 13 spawns · avg 258s** |
| MCP data tools (record/fulltext/volume/collections search) | ~5 min | ~9 min |

**Two buckets dominate; the record tools are noise.** `record_read`/`record_search`
run ~1s each. Dallan's "shouldn't take 10s of minutes to read a record" is **not**
the record tools — it is the **image-reader OCR subagent** plus parent reasoning.

## 2. The image-reader finding (new — not in the existing plan)

The 258s/spawn average in run 2 is not uniform. Turns-per-image-reader-spawn:

- **Run 2:** `[56, 41, 5, 3, 2, 2, 2, 2, 2, 2, 2]` — **two spawns burned 56 and 41
  assistant turns reading a *single* hard scan each** (an Albany 1774 church
  register); the other nine were 2–5 turns. Those two runaway spawns are most of
  the 55.9 min.
- **Run 1:** `[3,3,3,…,2,2]` — no runaway spawn, but **25** reads (many on a
  deed/probate detour), so volume drove the 36.4 min.

So there are **two distinct image-reader latency modes**:

1. **Runaway re-reads on a hard scan** — one spawn thrashes for dozens of turns.
   `image-reader.md` has **no turn cap and no re-read bound**; on a low-quality scan
   the sonnet reader keeps re-attempting. This is the single biggest tool-latency
   sink in an image-heavy run.
2. **Volume** — the agent pages an entire browse-image volume one scan at a time
   (run 1's deed detour; run 2's 267-image burial register), each a full subagent
   round-trip.

Main's `#850 image-reader-opus` (an opt-in Opus re-read for hard scans) is the right
*escalation target*, but nothing yet **bounds** the sonnet reader or routes a hard
scan to it after a fixed number of attempts — so the reader still thrashes.

## 3. Levers (ranked: leverage × feasibility × risk)

1. **Bound the image-reader re-read (highest leverage, low risk).** Cap the reader:
   OCR once (twice at most); if the scan is still substantially `[illegible]`,
   **escalate to `image-reader-opus` exactly once and stop** — never thrash for
   dozens of turns. Preserves accuracy (opus does the hard read) while cutting the
   56/41-turn runaways to a bounded 2–3 turns + one opus read. Target: the ~40 min
   the two runaway spawns cost run 2.
2. **Don't OCR whole browse volumes page-by-page.** Use the volume TOC / targeted
   `fulltext_search` to jump to the relevant scan instead of reading every image.
   Target: run 1's 25 reads / run 2's 267-image paging.
3. **Parent model-generation** (the other ~50–67 min) — effort/verbosity/turn-count
   tuning. This overlaps `research-latency-reduction-plan.md` Phase 2; defer to it
   rather than duplicate.

## 4. Experiment 1 — bounded image-reader — RESULT

Implemented Lever 1 (`image-reader.md`: one `image_transcribe` call, no re-read
thrash, flag hard scans for caller-driven opus escalation) and re-ran
`john-perry-witbeck-vitals` live.

| Metric | Baseline run 2 `17-13-01` | **Lever 1 run `23-52-08`** |
|---|---|---|
| Verdict | pass | **pass** (recall preserved) |
| Image-reader turns/spawn | **[56, 41, 5, 3, 2×7]** | **[2]** — thrash gone |
| Subagent time | 55.9 min | **11.2 min** (−44.7 min) |
| Wall clock | 116.3 min | **82.2 min** (−29%) |

**Clean, attributable win:** the worst image-reader spawn dropped from **56 turns
to 2**, subagent time collapsed **55.9 → 11.2 min**, verdict stayed pass. Caveat —
n=1 each side and the runs took different research paths (this one read 1 image +
more mentor calls), so the −34 min wall-clock carries single-run noise; the
rock-solid claim is the thrash elimination.

**Not attributable to Lever 1:** a separate `wilkins-death-kentucky` run on this
branch passed 3/3 — but that case had *no thrash* (2 short reads), and its pass is
driven by the #657 fixes now on main, not by this lever. Noted here only to record
that Lever 1 does not *hurt* an already-lean image path (reads stayed [3, 2]).

## 5. References
- `docs/plan/research-latency-reduction-plan.md` — the model-generation plan (Phase 0 re-measure, Phase 1 tool-coverage, Phase 2 behavior tuning).
- `packages/engine/plugin/agents/image-reader.md` / `image-reader-opus.md` (#850).
- Data: `eval/runlogs/e2e/john-perry-witbeck-vitals/run-2026-07-21_{14-34-50,17-13-01}.{json,session.jsonl}`.
