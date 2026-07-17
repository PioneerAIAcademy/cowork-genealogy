# search-images: the base64 accumulation crash it never got protected from

> **Status:** IN IMPLEMENTATION (2026-07-17), worktree `search-images-accumulation`
> off main (`6829b087`). Surfaced while implementing `docs/plan/image-read-context-policy.md`
> (the record-extraction image boundary). That work established the mechanism and the
> fix for record-extraction; this doc carries the same hazard, unmitigated, in the one
> skill that reads the *most* images.
>
> **Decision (Dallan, 2026-07-17): option A — reuse `image-reader` as-is.** Text-only
> triage confirmed sufficient for browsing. Option B (a targeted "quick look" reader)
> was **rejected on a correctness ground, not just cost**: asking the reader for
> specific information was previously found to *encourage hallucination*, whereas
> `image-reader`'s contract is faithful full-OCR that never slants toward an asked-for
> answer. So A is not merely the cheaper first step — it is the safer design. B is not
> deferred; it is ruled out. §4 is retained below as the record of that reasoning.

## 1. The exposure

`image_read` returns a page scan as inline base64 (`image-read.ts:156-163`, wrapped as
an `{type:"image"}` content block in `index.ts:291`). That block lands in the caller's
conversation and is **re-serialized every turn**, so blobs from successive reads pile
up until one re-serialized message exceeds the transport's ~1 MiB buffer and **crashes
the whole session** — an uncatchable error. This is documented in the tool itself
(`image-read.ts:29-47`) and its spec (`image-read-spec.md:114-121`), with an observed
instance: an e2e run made **17** `image_read` calls (each ≤458 KB raw) and crashed on
the accumulated ~5.4 MB, not on any single image.

The threshold is brutally low. `image-read.ts:44-46`: **two** ~458 KB scans (~610 KB
base64 each) "already sum past the buffer." So the safe ceiling is roughly **one**
image per context.

`search-images` is built to blow straight through that. It declares `image_read` in its
own `allowed-tools` (`SKILL.md:20`) and calls it **directly**, page by page, in its own
context — "### 4. Browse with `image_read`". Its *own* logged example reads
`imagesExamined: "00040-00075"`, `resultsExamined: 36`. Thirty-six direct reads in one
context, against a two-image ceiling. It has **zero** references to the `image-reader`
agent — `git log -S "image-reader"` on its path is empty across all history.

**Net: any substantial browse crashes the session.** Not intermittently — by
construction.

## 2. Why record-extraction is safe and this isn't

The `image-reader` agent (`agents/image-reader.md`) fixes accumulation with two
properties, and a caller only gets them by **delegating**:

1. It reads the image in an **isolated throwaway context**, so the base64 never enters
   the caller's conversation — the caller accumulates only the returned *text*.
2. It reads **exactly one image per invocation**, so even its own context never holds
   more than one blob.

record-extraction delegates every image read to it (`Task` → image-reader) and is
therefore safe on both ends — verified in `docs/plan/image-read-context-policy.md`.
search-images calls the tool directly, gets neither property, and accumulates. Note
this is not fixed by making search-images itself a subagent: isolation alone stops
blobs reaching the *parent*, but search-images reads *many* images in *one* context, so
it self-accumulates and crashes within whatever context it runs in. The
one-image-per-invocation rule is the load-bearing half, and only delegation provides
it.

## 3. Why the obvious lighter fixes don't work

- **Cap reads per context.** The safe cap is ~1 image (§1), which is not "browsing" — a
  volume browse is inherently many pages. A cap that preserves the feature can't be
  safe; a cap that's safe kills the feature.
- **Lower the per-image ceiling** (`MAX_INLINE_IMAGE_BYTES`). The spec is explicit this
  does **not** help: the failure is accumulation across calls, not one oversized
  response (`image-read-spec.md:120`).
- **Downscale images to fit** (so many small blobs stay under the buffer). Needs an
  image-processing dependency in the shipped `.mcpb`; deferred by design
  (`image-read.ts:48-50`, `image-read-spec.md:132`). Not available now.

Delegation is the only fix that both preserves multi-page browsing and is available
today — and the `image-reader` agent was **explicitly designed for this handoff**. Its
description: *"use image_search / volume_search first, then hand this agent the specific
imageId."* That is exactly search-images' flow: `volume_search` → `image_search` →
(hand imageId to image-reader). The agent already accepts search-images' `imageId`
currency (`image-reader.md:31`).

## 4. The one open decision — browse latency

Delegating is settled as the direction. The fork is *how* the reader serves a browse,
because a browse and a transcription want different things from a page:

- **A (reuse image-reader as-is).** Each browsed page → one `image-reader` `Task` call
  → a **full faithful OCR transcription** of the whole page. Safe, available now, reuses
  verified infra, zero new components. Cost: image-reader is told to transcribe *every*
  entry on the page, so a 36-page browse is 36 full OCR passes — slow (dozens of
  sequential subagent calls) and more expensive than a visual glance. It over-serves
  the browse use case, which only needs "is the target plausibly here? what
  record-type/date is this page?"
- **B (a lightweight browse-triage path).** A reader mode/agent that does a *quick* look
  — page description + FOUND/NOT-FOUND for a `looking_for` key — and returns a short
  answer, no full transcription. Faster and cheaper per page, fits browsing. Cost: a new
  agent (or a triage mode on image-reader, whose spec currently forbids shortening the
  transcription), plus its own unit tests and eval calibration.

**Recommendation: ship A now, track B as a follow-up.** A removes the crash using
infra that's already verified, and it's the smaller, safer change. B is a latency/cost
*optimization* of A, not a different safety story — it can land later without redoing
A's work, and only if real browse latency proves painful. This matches "ship the
simplest version first; add complexity after real feedback," while keeping the safety
gate (a session crash is exactly the kind of irreversible failure that shouldn't wait).

The one thing to confirm before coding: whether text-only triage is *enough* for the
browse use case, or whether browsing genuinely needs the visual page (layout, column
position, a stamp) in a way a transcription can't carry. If it does, that pushes toward
B (a triage reader that still describes the visual) or reopens downscaling. My read is
that browse triage is name/date/place matching, which a transcription carries fine —
but this is the genealogists' call.

## 5. Scope of change (option A)

- **`search-images/SKILL.md`** — rewrite "§4 Browse with `image_read`" to delegate per
  page via `@plugin:image-reader`; remove `image_read` from its `allowed-tools`; adopt
  a one-line `**Narration:**`-style note that image reads are delegated (mirror
  record-extraction's §67-73 / :204). Keep the `volume_search` → `image_search` steps.
- **5 unit tests** assert direct `image_read` calls today
  (`browse-unindexed-probate`, `direct-image-group-listing`, `volume-mixed-item-sections`,
  `volume-split-across-films`, `volume-selection-multi-candidate`). Their
  `judge_context` / expectations move from "called image_read with imageId X" to
  "delegated imageId X to image-reader." The image transcription itself stays untestable
  in the mock (same limitation as record-extraction's ut_015).
- **Fixtures** — the browse fixtures currently model `image_read` responses; delegation
  means the reads happen inside the subagent, so the same
  fixture-serves-image-as-JSON-text limitation applies (routing is what's graded, not
  transcription).
- **Eval** — a full `--skill search-images` run + genealogist annotation, since the
  SKILL body and its test JSONs both change (check-runlogs rules 2/3).
- **Interaction with the record-extraction PR's guard.** That PR's per-context hook
  denies `image_read` on the main thread *only for skills that don't declare it*. Once
  search-images stops declaring it (this change), the guard would begin protecting
  search-images too — which is correct and desirable. Sequencing: this can land after
  the record-extraction PR; if it lands first, the guard simply doesn't cover
  search-images yet (status quo). No hard ordering dependency, but note it in whichever
  lands second.

## 6. Resolution

Fixed via **option A** — search-images delegates each page read to `@plugin:image-reader`
(the handoff that agent was built for), and no longer declares or calls `image_read`.
Option B is **ruled out**, not deferred: a targeted triage reader reintroduces the
hallucination failure mode that faithful full-OCR avoids (§4, header). No cap — it
cannot be both safe and a browse.

Implemented in this worktree:
- `search-images/SKILL.md`: §4 rewritten to delegate via `@plugin:image-reader` (once
  per page, text-only triage); `image_read` removed from `allowed-tools`; the "no image
  reading in this context" rule and base64-crash rationale added; description and MCP-tool
  table updated so the skill no longer advertises `image_read` as its own.
- The 5 image-touching unit tests + `rubric.md`: `judge_context`/prose reworded from
  "the skill calls `image_read`" to "the skill delegates to `@plugin:image-reader`
  (direct `image_read` is incorrect; NOT READ in the harness)." The gradeable browse
  (volume → image_search → log) is unchanged — page viewing was already ungradeable in
  the mock, so no *behavioral* assertion moved.
- Validator docstring updated (no validator asserted `image_read`, so no logic changed).

The agent-union in `allowed_tools.py` re-grants `image_read` to the session because the
skill references `@plugin:image-reader`, so the subagent can still call it; the skill
itself no longer does.

**Interaction with the record-extraction PR (#717):** once search-images stops declaring
`image_read`, that PR's per-context guard would begin covering it too — correct and
desirable. No hard ordering dependency (this is off main, which lacks the guard); note it
in whichever lands second.
