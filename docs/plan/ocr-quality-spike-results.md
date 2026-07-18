# OCR quality spike — Qwen3-VL vs Claude on FamilySearch scans

**Status:** complete (exploratory spike, single run). Per
`~/pioneeradademy/ocr-quality-spike-plan.md`. Not shippable code: no MCP wiring,
no manifest/schema changes. Artifacts live under
`packages/engine/mcp-server/dev/` (`try-ocr-compare.ts`, `try-ocr-grade.ts`,
`ocr_prep.py`) and `dev/ocr-spike-out/` (gitignored scratch — fetched JPEGs are
PII). Total live-API cost: **< $6**.

## TL;DR / recommendation

- **Build `image_transcribe` for the large scans `image_read` refuses today, and
  route them to Qwen3-VL-235B *Instruct* — raw bytes, no prep, no language hint,
  not the Thinking variant.** The decision gate passes: on the hard subset Qwen
  Instruct beats Claude Sonnet 4.6 (the model `image-reader` uses today) on
  field-level accuracy (**67% vs 60%**), with **fewer** hallucinations (19 vs 21),
  at **~8× lower cost** ($0.004 vs $0.034/page) and ~4× lower latency. Against the
  real status quo for these scans — *losing the image entirely* — it is a decisive
  win.
- **German Kurrent (the headline domain) is now tested — and it changes nothing
  about the recommendation, if anything it strengthens it.** On the one German
  baptism register, *every* model is weak (33–52%) and the top three cluster
  tightly: Sonnet 5 52%, Sonnet 4.6 51%, **Qwen Instruct 48%**. On the exact hand
  the bet was framed around, Qwen comes within ~3–4 points of both Sonnet models at
  a tenth of the cost.
- **Skip pre-processing. Do not add a `jimp` dependency.** Full `enhance_for_ocr`
  *lowered* Qwen's accuracy (67%→56% hard) and **nearly doubled** its
  hallucinations (19→34). The shipped tool should base64 the raw bytes.
- **Use Instruct, never Thinking.** Qwen Thinking was the worst reader (46% hard),
  hallucinated ~2× as much (41–42 vs 19), *and* cost ~6× more (reasoning tokens
  bill as output).
