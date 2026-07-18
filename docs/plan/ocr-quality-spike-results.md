# OCR quality spike — Qwen3-VL vs Claude on FamilySearch scans

**Status:** complete (exploratory spike, single run). Per
`~/pioneeradademy/ocr-quality-spike-plan.md`. Not shippable code: no MCP wiring,
no manifest/schema changes. Artifacts live under
`packages/engine/mcp-server/dev/` (`try-ocr-compare.ts`, `try-ocr-grade.ts`,
`ocr_prep.py`) and `dev/ocr-spike-out/` (gitignored scratch — fetched JPEGs are
PII). Total live-API cost: **< $5**.

## TL;DR / recommendation

- **Build `image_transcribe` for the large scans `image_read` refuses today, and
  route them to Qwen3-VL-235B *Instruct* — raw bytes, no prep, no language hint,
  not the Thinking variant.** The decision gate passes: on the hard subset Qwen
  Instruct beats Claude Sonnet 4.6 (the model `image-reader` uses today) on
  field-level accuracy (**69% vs 61%**), with **fewer** hallucinations (13 vs 17),
  at **~8× lower cost** ($0.004 vs $0.036/page) and ~4× lower latency. Against the
  real status quo for these scans — *losing the image entirely* — it is a decisive
  win.
- **Skip pre-processing. Do not add a `jimp` dependency.** Full `enhance_for_ocr`
  *lowered* Qwen's accuracy (69%→59% hard) and **more than doubled** its
  hallucinations (13→27). The shipped tool should base64 the raw bytes.
- **Use Instruct, never Thinking.** Qwen Thinking was the worst reader (47% hard),
  hallucinated 3× as much (36 vs 13), *and* cost 5× more (reasoning tokens bill as
  output).
- **Bonus finding (from the 4-model expansion): Claude Sonnet 5 is a large OCR
  upgrade over Sonnet 4.6 (61%→79% on hard hands) while being cheaper and faster.**
  This is the single biggest accuracy lever in the whole test. Recommend
  **upgrading the `image-reader` / small-image path from Sonnet 4.6 → Sonnet 5**
  independent of the Qwen decision. Net routing: small images → Sonnet 5 (best
  accuracy, keeps Claude's vision in the loop); large images → Qwen Instruct (the
  only viable option, and a genuine win).
- **Routing threshold:** purely mechanical — route to Qwen when the raw scan
  exceeds `image_read`'s inline ceiling (~700 KB / ~1 MB transport limit). No
  quality-based threshold needed; the split is "can Claude physically take the
  bytes," not "which reads better."
- **Privacy path confirmed:** every Qwen call ran with
  `provider:{data_collection:"deny"}` with no loss of availability, cost, or speed.

## The decision this informs

Whether to build `image_transcribe` — route the **large** FamilySearch scans
`image_read` refuses today (the ~700 KB inline cap) to OpenRouter Qwen3-VL instead
of losing the image entirely — and whether small images should also move off
Claude's own vision. At Dallan's direction the roster was widened from the brief's
Claude-vs-Qwen pair to **four models**: Claude Sonnet 4.6, Claude Sonnet 5,
Qwen3-VL-235B Instruct, and Qwen3-VL-235B Thinking.

## Results — field-level accuracy

Field accuracy = (correct + 0.5·partial) / all key entities, across
names/dates/places/relationships. Graded by an Opus judge (text only) against a
Claude Opus 4.8 ground-truth key. Per-image detail: `dev/ocr-spike-out/scorecard.md`.

**Hard subset (7 hands: Dutch 1833, Slovak/Latin 1893, Norwegian 1883, Spanish ×2,
US English ×2)**

