# OCR answer keys — human-verified gold

Answer keys for `dev/try-ocr-compare.ts` / `dev/try-ocr-grade.ts`, used for the
`typed / human` cell of the OCR model comparison. Every file here is a
**human-verified transcription**, not a model's output. That is the whole reason
the cell exists: it is the only place in this benchmark where a model's absolute
score can be trusted, because everywhere else the key is itself an Opus-4.8
transcription.

## Provenance

Source: the `book-to-tree` sibling repo, commit `e7d5c6a` ("Stage 0 OCR pipeline
(Qwen VL via AWS Bedrock) with page-number output"), path
`data/ocr_gold/readable/*.txt`.

`backend/src/book_to_tree/ocr/eval/runner.py:5` at that commit describes
`data/ocr_gold/` as "hand-verified gold canonical output". The `readable/` files
are a `render_readable()` rendering of the canonical gold TSVs; the TSVs
themselves are not recoverable (gitignored, and absent from every commit).

**The gold is not a copy of a model run.** Page 92's gold reads `EUNICE⁶` where
that same commit's Qwen-VL output reads `EUNICE⁵`, and the two differ
structurally elsewhere.

These files were deleted from `book-to-tree` in `ace9132` (2026-05-28) and never
restored, so this directory is the only live copy.

## What was changed on the way in

Two `render_readable` artifacts were stripped, because neither is on the page and
a model could not produce them:

1. The `═══ <ark-stem> ═══` header line — **present on 9 of the 11 files, absent
   on 2** (`holt-059`, `holt-160`). Detected per file, not assumed.
2. The two-space indent applied to every content line.

Nothing else was altered. Printed page numbers and running heads ("HOLT
FAMILY. 79") are genuine page content and are kept.

## The pages

Frederick Holt, *Holt genealogy* — printed, typeset 19th-century book pages.
Slugs are book order from `book-to-tree`'s `backend/data/image-order-ark.tsv`;
each is fetchable as `ark:/61903/3:1:<stem>` (verified 2026-08-30: these resolve
to `image/jpeg` through the same path `try-ocr-compare.ts` uses for record scans).

| slug | ARK | book order | key chars |
|---|---|---|---|
| `holt-004` | `3:1:3Q9M-CSDM-2S31-B` | 4 | 7 |
| `holt-042` | `3:1:3Q9M-CSDM-2S31-F` | 42 | 1965 |
| `holt-045` | `3:1:3Q9M-CSDM-2S31-H` | 45 | 2263 |
| `holt-058` | `3:1:3Q9M-CSDM-2S31-P` | 58 | 2530 |
| `holt-059` | `3:1:3Q9M-CSDM-2S31-V` | 59 | 2184 |
| `holt-069` | `3:1:3Q9M-CSDM-2S31-T` | 69 | 2337 |
| `holt-092` | `3:1:3Q9M-CSDM-2S31-3` | 92 | 1809 |
| `holt-098` | `3:1:3Q9M-CSDM-2S31-D` | 98 | 2189 |
| `holt-160` | `3:1:3Q9M-CSDM-2S32-3` | 160 | 1379 |
| `holt-175` | `3:1:3Q9M-CSDM-2S31-G` | 175 | 1709 |
| `holt-187` | `3:1:3Q9M-CSDM-2S31-9` | 187 | 1816 |

`holt-004` is front matter and its key is 7 characters. It is committed
deliberately rather than hand-excluded: the grader's degenerate-key guard drops
any key under 50 characters, so one rule covers both key sources. Because that
guard is applied **per key source**, a page dropped under either key is dropped
under both — otherwise the two typed cells would be averaged over different page
sets.