- **Bonus (from the 4-model expansion): Claude Sonnet 5 is a large OCR upgrade over
  Sonnet 4.6 (60%→76% on hard hands) while cheaper and faster.** Biggest accuracy
  lever in the test. Recommend **upgrading the `image-reader` / small-image path
  Sonnet 4.6 → Sonnet 5** independent of the Qwen decision. Net routing: small
  images → Sonnet 5 (best accuracy, keeps Claude's vision in the loop); large
  images → Qwen Instruct (the only viable option, and a genuine win).
- **Routing threshold:** purely mechanical — route to Qwen when the raw scan
  exceeds `image_read`'s inline ceiling (~700 KB / ~1 MB transport limit). No
  quality-based threshold needed.
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

**Hard subset (8 hands: German Kurrent 1854, Dutch 1833, Slovak/Latin 1893,
Norwegian 1883, Spanish ×2, US English ×2)**

| Variant | Field acc | Halluc (total) | Hard-token acc | Avg $ | Avg latency |
|---|--:|--:|--:|--:|--:|
| **Claude Sonnet 5 (raw)** | **76%** | 21 | 44% | $0.030 | 23.2s |
| **Qwen3-VL Instruct (raw)** | **67%** | **19** | 38% | **$0.004** | 9.6s |
| Qwen3-VL Instruct (raw + hint) | 60% | 32 | 32% | $0.003 | 2.8s |
| **Claude Sonnet 4.6 (raw)** — *today's baseline* | 60% | 21 | 35% | $0.034 | 36.4s |
| Qwen3-VL Instruct (enhanced) | 56% | 34 | 48% | $0.003 | 2.1s |
| Qwen3-VL Thinking (raw) | 46% | 42 | 21% | $0.022 | 4.4s |
| Qwen3-VL Thinking (enhanced) | 46% | 41 | 13% | $0.026 | 4.6s |

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
   conditions the brief set. Everyone clears the control floor (77–91%), so no
   variant is disqualified.
2. **German Kurrent is the great equalizer.** All models land 33–52% on it — the
   hardest hand in the set — and the top three (Sonnet 5 52%, Sonnet 4.6 51%, Qwen
   Instruct 48%) are within a rounding error of each other. Where the *hand* is the
   binding constraint, the *model* barely matters; the cost/latency gap does. That
   is the strongest possible argument for Qwen on large German scans: the
   alternative isn't Sonnet, it's nothing.
3. **Sonnet 5 ≫ Sonnet 4.6 for handwriting.** +16 points on hard hands, and it's
   cheaper (intro pricing + fewer output tokens) *and* faster (23.2s vs 36.4s). The
   biggest lever in the test isn't Claude-vs-Qwen — it's Sonnet 4.6→5.
4. **Prep hurts.** Enhanced Qwen lost 11 points (67→56) and nearly doubled
   hallucinations (19→34). Sharpening nudged raw *hard-token* accuracy up a little
   (38→48%), but it degraded everything else and invented more — net negative. It
   also *enlarged* several payloads (grayscale+sharpen+q95 > the original JPEG
   compression). No reason to ship a prep pipeline.
5. **Thinking hurts.** Qwen Thinking was the worst reader, hallucinated the most,
   truncated/under-transcribed (one cell came back empty), and cost ~6× Instruct.
6. **Language hint is net-negative.** It helped marginally on two hands
   (jan-gallo, birkeland) but hurt on most and roughly doubled hallucinations
   (reese hit 12 fabrications with the hint). Not worth defaulting on.
7. **The shared failure mode is surnames / hard tokens.** Every model — including
   the Opus key — reads structure, dates, relationships, and common given names
   well, and concentrates its errors in surnames, patronymics, and unusual place
   names (hard-token accuracy only 35–48% for the best models). A wrong surname is
   genealogically worse than a wrong date, so this is the real ceiling — and it is
   *not* solved by any model here. Qwen's value is that it is *no worse than Sonnet
   4.6* at this, for a tenth of the cost.

### Sonnet 5 vs Qwen Instruct (head-to-head)

The two live-recommendation models, compared directly. **Bottom line:** Sonnet 5
reads more accurately — especially on the mid-hard hands — while Qwen Instruct is
*competitive* (ties on Spanish, German, and printed forms; no more hallucination)
at ~8× lower cost and ~2× lower latency. Sonnet 5's accuracy lead is an **upper
bound**: it shares a model family with the Opus answer key, so the true gap is
smaller than shown.

| Metric | Claude Sonnet 5 | Qwen Instruct (raw) | Edge |
|---|--:|--:|:--|
| Field acc — hard subset | **76%** | 67% | Sonnet 5 (+9, inflated by key bias) |
| Field acc — controls | 91% | 89% | ~tie |
| Hallucinations (hard, total) | 21 | **19** | ~tie (Qwen slightly fewer) |
| Hard-token acc — hard | 44% | 38% | Sonnet 5 |
| Hard-token acc — controls | 47% | **75%** | **Qwen** (nailed printed surnames/initials) |
| Cost / page | $0.030 | **$0.004** | **Qwen (~8×)** |
| Latency / page | 23.2s | **9.6s** | Qwen (but high variance: 0.4–51s) |

Per-image field accuracy (Sonnet 5 wins or ties **every** image; the gap widens on
mid-hard hands and collapses on the hardest — German — and on Spanish/printed):

| Hand | Sonnet 5 | Qwen Instruct |
|---|--:|--:|
| German Kurrent 1854 (baptism) | 52% | 48% *(~tie — the headline hand)* |
| Dutch 1833 (teitje) | **75%** | 48% |
| Norwegian 1883 (birkeland) | **66%** | 54% |
| Ohio English 1820s (geach) | **84%** | 70% |
| Mexican Spanish ~1910 (cruz) | **91%** | 81% |
| NY English (reese) | **86%** | 80% |
| Bolivian Spanish 1913 (zuniga) | 89% | 86% *(~tie)* |
| Slovak/Latin 1893 (jan-gallo) | 66% | 65% *(tie)* |
| US census (spriggs) | **97%** | 96% *(~tie)* |
| US marriage (rossi) | **85%** | 81% |

The two share the same failure mode and ceiling (surnames/hard tokens); neither
"solves" hard hands, and **on the very hardest (German Kurrent) they converge**.
Sonnet 5's extra points come partly from *confidently committing* readings on
illegible fields — right more often, but the one behavior that risks confident
error; Qwen makes transliteration-style surname slips (Zuza→Luza, van Lier→van der
Lier) while getting structure/dates/relationships right. **This is why the two map
to different routes, not a single winner:** use Sonnet 5 where Claude's vision is
already in the loop (small images — best accuracy, and cheaper+faster than the
Sonnet 4.6 there today); use Qwen Instruct for the large scans Claude physically
can't take, where the alternative isn't Sonnet 5, it's losing the page — and Qwen
still beats Sonnet 4.6 at a tenth the cost.

## Cost & latency

Qwen Instruct is ~8–12× cheaper and ~4× faster than Claude per page (e.g. hard
subset $0.004 / 9.6s vs Sonnet 4.6 $0.034 / 36.4s). Qwen Thinking erases most of
the cost advantage (reasoning tokens bill as output: $0.022–0.026) while lowering
accuracy — another reason to avoid it. Sonnet 5 is both cheaper and faster than
Sonnet 4.6, so the small-image upgrade has no cost downside.

## Validity caveats

- **Opus-key home-field advantage.** Opus and the Sonnet variants share a model
  family, so the Opus key may perceptually agree with Sonnet more than with Qwen.
  The judge sees text only, so the bias sits in the *key*, not the scoring. Read
  the results asymmetrically: Qwen **beating Sonnet 4.6** despite this handicap is
  a **robust** result; Sonnet 5's **lead over Qwen** (76 vs 67) is an **upper
  bound** — the true gap is probably smaller. Dallan confirmed Opus is the best HWR
  model he has found, so it is the accepted key.
- **Agreement, not verified truth.** Scores are agreement with an Opus
  transcription, which itself misreads the same hard surnames. These are valid
  *relative* comparisons for the decision, not absolute quality guarantees. (Even
  the "76%" and "52%" numbers are agreement rates, not letter-accuracy.)
- **Single run**, n=8 hard / n=2 control. One image (bottemiller `_00001`) was a
  mis-picked DGS cover/target sheet — every model correctly read the film number
  "565714", no genealogical content — and was excluded. One Qwen-Thinking cell
  errored empty.
- **Remaining corpus gap:** no clean typeset control (T13 is oversize hard scans;
  the "controls" are printed-form census/marriage, printed structure + handwritten
  data). The **German Kurrent/Fraktur gap is now closed** — one register, added
  post-hoc — though a single German page is thin; a few more would firm it up.

## Method (reproducibility)

Two `tsx` dev scripts reuse the repo's FamilySearch auth (`getValidToken`) and ARK
resolution, minus `image_read`'s 700 KB cap:

- `dev/try-ocr-compare.ts` — fetches each scan **by ARK/imageId** (nothing binary
  committed — the corpus is repeatable from FS, and PII stays out of the repo),
  generates the enhanced variant via `dev/ocr_prep.py` (PIL `enhance_for_ocr`:
  grayscale + autocontrast cutoff 2 + unsharp + JPEG q95, longest side capped
  2000 px, upscaling off), runs every variant with an **identical faithful-OCR
  prompt** (from the `image-reader` protocol), and records text, latency, tokens,
  cost. Both Claude variants and the Opus key run **thinking disabled** with the
  strict "mark `[illegible]`, never guess" prompt; the Qwen Thinking variants cover
  the thinking axis. Runs merge into `results.json`/`grades.json`, so a
  `--only <slug>` pass adds one image without re-transcribing the rest.
- `dev/try-ocr-grade.ts` — Opus judge scores each variant against the key at field
  level, aggregates against the gate, writes `scorecard.md`.

Corpus: 10 T13-failing scans from the birk/cruz/zuniga/bottem/… e2e transcripts
(theme T13 in `record-extraction-consolidation-closing-report.md` §1) — the exact
large scans `image_read` refuses — **plus one German Kurrent baptism register**
(1854 Taufregister, FS ARK `3:1:3Q9M-CSQR-S57W`, added to cover the headline
domain). 11 fetched, 10 graded (8 hard + 2 control; bottemiller excluded).
Variants A1/A2 (Sonnet 4.6/5, raw), B/C (Qwen Instruct raw/enhanced), B/C (Qwen
Thinking raw/enhanced), H (Instruct + per-image language hint), plus the Opus 4.8
ground-truth key.

## Next steps (contingent)

1. **If building `image_transcribe`:** Qwen3-VL-235B Instruct, raw bytes,
   `provider:{data_collection:"deny"}`, no prep, no hint, no thinking; per the
   OpenRouter request shape in the tool spec §6.
2. **Independently, upgrade `image-reader` (small-image path) Sonnet 4.6 → Sonnet
   5** — biggest accuracy lever, cheaper and faster. One-line frontmatter change
   gated by the eval suite, separate from the Qwen work.
3. **(Optional) Firm up the German result** — one register is thin for the domain
   the whole bet rests on; a few more German Kurrent pages would tighten the
   confidence interval before final sign-off.
4. **(Optional) Add a cheap third-party OCR datapoint** (Gemini/Mistral via
   OpenRouter) if the small-image cost question resurfaces.