| Variant | Field acc | Halluc (total) | Hard-token acc | Avg $ | Avg latency |
|---|--:|--:|--:|--:|--:|
| **Claude Sonnet 5 (raw)** | **79%** | 15 | 44% | $0.031 | 23.8s |
| **Qwen3-VL Instruct (raw)** | **69%** | **13** | 43% | **$0.004** | 10.5s |
| Qwen3-VL Instruct (raw + hint) | 63% | 26 | 36% | $0.003 | 2.7s |
| **Claude Sonnet 4.6 (raw)** — *today's baseline* | 61% | 17 | 35% | $0.036 | 37.7s |
| Qwen3-VL Instruct (enhanced) | 59% | 27 | 48% | $0.003 | 2.3s |
| Qwen3-VL Thinking (enhanced) | 48% | 32 | 13% | $0.028 | 5.0s |
| Qwen3-VL Thinking (raw) | 47% | 36 | 23% | $0.021 | 3.9s |

**Control subset (2 printed-form scans: US census + marriage record)**

| Variant | Field acc | Halluc | Hard-token acc | Avg $ |
|---|--:|--:|--:|--:|
| Claude Sonnet 5 (raw) | 91% | 0 | 47% | $0.037 |
| Qwen3-VL Instruct (raw) | 89% | 0 | 75% | $0.005 |
| Claude Sonnet 4.6 (raw) | 85% | 2 | 43% | $0.043 |
| Qwen3-VL Instruct (enhanced) | 83% | 0 | 38% | $0.004 |
| Qwen3-VL Instruct (raw + hint) | 83% | 0 | 53% | $0.003 |
| Qwen3-VL Thinking (raw) | 80% | 2 | 50% | $0.026 |
| Qwen3-VL Thinking (enhanced) | 77% | 5 | 38% | $0.030 |

### What the numbers say

1. **Gate passes for Qwen Instruct (raw).** It matches/beats Sonnet 4.6 on
   accuracy, hallucinations, *and* cost on the hard subset — the exact three
   conditions the brief set. Everyone clears the control floor (77–97%), so no
   variant is disqualified.
2. **Sonnet 5 ≫ Sonnet 4.6 for handwriting.** +18 points on hard hands, and it's
   cheaper (intro pricing + fewer output tokens) *and* faster (23.8s vs 37.7s).
   The biggest lever in the test isn't Claude-vs-Qwen — it's Sonnet 4.6→5.
3. **Prep hurts.** Enhanced Qwen lost 10 points (69→59) and doubled hallucinations
   (13→27). Sharpening nudged raw *hard-token* accuracy up a little (43→48%), but
   it degraded everything else and invented more — net negative. It also *enlarged*
   several payloads (grayscale+sharpen+q95 > the original JPEG compression). No
   reason to ship a prep pipeline.
4. **Thinking hurts.** Qwen Thinking was the worst reader, hallucinated the most,
   truncated/under-transcribed (one cell came back empty), and cost 5× Instruct.
5. **Language hint is net-negative.** It helped marginally on two hands
   (jan-gallo, birkeland) but hurt on most and roughly doubled hallucinations
   (reese hit 12 fabrications with the hint). Not worth defaulting on.
6. **The shared failure mode is surnames / hard tokens.** Every model — including
   the Opus key — reads structure, dates, relationships, and common given names
   well, and concentrates its errors in surnames, patronymics, and unusual place
   names (hard-token accuracy only 35–48% for the best models). A wrong surname is
   genealogically worse than a wrong date, so this is the real ceiling — and it is
   *not* solved by any model here. Qwen's value is that it is *no worse than Sonnet
   4.6* at this, for a tenth of the cost.

## Cost & latency

Qwen Instruct is ~8–12× cheaper and ~4× faster than Claude per page (e.g. hard
subset $0.004 / 10.5s vs Sonnet 4.6 $0.036 / 37.7s). Qwen Thinking erases most of
the cost advantage (reasoning tokens bill as output: $0.021–0.028) while lowering
accuracy — another reason to avoid it. Sonnet 5 is both cheaper and faster than
Sonnet 4.6, so the small-image upgrade has no cost downside.

## Validity caveats

- **Opus-key home-field advantage.** Opus and the Sonnet variants share a model
  family, so the Opus key may perceptually agree with Sonnet more than with Qwen.
  The judge sees text only, so the bias sits in the *key*, not the scoring. Read
  the results asymmetrically: Qwen **beating Sonnet 4.6** despite this handicap is
  a **robust** result; Sonnet 5's **lead over Qwen** (79 vs 69) is an **upper
  bound** — the true gap is probably smaller. This strengthens the Qwen-for-large
  case and tempers any "Claude is far better" claim.
- **Agreement, not verified truth.** Scores are agreement with an Opus
  transcription, which itself misreads the same hard surnames. These are valid
  *relative* comparisons for the decision, not absolute quality guarantees. Dallan
  confirmed Opus is the best HWR model he has found, so it is the accepted key.
- **Single run**, n=7 hard / n=2 control. One image (bottemiller `_00001`) was a
  mis-picked DGS cover/target sheet — every model correctly read the film number
  "565714", no genealogical content — and was excluded. One Qwen-Thinking cell
  errored empty.
- **Corpus gaps (the important open item).** No German Kurrent/Fraktur — the exact
  18th–19th-c. German church hands the whole bet is framed around — and no clean
  typeset control. We tested Dutch/Slovak/Norwegian/Spanish/English instead. The
  German result is genuinely untested.

## Method (reproducibility)

Two `tsx` dev scripts reuse the repo's FamilySearch auth (`getValidToken`) and
ARK resolution, minus `image_read`'s 700 KB cap:

- `dev/try-ocr-compare.ts` — fetches each scan, generates the enhanced variant via
  `dev/ocr_prep.py` (PIL `enhance_for_ocr`: grayscale + autocontrast cutoff 2 +
  unsharp + JPEG q95, longest side capped 2000 px, upscaling off), runs every
  variant with an **identical faithful-OCR prompt** (from the `image-reader`
  protocol), and records text, latency, tokens, cost. Both Claude variants and the
  Opus key run **thinking disabled** with the strict "mark `[illegible]`, never
  guess" prompt; the Qwen Thinking variants cover the thinking axis.
- `dev/try-ocr-grade.ts` — Opus judge scores each variant against the key at field
  level, aggregates against the gate, writes `scorecard.md`. Re-runnable without
  re-transcribing.

Corpus: 10 T13-failing scans from the birk/cruz/zuniga/bottem/… e2e transcripts
(theme T13 in `record-extraction-consolidation-closing-report.md` §1) — the exact
large scans `image_read` refuses. Variants A1/A2 (Sonnet 4.6/5, raw), B/C (Qwen
Instruct raw/enhanced), B/C (Qwen Thinking raw/enhanced), H (Instruct + per-image
language hint), plus the Opus 4.8 ground-truth key.

## Next steps (contingent)

1. **Run a German Kurrent/Fraktur pass before final sign-off** — the headline
   domain is the one thing this spike didn't test. Dallan to supply a few German
   church-register imageIds/ARKs; the scripts take them via `--only` after adding
   rows to the `IMAGES` list.
2. **If building `image_transcribe`:** Qwen3-VL-235B Instruct, raw bytes,
   `provider:{data_collection:"deny"}`, no prep, no hint, no thinking; per the
   OpenRouter request shape in the tool spec §6.
3. **Independently, upgrade `image-reader` (small-image path) Sonnet 4.6 → Sonnet
   5** — biggest accuracy lever, cheaper and faster. This is a one-line frontmatter
   change gated by the eval suite, separate from the Qwen work.
4. **(Optional) Add a cheap third-party OCR datapoint** (Gemini/Mistral via
   OpenRouter) if the small-image cost question resurfaces — Qwen already validated
   as a cheaper-than-Sonnet-4.6 fallback for small images if needed.
