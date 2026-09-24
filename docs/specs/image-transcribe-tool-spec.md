# Specification: `image_transcribe` tool (host-side VLM OCR)

> **Status: Phase 0 PASSED — build approved (spike PR 723).** This spec was
> research-gated: **Phase 0 (§4)** had to clear a quality gate before the
> **§5–§11** build contract could proceed. It did (see the revision note
> below), so the build is unblocked and the §12 fallback is not triggered.
> §4 is retained as the record of the experiment that was run.
>
> Owner: unassigned. Review against this spec once implemented.
>
> **Revision (2026-08-30) — the default OCR model is now
> `google/gemini-3.7-flash`, replacing Qwen3-VL.** A three-way comparison
> (Qwen / Gemini 3.7 Flash / Opus 5) over 9 handwritten pages graded against an
> Opus-4.8 key and 10 printed pages graded against hand-verified human gold
> found Qwen at **50%** field accuracy with **37** hallucinations against
> Gemini's **79%** and **8**. Gemini reads better on **every** handwritten page
> in the corpus, by 10 to 47 points. Qwen's failures are fabrications in
> identity-critical fields — invented surnames, `Norg` read as `Storq`,
> `Langeloe` as `Dwingeloo`, and on one page a birth register transcribed as a
> death record in the wrong town. Cost rises from $0.0023 to $0.0146 per page
> ($0.09 → $0.58 per 40-transcribe research run) and latency from 2.3s to 4.0s,
> both far inside the §5.7 budget and the 60s device-bridge abort. Opus 5 scores
> higher still (87%) at $0.1418/page, but see the caveat under §4.5 — that
> ranking is not settled. Typed pages saturate at 100% for all three and
> discriminate nothing.
>
> **Revision (2026-07-17) — three changes from the original draft, per a
> design review:**
> 1. **Single-model reader.** The `image-reader` subagent OCRs **every** image
>    via `image_transcribe` (one hosted VLM — cheap, fast, any size, text out).
>    That is the sole runtime reader. (Design history: a "Sonnet for small,
>    Qwen for large" split, then a Qwen-first path with an opt-in Sonnet-5
>    reconciling *second opinion*, were both tried and **dropped** — the second
>    opinion was rarely used, and the viewer (item 2) lets a human verify a
>    cite-worthy read against the actual scan, a better check than a second
>    machine read. A user-invoked **Opus** transcription is parked in
>    §15.9, separate from this single-model workflow.) `image_read`'s
>    inline path is unused by the agent (kept only for the Issue #28 eval).
> 2. **Image persistence + viewing (§8.5).** The backing JPEG is saved for
>    **retained** sources so the Electron viewer (then the hosted web
>    viewer) can show the scan beside its transcription.
> 3. **Key handling stays config-only (§6.4–§6.5)** — the MCP server reads
>    the key only from `~/.familysearch-mcp/config.json`, never from env —
>    with two orchestration-layer bridges added for e2e and the hosted
>    sandbox.
>
> **Phase 0 is COMPLETE — spike PR 723.**
> The gate passed: build the tool and route large scans to a hosted VLM on
> **raw bytes — no pre-processing** (prep *lowered* accuracy and doubled
> hallucinations, so §7's `jimp` path is dropped, not built). That part stands.
>
> **The model Phase 0 chose does not.** Phase 0 picked Qwen3-VL-235B Instruct
> and recorded Sonnet 5 76% / Qwen 67% / Sonnet 4.6 60% on German
> Kurrent/Fraktur, concluding German was "no longer an open item". The
> 2026-08-30 three-way run measured Qwen at **41%** on German Kurrent — those
> three figures are superseded, German is an open item again, and the default is
> now Gemini 3.7 Flash. Phase 0's error was its answer key: it compared models
> only against another model's transcription, on a corpus with no
> human-verified page.

---

## 1. Problem this solves

`image_read` returns a FamilySearch page scan as an inline base64 image
block over the MCP stdio transport. That transport has a hard **~1 MiB
(1,048,576-byte) per-message buffer** on the client side (Cowork/Desktop
reading the server's stdout), which we cannot raise. Base64 inflates the
JPEG ~33%, so `image_read` hard-**refuses** any scan whose raw bytes exceed
`MAX_INLINE_IMAGE_BYTES` (700 KB) rather than crash the session.

The closing report's **theme T13**
(`docs/record-extraction-consolidation-closing-report.md` §1) is the
evidence this refuse now blocks real work: the image-escalation *behavior*
is fixed, but the 700 KB floor **failed 7+ read attempts across 4 of the 5
re-run scenarios** (birk, cruz, zuniga, bottem) — large FamilySearch record
images overflow the cap and the read errors out, blocking OCR/transcription
entirely. Distinct issues (do **not** conflate):

- *"image_read callable by the main session"* — tool-policy (who may call
  it), not response shaping.
- *"Oversize search-tool results"* — scoped to `external_links_search` /
  `fulltext_search` text dumps, not images.

### The insight

record-extraction never wanted *pixels* — it wanted a **transcription**.
The `image-reader` subagent already exists solely to absorb the base64 in a
throwaway context and return **text only** (spec:
`docs/specs/image-reader-agent-spec.md`).

If OCR runs **on the host** (where the MCP server has full network access)
and the tool returns **text**, the image never traverses the MCP transport
at all. That dissolves the entire T13 problem class at once:

- No 1 MiB frame limit (the response is a short transcription string).
- No base64 accumulation across reads (the crash the `image-reader`
  subagent was built to prevent — see its spec §1).
- No 700 KB single-image floor.

For the **large** scans `image_read` refuses today, this is a clean win — and
the spike (§4) showed a hosted VLM is a strong-enough reader that it became the
**only reader for every image**, not just the large ones: the `image-reader`
subagent OCRs via `image_transcribe` for every scan and never reads inline. The
subagent is not retired, but its base64-isolation job is now moot (the tool
returns text) — it remains as the delegation seam + one-image-per-source
boundary.

This spec proposes a new tool, **`image_transcribe`**, that fetches the FS
scan host-side and sends the raw bytes to a vision-language model (VLM)
hosted on **OpenRouter** (default **Gemini 3.7 Flash**), returning a
faithful text transcription.

## 2. The bet (why Phase 0 exists)

Moving OCR off the caller's model (Claude Sonnet vision, via the current
`image-reader` subagent) onto a cheap hosted VLM is a **quality bet on a brutal
domain**: 18th–19th-century German church-register hands (Kurrent /
Fraktur), faint ink, uneven exposure. The pre-spike `image-reader` spec
flagged "quality on faint German script is the constraint to watch" — which
the spike then measured (see the banner / §4.4).

The upsides are real and worth chasing — no transport cap, materially
cheaper per image than Claude vision, and the main model is freed — **but
they only cash in if the reader holds recall on *this* corpus.** That was an
empirical question, and Phase 0 answered it for Qwen (PR 723): Qwen Instruct
cleared the bar on the hard subset, so the tool was built.

**That answer did not survive a better instrument.** Phase 0 also recorded
Sonnet 5 76% / Qwen 67% / Sonnet 4.6 60% on German Kurrent/Fraktur and called
German closed. The 2026-08-30 three-way run — the first here with any
human-verified key — put Qwen at 41% on German Kurrent and 50% across the
handwritten corpus, fabricating identity-critical fields rather than marking
them illegible. **The bet still pays, but on Gemini 3.7 Flash, not Qwen**, and
the constraint the pre-spike spec named is still the live one.

## 3. Non-goals

- Not replacing `image_read`'s raw-image return for consumers that genuinely
  need the *pixels* (e.g. Issue #28's OCR-model comparison). `image_read`
  stays (§8).
- Not a native-vision reader. The `image-reader` subagent OCRs every scan via
  `image_transcribe` and does **not** use Claude's own vision. A
  VLM-first path with an opt-in Sonnet-5 reconciling second opinion was tried
  and dropped (§1); `image_read` the tool is kept only for the Issue #28 eval
  (§8), not as a workflow reader.
- Not a general document-understanding tool. It transcribes one page and
  returns text; matching the page to the research objective stays with the
  caller (record-extraction), exactly as the `image-reader` subagent
  contract requires today.
- Not batching / multi-image in v1 (one image per call; see §10 open q.).

---

## 4. Phase 0 — research & validation (record of the experiment that ran)

> **This section is the historical protocol; the gate has since PASSED
> (PR 723). It is kept as the record of what was run.** See the top banner
> and §4.4 for the outcome — the imperatives below describe how the spike
> was conducted, not pending work.

**Goal:** decide, on evidence, (a) whether Qwen-VL on OpenRouter matches or
beats the current Claude-Sonnet path on the actual hard corpus, and (b)
whether image pre-processing helps enough to be worth a dependency.

### 4.1 Corpus

Assemble **8–12 real FamilySearch `dist.jpg` scans**, deliberately weighted
to the hard cases:

- The specific scans that **failed under T13** — pull the imageIds/ARKs from
  the birk / cruz / zuniga / bottem run transcripts referenced in the
  closing report. These are the ground truth for "did we fix T13."
- A spread of difficulty: faint German Kurrent/Fraktur handwriting (the
  worst case), printed civil-registration forms, low-contrast/faded pages,
  and 2–3 clean printed pages as **controls** (a model that fails the
  controls is disqualified regardless).
- Include at least one image comfortably **over 700 KB raw** (the exact
  shape `image_read` refuses today).

For each scan, a genealogist establishes a **ground-truth transcription** of
every genealogically relevant entry (names, dates, places, relationships,
sponsors/witnesses). This is the answer key; keep it blind from the models.

### 4.2 Variants to compare

| Variant | Model | Pre-processing |
|---|---|---|
| **A1 (baseline)** | Claude Sonnet 4.6 vision (the `image-reader` path at spike time) | none |
| **A2** | Claude Sonnet 5 vision (added during the spike at Dallan's direction) | none |
| **B** | Qwen-VL on OpenRouter | none (raw `dist.jpg`) |
| **C** | Qwen-VL on OpenRouter | full `image_prep.py` (grayscale + autocontrast cutoff=2 + unsharp + JPEG q95) |
| **D** | Qwen-VL on OpenRouter | ablations (only if C≠B) |

The prep pipeline prototyped from
`~/pioneeracademy/book-to-tree/backend/src/book_to_tree/ocr/image_prep.py`
(`enhance_for_ocr`) was generated with that **existing Python** (PIL); the JS
port was **not** built — §7 records the decision against prep.

Use the **same faithful-OCR prompt** for A/B/C/D so the comparison isolates
model+prep, not prompt. Reuse the `image-reader.md` protocol verbatim
(faithful OCR, transcribe the whole page not just the target, `[?]` /
`[illegible]` / `[torn]`, original spelling & language, never slant toward an
expected answer).

### 4.3 Metrics

Grade at the **field level on genealogically relevant entities**, not raw
character-error-rate over the whole page — what matters is whether the facts
that become assertions are correct.

- Per entity (name / date / place / relationship): **correct / partial /
  wrong / missed**.
- **Hallucination count** — invented entries or fields with no basis on the
  page. This is weighted heavily: a fabricated reading is worse than a miss
  (same principle as the `image-reader` NOT-READ discipline).
- Hard-token reading: patronymics, place names, unusual surnames.
- **Cost**: tokens and $ per image, per variant.
- **Latency** per image.

### 4.4 Decision gate

Implement §5–§11 **only if** the best Qwen variant:

1. **matches or beats** Variant A on field-level accuracy on the *hard
   subset* (not just the controls), **and**
2. has a **hallucination rate no worse** than A, **and**
3. is **materially cheaper** per image (the economic reason to switch).

Secondary decisions the experiment also settles:

- **Does prep help? — RESOLVED: no (PR 723).** The full `enhance_for_ocr`
  pipeline *lowered* Qwen's hard-subset accuracy (69%→59%) and more than
  doubled hallucinations (13→27). The tool base64s the raw bytes; **no `jimp`
  dependency** — the prep path in §7 is dropped.
- **Partial win? — RESOLVED (PR 723).** Qwen is strong enough to be the
  **only** reader for all images — it beats the old Sonnet-4.6 default on
  every hard hand, including German. Sonnet 5 reads ~9 pts more accurately on
  hard hands but at ~10× cost/latency; an opt-in Sonnet-5 reconciling second
  opinion was considered and **dropped** (§1) — the viewer lets a human verify
  a cite-worthy read against the actual scan, so Qwen is the sole reader.

Record the outcome (corpus, per-image grades, decision) as a short results
doc under `docs/plan/` so the choice is auditable, per the team-review-docs
convention.

### 4.5 Re-measurement (2026-08-30) — the default moved to Gemini 3.7 Flash

Phase 0 compared models only against another model's transcription, on a
corpus with no human-verified page. A three-way run rebuilt that instrument:
`dev/try-ocr-compare.ts` + `dev/try-ocr-grade.ts`, 9 handwritten pages graded
against an Opus-4.8 key and 10 printed pages graded against **hand-verified
human gold** (`dev/ocr-keys/`, recovered from the `book-to-tree` sibling repo).

Handwritten pages (Opus-4.8 key):

| model | field acc | hallucinations | $/page | latency | calls over 60s |
|---|--:|--:|--:|--:|--:|
| Qwen3-VL (the Phase 0 pick) | 50% | 37 | $0.0023 | 2.3s | 0 |
| Gemini 3.7 Flash | 79% | 8 | $0.0146 | 4.0s | 0 |
| Opus 5 | 87% | 4 | $0.1418 | 4.4s | 0 |

Printed pages scored 100% for all three against the human gold and
discriminate nothing — typed material is solved. Gemini beats Qwen on **every**
handwritten page, by 10 to 47 points. Per 40-transcribe research run: Qwen
$0.09, Gemini $0.58, Opus $5.67.

Two findings outrank the table:

- **`[illegible]` marker density cannot be an escalation trigger.** It is
  high-precision, low-recall: Qwen emitted 60 markers on the one page it knew
  it had failed and 0–2 on the other eight, while scoring 41% with 6
  fabrications on a zero-marker page. It fires when the model knows it failed
  and is blind when it does not — which is the case that corrupts a tree. Any
  future escalation rule needs a different signal. `image-reader-opus` was
  retired here rather than kept as an unreachable escalation target.
- **The Gemini-vs-Opus ordering is NOT settled.** On the single page with
  non-model truth available (a record index), Gemini recovers 5 of 5 indexed
  facts to Opus's 4 of 5, while the judge scores Opus higher — because the
  answer key is an Opus-4.8 transcription that shares Opus's caution, marking
  a birthplace illegible where Gemini reads it correctly. Read every
  Opus-vs-Gemini number above with that in mind. Settling it needs 3–5
  handwritten pages with human ground truth, which is genealogist
  adjudication, not another model run.

The switch to Gemini does not rest on the unsettled half: Qwen loses to Gemini
on every page, under a key that flatters neither.

### 4.6 `image-reader-opus` is retired, and no auto-escalation replaces it

The plan of record was to keep Qwen and add an in-tool escalation to a better
model, triggered by `[illegible]` density, deleting `image-reader-opus` once that
worked. **The escalation is deliberately not built.** Raising the floor replaced
it:

- **The trigger does not work.** Marker density is high-precision and low-recall
  (§4.5). It cannot see the fabrication class, which is the one that writes a
  wrong parent into a tree, so an escalation built on it would have advertised a
  safety property it does not have.
- **There is much less to escalate from.** The escalation existed to rescue
  Qwen's 50%. Gemini reads at 79% on the same pages and hallucinates 8 times
  against 37.
- **The escalation target was unreachable anyway.** `image-reader-opus` read
  through `image_read`, which refuses scans over 700 KB — 80% of a 15-ARK sample
  of our own corpus — and it had to be invoked by prose that fired zero times on
  a page carrying 165 `[illegible]` markers.

So `packages/engine/plugin/agents/image-reader-opus.md` and its spec are deleted,
along with the `HARD SCAN —` prefix instruction and both callers' escalation
offers. `image_read` the **tool** stays for the Issue #28 pixel consumer, and
stays in the harness's `SUBAGENT_ONLY_TOOLS` main-thread deny: no agent declares
it now, but the deny is what keeps inline base64 off the main thread, and that
hazard is unchanged by the agent's removal.

**What this does not fix.** The confident-garbage class — clean-looking text with
no markers, a farm name and a patronymic quietly corrupted into different ones —
is not addressed by a model swap, and Gemini has not been measured on the Västra
Karaby pages where that was recorded. Nothing checks a transcription against its
scan.

**Ruled 2026-09-10 (lead): accepted and recorded, not gated.** No write-boundary
check reaches this. The bridge — require a step to deposit its output, then gate
the output (ADR-0011) — buys existence, not fidelity: a persisted transcript
proves a page was read and says nothing about whether the words match it.
Measured before accepting: across the 22 runs carrying agent attribution,
`image-reader` returned without calling `image_transcribe` **0 times in 123
instances**, so an existence gate would police a failure this corpus does not
contain. That measurement, and what would reopen the postcondition it retired,
are in `docs/specs/guardrail-enforcement-spec.md` under "Options set aside". Fidelity needs a second read — the retired Opus arm above, and the
user-invoked re-read tool still parked in the open questions below. **What
reopens it:** a confident-garbage instance observed in a graded run or a hosted
feedback bundle — a transcription contradicted by its own scan, found per
instance, not a count difference.

---

> **Everything below (§5–§11) is the build contract, conditional on §4.4.**

## 5. Tool: `image_transcribe`

### 5.1 Purpose

Fetch a FamilySearch distribution image by `imageId` or `ark`, run VLM OCR
host-side, and return a faithful text transcription. The image bytes never
cross the MCP transport.

This is the **sole read** for every image, via the `image-reader` subagent
(the spike showed a hosted VLM is a strong-enough reader; §8). There is no second
reader — the agent never reads a scan inline with Claude's own vision.

### 5.2 Relationship to existing tools (naming)

Per the repo rule "generic tool names with provider parameters, not one tool
per provider," the tool is **`image_transcribe`**, not `qwen_ocr` or
`openrouter_ocr`. The VLM host and model are configuration (§9 / §6.3), not
the tool identity, so we can retarget the model without renaming the tool or
touching callers.

*(Name is a reviewer's call; `image_ocr` is the alternative. Pick one and be
consistent across schema, manifest, and skill.)*

### 5.3 Input

```typescript
{
  imageId?: string    // DGS Image Group Number "NUMBER_NUMBER", e.g. 004884748_02613
  ark?: string        // FamilySearch document-image ARK / resolver URL / dist URL
  memoryArtifactUrl?: string // FamilySearch MEMORY artifact URL
  file?: string       // project-relative path to an UPLOADED image/PDF inside the project (needs projectPath)
  lookingFor?: string // optional search key — WHO/WHAT to locate on the page
  projectPath?: string // absolute project-folder path; required with `file`; stages the read (§5.5) and saves an FS JPEG (§8.5)
}
```

- Exactly one of `imageId` / `ark` / `memoryArtifactUrl` / `file`, checked in the tool
  **before** the shared resolver (which knows only the three FamilySearch shapes). The first two resolve
  **identically to `image_read`** (§8 shares the resolver). Accept the same
  shapes `image_read` accepts today (`3:1:`/`3:2:` ARKs, resolver URLs,
  `/$dist`, `dgs:.../dist.jpg`).
- `memoryArtifactUrl` is a person's **memory** artifact, as carried by a
  `person_read` source that came from the memories API — a scanned will,
  certificate, obituary clipping or compiled history uploaded by a relative. It
  is the retry route for a memory the `person_read` transcription budget
  skipped, the filter missed, or the OCR failed on; there is no other way to
  read one, since a memory URL is neither an image-group `imageId` nor a
  `3:1:`/`3:2:` ARK. Three things make it unlike the other two shapes:
  - It is **already a direct bytes URL**, so it is passed through rather than
    resolved, and carries no `fallbackUrl`.
  - It is fetched with **no Authorization header and needs no FamilySearch
    login**. Measured 2026-09-15 on one artifact with three header sets: no
    headers at all → 200, UA only → 200, bearer+UA → 200. Sending a token would
    also mean handing a credential to a URL that arrived inside a response
    body, which is why the host is **validated, not trusted**: it must be
    `sg30p0.familysearch.org` with a path ending `/dist.<ext>` (221 of 221 in
    the probe corpus), and anything else is refused before any fetch.
  - **`application/pdf` is accepted here**, unlike the image-only page-scan
    shapes. PDFs are 29 of that 221 and carry the wills and certificates.
    Measured the same day: the model transcribes a PDF handed to it as an
    ordinary `image_url` data URL — 1222 chars off the smallest memory PDF — so
    no file-parser plugin and no second request shape are needed. `audio/*` and
    `video/*` are still refused.
- **`file` — an uploaded image or PDF already inside the project folder**.
  The hosted upload endpoint writes researcher files to `<project>/uploads/<name>` and the
  MCP server runs in the same sandbox, so the bytes are already where the tool can reach
  them; until this input existed an uploaded Ancestry JPEG had no path into extraction while
  an uploaded PDF did (the model opened it itself). Contract:
  - **Requires `projectPath`**; the ref is relative to it. The directory is classified first
    (`classifyProjectPath`): a missing `projectPath` and a missing directory are the shared
    loud errors, a folder holding neither project file is the no-project *answer*
    (`{ ok: false, reason: "no_project" }`, the no-project rule) — before any key or path error.
  - **Shape, before any I/O:** no leading slash or drive letter, no backslash, no NUL, no
    empty / `.` / `..` segment. Any ref *inside* the project is allowed; the containment guard
    is the store's (`FsProjectStore.readableReal`: realpath'd, symlink-aware, regular files
    only), so a symlink out of the project is refused with "escapes the project directory".
  - **Read through the ProjectStore (`readBytes`)**, never `readText` (a JPEG decoded as UTF-8
    is mojibake). A missing file is "not found under the project folder"; a directory is refused.
  - **Type by magic bytes, never by extension:** JPEG, PNG, GIF, WEBP, PDF. A `.jpg`-named PDF
    is sent as a PDF; anything else is refused ("not an image or a PDF (by its content, not its
    name)") and pointed at `sidecar_read` for text.
  - **No FamilySearch token** — `fetchFsImageBytes` is not on this path, so a user who never
    called `login` can read their own upload. The OpenRouter key is still required.
  - **No `imageRef`, no copy under `images/`:** the upload is already retained at its own path;
    `images/` is the retained-scan store the viewer and the `*.jpg` GC own (§8.5), and citing
    an upload is `document-capture`'s job.
  - A **PDF** goes down the same `image_url` data-URL path as a memory PDF (`application/pdf`)
    — see §5.4 for why that is the PDF reader.
- `lookingFor` mirrors the `image-reader` subagent's parameter: a search key
  only. It focuses a FOUND/NOT FOUND pointer (withheld on a truncated read,
  §6.2); it **never** shortens or slants the full transcription, and any
  *assertion* in it ("confirm the father is Adam Schreck") is ignored —
  transcribe what the page says.
- `projectPath`, when given, makes the tool **stage** the transcription (§5.5,
  `staged` / `digest`) and, for a FamilySearch input, **save** the fetched JPEG
  host-side to `<projectPath>/images/<key>.jpg` and return an `imageRef`
  (§8.5). Both best-effort: a save failure omits `imageRef` and a staging
  failure yields `staged: null` + `stagingError`, neither loses the
  transcription. Omit it (e.g. in the dev smoke) to skip both and just get text.
- All input is camelCase (MCP wire convention).

### 5.3.1 Given-name expansion in `lookingFor`

When `lookingFor` contains a recognized English given name (formal or
variant), the tool automatically expands it with historical diminutives
from the bundled variant table (`config/given-name-variants.json`) before
building the OCR prompt.

- Input: `lookingFor: "Elizabeth Martin"`
- VLM sees: `mentions "Elizabeth Martin (also known as Betty, Betsy, Beth, Liz, Lizzy, Eliza, Lisa, Bess, Eliz, Eliz., Elizth.)" by writing exactly FOUND or NOT FOUND`

All variant forms are included (including scribal abbreviations with
periods) because the VLM reads natural language, not query syntax.
Bidirectional: searching for "Betty Martin" also includes "Elizabeth"
and all other variants.

When expansion fires, the response includes a `nameExpansion` field
(reversing the prior §5.3.1 decision — the genealogist needs to know
what the VLM was primed with before reading a contested hand):

- `original`: the caller's `lookingFor` string
- `expanded`: the rewritten prompt the VLM actually saw
- `expansions`: which formal names were expanded and to which variant
  forms (keyed by the table's formal name, e.g. `"Elizabeth"`)

This mirrors `fulltext_search`'s `nameExpansion` without
`variantsInResults`, which has no equivalent for VLM transcription.

### 5.4 Behavior (pipeline)

1. **Acquire the bytes.** For `imageId` / `ark` / `memoryArtifactUrl`: resolve + fetch the
   FS distribution image host-side via the shared fetcher lifted from `image-read.ts` (§8),
   reusing `getValidToken(principal)` and `BROWSER_USER_AGENT` — do **not** re-implement
   token or fetch logic. For `file`: classify the project, check the ref shape, read the
   bytes through the ProjectStore, sniff the type (§5.3) — no token.
2. **Refuse an oversize payload** (§7): more than `MAX_OCR_INPUT_BYTES` (14 MiB raw) on
   **any** input source is refused before the data URL is built, with the size, the cap
   and the remedy in the message.
3. **No pre-processing** — the spike (PR 723) showed prep lowers accuracy, so
   the raw bytes go straight to OCR (no `jimp`; see §7).
4. **OCR** via OpenRouter (§6): base64 the raw bytes into a data URL, POST an
   OpenAI-compatible chat/completions request with the faithful-OCR prompt,
   read `choices[0].message.content`. **A PDF goes down this same path** as an
   `image_url` data URL with `application/pdf` — measured 2026-09-15 on memory PDFs
   (§5.3), and it is why "teach the host to read a PDF"
   needs no decoder in the three-dependency production tree: the default model's provider
   extracts the text natively embedded in a PDF **and** renders its pages for vision
   (Gemini document processing, up to 50 MB / 1000 pages), which is "text layer first,
   page-render fallback" done by the provider. Caveat: a user-configured non-Gemini
   `openRouterModel` may reject a PDF `image_url`; that surfaces as the ordinary
   "OpenRouter OCR failed: <status>" error. If that ever matters, OpenRouter's `file`
   content part with the `file-parser` plugin (engines `native`, free `cloudflare-ai`,
   paid `mistral-ocr`) is the alternative request shape — not built, because the measured
   path works with no plugin fee.
5. **Stage** (with `projectPath`): the transcription is retained host-side through the
   search tools' channel (§5.5) and a `digest` is computed. Best-effort.
6. **Return** the transcription text + `staged` / `digest` + light metadata (§5.5). No image block.

There is **no size cap for transport reasons** — the bytes go host→OpenRouter, never back
over MCP. The only cap is the provider's request limit (§7), and the tool refuses rather than
downscales.

### 5.5 Output

Returns **text only**:

```typescript
{
  transcription: string      // faithful full-page OCR (the primary payload) — never doctored
  truncated?: true           // present when the OCR hit its output-token cap (finish_reason or native_finish_reason marks it — §6.2); transcription is PARTIAL
  truncationNotice?: string  // tool-voiced plain sentence companion to `truncated`; present iff `truncated`
  found?: "FOUND" | "NOT FOUND"  // present only when lookingFor was set, the read was not truncated (§6.2), AND the model emitted the marker on the final line
  imageRef?: string          // present iff projectPath given + save succeeded (§8.5) — e.g. "images/<key>.jpg"; never for a `file` input
  staged?: { resultsRef: string; returnedCount: number } | null  // iff projectPath: the staging handle (search-result-staging-spec.md); null when staging failed
  stagingError?: string      // why `staged` is null
  digest?: {                 // iff projectPath: what a caller triages on without the full text
    id: string               // imageId / ark / memory URL, or `capture:<basename>` for a `file`
    chars: number            // transcription length
    excerpt: string          // first 300 chars
    found?: "FOUND" | "NOT FOUND"
    truncated?: true
  }
  browseBudget?: {           // advisory, present only from the 21st distinct image in one group/project (§5.8)
    imageGroup: string       // the image-group prefix, e.g. "004261111"
    distinctImagesRead: number
    notice: string           // pivot advice; independent of `truncated` — the two can co-occur
  }
  metadata: {
    imageId?: string
    ark?: string
    file?: string            // the project-relative ref that was read
    contentType: string      // what was sent to the model: image/jpeg, image/png, application/pdf, …
    model: string            // the OpenRouter model slug actually used
    sizeBytes: number        // raw input size (sent to OCR as-is; no pre-processing)
  }
}
```

**The staged element** (one per call, `results[0]` of the envelope, snake_case — it is
persisted project state): `{ id, source: { imageId | ark | memoryArtifactUrl | file },
content_type, size_bytes, model, transcription, truncated?, found? }`; the envelope's
`query` is `source` plus `lookingFor`. `research_log_append({ tool: "image_transcribe",
stagedResultsRef })` finalizes it into `results/<log_id>.json` exactly as a search page.
**The inline `transcription` stays** — the shipped `image-reader` agent and `person_read`'s
memories leg read it — so this producer is exempt from the staging spec's inline strip
until the consumer that reads the sidecar instead exists. Who reads the full
text back from the sidecar is that card's design; this tool owes the writer, the envelope
and the digest.

The transcription follows the `image-reader` output protocol: full page
(every relevant entry, not just the `lookingFor` target), original
spelling/language, `[?]` / `[illegible]` / `[torn]`, plus an extracted-facts
list the caller can turn into assertions.

### 5.6 Errors (all LLM-actionable, thrown as `Error`)

| Condition | Message shape |
|---|---|
| None of the four inputs | `image_transcribe requires one of imageId, ark, memoryArtifactUrl, or file (…)` |
| More than one provided | `Provide exactly one of imageId, ark, memoryArtifactUrl, or file — not X and Y.` |
| `file` with no `projectPath` / a missing directory | the shared loud messages (`projectPath is required …`, `projectPath does not exist: …`); a folder holding neither project file RETURNS `{ ok: false, reason: "no_project" }` (not thrown) |
| `file` ref shape | absolute / drive letter / backslash / NUL / empty, `.`, `..` segment — named before any I/O; a symlink out of the project is the store's "escapes the project directory" |
| `file` missing / a directory / not an image or PDF | `'<ref>' was not found under the project folder …` / `is a directory` / `is not an image or a PDF (by its content, not its name) …` |
| Payload over `MAX_OCR_INPUT_BYTES` (any input) | `This <type> is N MiB, over the 14 MiB the OCR request can carry … It was not sent. Ask the user to re-save … or split a multi-page PDF …` (§7) |
| Bad imageId/ark | reuse `image_read`'s existing messages (§8) |
| No OpenRouter key configured | LLM-instruction error directing the user to set `openRouterApiKey` in `~/.familysearch-mcp/config.json` directly (§6.3). The tool never accepts an API key as a parameter. |
| FS image fetch non-2xx | `FamilySearch image fetch failed: {status} {statusText}` (reused) |
| Response not an image | `Expected an image response but got content-type: {type}` (reused) |
| OpenRouter non-2xx | `OpenRouter OCR failed: {status} {statusText}` (+ body excerpt if present) |
| OpenRouter unreachable | friendly `Could not reach OpenRouter (...)` (mirror `wiki-search.ts`) |
| Empty/garbage OCR result (no cap) | throw rather than return a fabricated read — the caller pivots to indexes |
| Empty result **with** an output cap (`finish_reason`/`native_finish_reason` marks it) | throw too — a zero-content read has nothing to return — but the message names the cap (budget likely spent on reasoning) so the caller learns a budget bound, not an unreadable scan. Keeps the invariant that `truncated: true` never ships beside an empty `transcription` (§6.2) |

The tool **never fabricates** a transcription on failure. It throws; the
caller (record-extraction) pivots to indexed records, exactly as the
`image-reader` NOT-READ path prescribes today.

### 5.7 Timeout budget

Every network leg is bounded through `fetchWithTimeout` (`src/utils/http.ts`);
Node's `fetch` has no timeout of its own and an unbounded OCR call is what hung
a run for 605s. The legs are budgeted **separately**, and the budget covers
headers and body together:

| Leg | Constant | Budget |
|---|---|---|
| FS image download (and its fallback-URL retry) | `IMAGE_FETCH_TIMEOUT_MS` (`utils/fs-image-fetch.ts`) | 90s per attempt |
| OpenRouter OCR | `OCR_TIMEOUT_MS` (`tools/image-transcribe.ts`) | 180s |

Worst case for one `image_transcribe` is therefore 90 + 90 + 180 = **360s**,
inside the e2e harness's 600s inactivity window — and a timeout returns as a
`tool_result`, which re-arms that window.

**This 360s worst case is unreachable in Cowork.** The device bridge caps every
MCP call at 60s (a client-side ceiling this repo does not set and cannot change
from the plugin or the `.mcpb` — see `docs/architecture.md`, "Other environment
differences that bite"), so a Cowork transcription slower than a minute is
aborted long before either budget above fires. Measured 2026-09-08 over 59 live
reads, none ran past 60s (p50 18.7s, p95 42.8s, max 50.1s), so a Cowork
transcription now usually finishes inside the window — though several
`image-reader` subagents transcribing at once still stretch the tail past it.
The 90/90/180 budgets hold only on the paths that honour them — verified over
stdio for the harnesses and the hosted
control plane; whether the desktop `.mcpb` is bridged too is unverified, so the
ceiling may apply to every Cowork session. This is a documented
environment property, not a tool defect: raising
`OCR_TIMEOUT_MS` recovers nothing there, and lowering it would lose the tail
everywhere else. A per-install `ocrTimeoutMs` override and a one-retry carve-out
in the `image-reader` agent were both weighed against this write-down and dropped
— the first recovers nothing until a config file is hand-edited, the second costs
two fresh eval suites (lead decision, 2026-08-17).

**Where 180s comes from.** Measured 2026-09-08 by timing the tool directly, one
call at a time, over 59 images drawn from the committed run logs on the current
default model (repeat with `dev/try-image-transcribe.ts`): whole call p50 18.7s,
p90 40.6s, max 50.1s, of which the download leg is p50 1.9s, max 8.0s. So 180s is not a latency budget
but a hang-catcher — 3.6x the slowest healthy read — and the run logs show what
it catches: seven calls returned `timed out after 180000ms`, all of them before
the 2026-08-30 model change.

Re-measure the same way after any change to `DEFAULT_OPENROUTER_MODEL`. **Do not
derive it from run-log `usage.timeline` gaps**: those are per SDK message, not
per tool call, and the figures they gave here (p90 79s, max 167s) were both
inflated and a model generation stale.

### 5.8 Browse budget

An agent can enter an unbounded page-by-page hunt through a browse-only image
volume — binary-searching a film for one register page, one OCR round-trip at a
time — and never leave it. One run did exactly this: 58 `image_transcribe` calls
bisecting a single image group, no give-up condition, until it burned the harness
wall-clock cap with no proof written. The per-invocation `image-reader` bound does
not reach it (nothing counts *across* invocations), and skill prose does not either
(over half the long hunts run in sessions that never load `search-images`). So the
budget lives on the tool.

**What it does.** From the `BROWSE_BUDGET_IMAGES + 1`-th (currently the **21st**)
distinct image transcribed within **one image group in one project**, a successful
result carries an advisory `browseBudget` field naming the count, the group, and a
pivot instruction (log the browse with a negative outcome and move to the indexed
route, or ask the user). The field is additive and independent of `truncated`:
`browseBudget` reports a browse-count advisory, not read completeness, so a
budget-advised read can also be output-cap truncated (the two co-occur).

**Counting.** A module-level `Map<string, Set<string>>` (`browseBudgetSeen`, keyed
`` `${projectScope(projectPath)}\0${imageGroup}` ``) holds the distinct `imageId`s seen
per group per project; the group is the digits before the underscore in the `imageId`.
The scope is the bound store's `projectId` where it has one (patron isolation on the
shared-process `http.ts` entrypoint — see the shared `projectScope` helper in
`image-store.ts`, which the truncation cap keys on too), else the normalized
`projectPath`, else the `<no-project>` sentinel when the LLM passed no `projectPath`.
The map is process-lifetime and **never persisted**; re-reading an image already in the
set does not advance the count. `__clearBrowseBudgetForTests` resets it between tests.

**Key by project, not group alone.** The MCP server process outlives one
conversation (on the desktop `.mcpb` it lives as long as Claude Desktop runs; the
hosted path holds one persistent SDK client per session). A group-only key would
tell a *second* project that opens a volume an earlier project browsed that it has
already read 20 pages on page one — an argument to abandon a legitimate browse.
Keying on project prevents that, and a unit test pins it (a same-group read under a
different `projectPath` starts fresh). What no unit test or `make e2e-run` can
observe is the intended flip side — that within one live process the count carries
*across* conversations on the same project — because both start a fresh process; that
rests on the process-lifetime map and is verified by reading, not by a test.

On the shared-process `http.ts` entrypoint every request presents the *same* anchor
`projectPath` (`/project`), so the "project" the key isolates is the bound store's
`projectId`, not the anchor — the same `projectScope` scope the truncation cap keys on
(§8.6). On the desktop `.mcpb` (one process, one project) that `projectId` is undefined
and the scope is the normalized `projectPath`; a unit test pins patron isolation under
a shared-process store binding. **Known limitation — header-less requests share a
bucket.** A request that presents *no* `X-Genealogy-Project-Id` header binds an
*unbound* store whose `projectId` is undefined (it does not 400; only a *malformed* id
does), so two header-less patrons fall back to the same `projectPath`/`<no-project>`
scope and can advance one another's browse counter. Unlike the truncation cap — whose
store I/O throws before any cap is recorded, so its identical fallback is never reached
— `recordBrowseAndCheckBudget` performs no store I/O, so the fallback is genuinely
reachable here. Accepted, not fixed: any such session is already failing every
persistence call with the unbound store's instruction message long before it reaches 21
images in one group, and the consequence is only an advisory field on a *successful*
read — nothing is refused (the ADR-0011 read-tool carve-out below). A 400 on a missing
header would change the entrypoint's contract and is out of scope for a cache key.

**Advisory, not a refusal — an ADR-0011 read-tool carve-out.** ADR-0011 lists "an
advisory instead of a refusal" as a rejected alternative, but that evidence is about
a *state* gate, where an advisory let a run complete over an unresolved identity
conflict. A page read persists nothing, so the asymmetry inverts: a wrong refusal
would hard-block a researcher mid-browse with no way around it but restarting the
server, and no production telemetry would ever surface that happening
(`docs/architecture.md` §9.4). A caller-supplied override parameter is ruled out
separately under ADR-0006 — the caller supplies the input, so a parameter is a
request, not a constraint. The budget therefore ships as a field on a *successful*
result and knowingly does nothing if the agent ignores it.

**Why the threshold is 20.** Measured over the committed e2e corpus, distinct
images per group for every block of ≥8 were 41, 26, 18, 17, 15, 14, 9, 8, 8. At 20,
exactly two blocks carry a notice, both in one run — which passed, citing no image
from either block (both yielded only a negative finding, which is the pivot the
notice asks for, after 41 and 26 pages instead of 20). The highest non-noticing
block is 18, so the budget does not fire on ordinary reads. Re-measure before
changing it.

**Two things it knowingly does not do** (accepted trades, not gaps to close here):

- **An advisory cannot make the agent stop.** The motivating run already had a
  skill-level pivot instruction available and bisected for two hours anyway. This is
  the price of never blocking a researcher mid-browse.
- **The delegated path never sees the notice.** The `image-reader` subagent's return
  contract is a closed enumeration and its verbatim relay only fires when the tool
  *throws*, so a notice riding a successful transcription dies in the subagent's
  throwaway context. Corpus-wide about 40% of `image_transcribe` calls are
  main-thread and see it directly; one measured run is fully delegated and would see
  nothing. Teaching the agent to relay it is a separate task with its own reviewer
  and paid eval slot.

**Known limitation — ARK input is not counted.** An ARK carries no image-group
number, so a hunt driven by `ark` rather than `imageId` never advances the budget.
Resolving an ARK to its group is deliberately out of scope.

### 5.9 Runtime failure: one retry, transport only

**The measurement.** Over the committed e2e corpus, 30 of 175 classifiable
`image_transcribe` calls (17.1%) were lost before reaching a model — 24 at the
transport, 6 to the timeout. The true corpus rate is unrecoverable, bounded
[7.6%, 63.2%], because the 14-day capture strip removed 219 calls; the report is
`make e2e-transcribe-failures` and every rate it prints carries its denominator.

**Why it is not a standing block.** Two probes found the path healthy minutes
after real failures — 70/70 host-to-OpenRouter POSTs with a realistic multi-MB
body, and 46/46 later the same evening on a host that had just lost ~25–50% of
calls in a ~100-minute window. IPv6 misconfiguration, path-MTU blackholing,
conntrack exhaustion and concurrency were each measured and ruled out. The
failures are **intermittent**.

**What it costs when it is not retried.** On one run, 2 of 4 calls were lost and
the agent generalised from them — *"the OCR service is network-unreachable in
this environment… All further image-reader attempts will encounter the same
block"* — abandoned the image route entirely, and concluded from an indexed
namesake, writing a false parentage into the tree. The reachability failure did
not tax that result, it **selected** it. That inference is the damage, and it is
reachable from the tool layer rather than from skill prose (ADR-0011).

**The rule.** One retry, 1s apart, on a **transport** failure only. Never on a
timeout. A timeout has already spent `OCR_TIMEOUT_MS`, so a second attempt
doubles the worst case past the budget §5.7 is sized around — the objection that
kept a retry out until now, answered by splitting on the failure shape rather
than overridden. The socket cause code must survive both attempts into the thrown
message, or the classification the code exists for is lost exactly when needed.

**Two limits of that argument, stated because neither is measured.** The
transport branch is cheaper to re-attempt only *usually*: it catches every
non-timeout fetch rejection, including a reset that arrives after the request was
sent and inference may already have been billed, which neither returns fast nor
costs nothing. Nothing in the corpus separates those cases — 0 of 30 recorded
failures carry a socket cause code — so "cheap to retry" is a reasoned default
awaiting the coded failures, not a measured property.

And the budget the argument is framed against is the wrong one for the
environment most users are in. `OCR_TIMEOUT_MS` is 180s, but Cowork's device
bridge aborts every MCP call at 60s, and the retry does not check any clock — it
spends a budget the code never reads. At the current default's measured 4.0s per
page a second attempt is nowhere near either ceiling, which is why this is
recorded rather than guarded; a slower default would make it bite, and that is
the condition to re-check on.

**Alternatives it beat.**

- **Retry everything, including timeouts.** Rejected on the budget: 2 × 180s
  exceeds what §5.7 sizes, for the failure shape least likely to succeed on a
  second try.
- **Retry more than once, with backoff.** Rejected as unmeasured. Nothing in the
  corpus shows a third attempt would convert anything a second does not, and
  each attempt is a live OCR call.
- **Wait for the host-vs-provider classification first.** Rejected because the
  classification does not change the action. Both hypotheses are "intermittent",
  and a bounded retry is the right response to either. The classification remains
  genuinely open — 0 of 30 committed failures carry a socket code, since every
  one predates the change that surfaces it — and it is now an observability
  question, not a gate on this fix.
- **Fix it in skill prose** ("if a read fails, try once more"). Rejected per the
  lane rule: the escalation prose this spec previously shipped fired zero times
  on the page it was written for.

## 6. OpenRouter integration

### 6.1 Request

- `POST https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible).
- Headers: `Authorization: Bearer <openRouterApiKey>`, `Content-Type:
  application/json`, and OpenRouter's recommended `HTTP-Referer` /
  `X-Title` attribution headers (set to a stable app identifier).
- Body:

```jsonc
{
  "model": "<configured slug, default Gemini Flash>",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "<faithful-OCR prompt + optional lookingFor>" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<...>" } }
    ]
  }],
  "temperature": 0,
  "max_tokens": 16000,                         // OCR_MAX_TOKENS — see below
  "provider": { "data_collection": "deny" }   // privacy — see §11
}
```

- `temperature: 0` — OCR is not a creative task.
- `max_tokens` (`OCR_MAX_TOKENS`, `image-transcribe.ts`) is set **explicitly**.
  Setting it makes the cap ours and the truncation case (§6.2) reproducible.
  Mind the **direction**: for the current default `google/gemini-3.7-flash`
  OpenRouter reports a 65536 max-completion ceiling and the tool previously sent
  no `max_tokens`, so `16000` **lowers** the effective cap, it does not raise it.
  It is still well above a page's content — measured 2026-09-07, the largest
  transcription recovered from the committed e2e run logs is 6,443 chars (~1.6k output
  tokens), and both Gemini and the prior Qwen default have *produced gradeable
  output* at 16000 in `dev/try-ocr-compare.ts` (that script reads only
  `choices[0].message` and `usage`, so it cannot itself observe a cap). Treat the
  figure as a dated bound, not a proof: of 455 calls, 219 are excluded by the
  harness's 14-day capture strip and 126 have a recoverable transcription size,
  so it is measured over those 126 (median 1,573 chars); both models are
  represented, the current default's own 36 measured calls topping out at 4,940
  chars (~1.2k tokens); and reasoning tokens draw on this same budget (the
  current model is reasoning-capable and reasoning is not disabled), so a
  reasoning-heavy read could reach 16000 before the page is done. Re-derive by
  scanning `eval/runlogs/e2e/**` for the `full length N chars` marker — **not**
  with `make e2e-transcribe-failures`, which reports reachability, not sizes.
  A cap that binds is **visible** (`truncated`,
  §6.2), never silent.
- The OCR **prompt is baked into the tool**, not passed by the caller —
  reuse the `image-reader.md` protocol so behavior is identical to today's
  subagent. `lookingFor` is appended as the optional pointer directive.

### 6.2 Response

Parse `choices[0].message.content` → `transcription`. Derive `found` by
looking for the FOUND/NOT FOUND marker the prompt asks the model to emit.
Guard against empty content (→ error per §5.6).

**Output-cap truncation.** Read `choices[0].finish_reason` **and**
`choices[0].native_finish_reason`. OpenRouter is OpenAI-compatible and returns
them per choice: `"length"` on an output-token cap (**measured** — see
`dev/probe-ocr-finish-reason.ts`), and `"stop"` as the non-cap value, which is
the OpenAI-compatible contract **inferred rather than measured on a full page**,
since the probe captured no complete-page read. A capped read usually carries the
partial content it got before the cut, so without this it passes as an ordinary
success and the caller cannot tell a half-read census page from a whole one.

- Truncated when `finish_reason` **or** `native_finish_reason` matches a cap
  marker — `"length"` or `"MAX_TOKENS"`, matched **case-insensitively** — → set
  `truncated: true` and a tool-voiced `truncationNotice` (§5.5). The measured
  default (`google/gemini-3.7-flash`) normalizes its cap onto the top-level
  `finish_reason: "length"` and *also* reports `native_finish_reason:
  "MAX_TOKENS"`; the second field and the loose casing are **insurance** for a
  model (reachable via the `openRouterModel` override) that does not normalize
  or spells the marker differently — not a description of the default.
- **Content present → partial success, not an error:** the tool returns the
  lines it got and does **not** throw. **Content empty → still throws** (a
  zero-content read has nothing to return), but the error text names the cap so
  the caller learns a budget bound rather than an unreadable scan. This keeps the
  invariant that `truncated: true` never ships beside an empty `transcription`,
  and it is the case the §5.6 "empty → throw" row governs — the two are
  consistent, not contradictory.
- The `transcription` stays **verbatim** — the signal rides the sibling
  fields, never spliced into the OCR text (that would re-create the
  prose/OCR blend a truncation notice must never introduce; the
  `browseBudget.notice` precedent is the same shape).
- **Suppress `found` on a truncated read.** The FOUND/NOT FOUND marker rides
  a final line the model never reached, and a target may sit below the cut,
  so a half-read page must never surface a clean `NOT FOUND` negative.
- **Out of scope:** a model that stops early on its own
  (`finish_reason: "stop"` on an unfinished page — no cheap signal, a
  model-quality problem) and a transport cut mid-body (already thrown by
  `fetchWithTimeout`, §5.7).

### 6.3 Model selection

Default model slug lives in `config.ts` (a constant, overridable per-user via
`openRouterModel` on `AppConfig` for A/B testing without a rebuild). **The
LLM does not choose the model** — it is not a tool parameter. The researcher
sets the default from Phase 0 (§10 open q. on exact slug/tier).

## 6.4 Key management (`configure_openrouter`)

An OpenRouter key is a **static, non-expiring secret** — unlike the FS OAuth
flow. Storage follows the existing per-user config convention exactly:

- Add `openRouterApiKey?: string` (and optional `openRouterModel?: string`)
  to `AppConfig` in `src/types/auth.ts`.
- Add `getOpenRouterApiKey(principal): Promise<string>` to `src/auth/config.ts` — reads
  `loadConfig(principal)`, throws the LLM-instruction error in §5.6 when absent. Add
  `getOpenRouterModel(principal)` returning the default slug when unset. **No env-var
  fallback** (repo rule). Stored in `~/.familysearch-mcp/config.json`, mode
  `0o600` (already enforced by `saveConfig`).
- The FS `login` analogy is **imperfect**: FS login is a browser OAuth
  round-trip the tool drives itself; an API key is a static paste the tool
  cannot obtain on its own. The key is set by the user directly in
  `~/.familysearch-mcp/config.json` as the `openRouterApiKey` field. It
  never passes through a tool-call argument, so it never appears in the
  session transcript.

  **Tool `configure_openrouter({ model? })`** accepts only an optional model
  slug. It calls `saveConfig({ openRouterModel })`. Flow: `image_transcribe`
  errors "no key" → Claude tells the user to set `openRouterApiKey` in
  `config.json` directly → user edits the file → retry.

### 6.5 Key provisioning across runtimes

**`getOpenRouterApiKey` reads the key only from the config, never from `process.env`,
in any runtime** — the same channel the MCP server uses for the FS token
(`tokens.json`) and `wikiApiUrl`. What differs per runtime is who fills that config,
and the answer splits on whether the server is a process a user installed or a process
something else starts. Where a user installed it, the config is the file they own.
Where an orchestrator starts it — the hosted sandbox, the e2e harness — that
orchestrator writes the file before the server runs. Where the server is a **container**
(the two search-agent prototype entrypoints), the entrypoint builds the config from its
own environment before constructing the server, because a container receives a secret
as environment and not as a file baked into an image — and `hosted-stdio.js` receives
it per TURN, from the worker, which no file could do:

| Runtime | Server runs | How `openRouterApiKey` reaches `config.json` |
|---|---|---|
| **Cowork desktop** | host (`.mcpb`) | the user edits `~/.familysearch-mcp/config.json` directly (the `configure_openrouter` tool sets only `openRouterModel`, not the key) |
| **Hosted web** | inside the E2B sandbox | Fly secret `OPENROUTER_API_KEY` → `config.py` `Settings.openrouter_api_key` → a `write_config(sandbox, {openRouterApiKey})` sibling of `fs_oauth.write_tokens`, written into the sandbox's `~/.familysearch-mcp/config.json` at session create (`sessions.py`) |
| **Search-agent prototype** | a container (`build/http.js`, the shared compose `tools` service; `build/hosted-stdio.js`, the worker's per-turn fork) | compose passes the stack's `OPENROUTER_API_KEY` to the service, and the worker passes it to each fork; both entrypoints layer it and the other three per-user keys over whatever config they start from (`src/hosted-config-env.ts`) before building the server |
| **e2e harness** | node subprocess of the harness | the harness reads `OPENROUTER_API_KEY` from `eval/.env` and stages `openRouterApiKey` into the `~/.familysearch-mcp/config.json` the subprocess reads (consistent with e2e already depending on the developer's real `tokens.json` there) |

So in every runtime the env var is **bridged into the config** rather than consulted
when the key is needed: no tool reads a credential from the environment, and
`getOpenRouterApiKey` stays the single resolution point with a single source. That is
what the "no env-var fallback" rule protects, and it holds. What does **not** hold, and
was claimed here until 2026-09-20, is the stronger sentence that the server makes zero
`process.env` reads: `hosted-stdio.ts` has read these four since the D9–10 engine half,
`http.ts` since the tool-server default moved to it, and a shipped tool
(`research-append.ts`) reads two debug-hold variables. The bridge is at the
**entrypoint** for a container and at the **orchestrator** for a sandbox; both are
outside the tool, which is the line that matters. The hosted-path
`fs_oauth.write_tokens` (`TOKENS_PATH = {HOME}/.familysearch-mcp/tokens.json`,
called from `sessions.py:create_project`) is the exact pattern the
`write_config` sibling follows.

## 7. Image pre-processing — decided against (PR 723); payload cap — refuse, not downscale

**Payload cap.** `MAX_OCR_INPUT_BYTES = 14 MiB` of raw bytes, on every input source, refused
before any OpenRouter call with the size, the cap and the remedy in the message. Sized from the
only documented limit in the chain — the default model's provider: *"Inline image data limits
your total request size (text prompts, system instructions, and inline bytes) to 20MB"*
(ai.google.dev, Gemini image understanding). OpenRouter documents no request-body cap of its own.
14 MiB × 4/3 (base64) = 19.6 MB, under 20 MB with the prompt. Uploads may be 25 MiB
(`apps/server/app/sessions.py`), so a 14–25 MiB upload is the case this names; nothing in the
committed corpus shows a FamilySearch scan near the cap, so on that path the check is wiring.
The figure is Gemini's — an `openRouterModel` override changes the true limit and the cap stays
a conservative constant. **Alternative beaten:** downscaling. It needs the pre-processing this
section rejects below (measured to lower accuracy and double hallucinations), and a downscaler
worth having (`sharp`) is a native binary the `.mcpb` cannot carry. This retires the former §5.4
sentence "a pathological multi-MB scan exceeding OpenRouter's own request-body limit is an open
risk, not handled today".

**No pre-processing. No `jimp` dependency.** The spike tested the full
`enhance_for_ocr` pipeline (grayscale + autocontrast + unsharp + JPEG q95, via
PIL) against raw bytes, and it *hurt*: Qwen's hard-subset field accuracy fell
69%→59% and hallucinations more than doubled (13→27); sharpening even
*enlarged* some payloads (grayscale+sharpen+q95 > the original JPEG's
compression). The shipped tool base64s the **raw** `dist.jpg` bytes and sends
them as-is.

(The rejected design and its rationale — pure-JS `jimp`, never `sharp`, to
avoid native `.mcpb` binaries — is preserved in git history / PR 723 in case a
future corpus, e.g. faint German Kurrent, reopens the question. It is not
built now.)

## 8. Shared fetch + `image_read` disposition

- **Lift the resolve+fetch** out of `image-read.ts` into
  `src/utils/fs-image-fetch.ts`: `resolveInput` (imageId/ark → URL) and a
  `fetchFsImageBytes(url) → { bytes, contentType }` that carries the
  `getValidToken(principal)` + `BROWSER_USER_AGENT` + content-type checks. Both
  `image_read` and `image_transcribe` call it. (Two concrete callers now =
  the right time to extract, per the code-reuse rule; not premature.)
- **`image_read` stays** — its raw-image return still serves any consumer
  that needs pixels (Issue #28 OCR comparison). Its 700 KB floor and the
  accumulation caveats remain valid for *that* return type. Drop only the
  fetch duplication.
- Update `docs/specs/image-read-spec.md` to cross-reference this tool as the
  `image-reader` subagent's **sole** OCR path, and note that `image_read`'s
  inline-base64 return is no longer used by that subagent (it stays only for
  the Issue #28 pixel consumer).

## 8.5 Image persistence + viewing (retained sources only)

`image_transcribe` returns text, but the researcher will want to **see the
scan** behind a transcription in the Electron viewer (and later the hosted
web viewer). Persist the JPEG — but only for sources the researcher keeps,
so projects don't bloat with every scan read.

**A `file` input is never copied here and never yields `imageRef`**: the upload is
already retained at its own path inside the project, `images/` is the retained-*scan* store this
section's GC sweeps (`*.jpg`), and citing an upload on a source is `document-capture`'s job.

**Save-by-imageId + TTL sweep (design B).** A source carries no imageId to
key a staging→finalize on, so a GC sweep replaces the finalize:
- When `projectPath` is given, `image_transcribe` saves the fetched JPEG
  directly to `<projectPath>/images/<key>.jpg` (`key` = the sanitized imageId
  or ARK label; `src/utils/image-store.ts`) and returns `imageRef` (the
  project-relative path). Best-effort — a save failure omits `imageRef` rather
  than losing the transcription. It does **not** write `research.json`.
- The `image-reader` subagent threads `projectPath` into that call and reports
  the returned `imageRef`; `record-extraction` sets the retained source's
  `sources[].image_filename` to it in the `research_append` call (pairing the
  image with the existing `transcription` field, `research-schema-spec.md`
  §5.5).
- `research_append` runs a **best-effort, TTL-gated sweep**
  (`gcUnreferencedImages`) after each write: remove `images/*.jpg` that no
  source's `image_filename` cites **and** that are older than the TTL (24 h,
  the `results-staging` value). TTL-gating makes it race-safe — a scan just
  saved by `image_transcribe` survives until the `research_append` that cites
  it (kept) or ages out (pruned) — so only **retained** sources keep an image,
  with no orphans and no finalize hook inside `research_append`'s batch logic.

**Schema change — `sources[].image_filename`** (optional, nullable string).
A "new field" change with the full blast radius: edit `research.schema.json`
in **both** trees (`docs/specs/schemas/` and `packages/schema/schemas/`), the
prose table in `research-schema-spec.md`, the validator
(`packages/engine/mcp-server/src/validation/validator.ts`), and the
`packages/schema` TS mirror (`src/index.ts`). It is optional, so it does
**not** break `eval/fixtures/scenarios/*/research.json`. The validator only
needs `image_filename` on its source field allow-list; `images/` cleanup is
the `research_append` TTL sweep above, not a validator orphan check — unlike
`results/`, a stray `images/*.jpg` never blocks a write, it just ages out.

**Viewing — via the shared `ResearchTransport.getSourceImage` seam.** The
`viewer-ui` `SourcesSection` renders the scan beside the transcription whenever
a source has `image_filename`, lazy-loading it through an optional transport
method (absent → no scan shown). Both adapters implement it:
- **Electron:** `apps/electron/main` reads `images/<file>` from the connected
  project folder over a validated `project:read-image` IPC channel and returns
  a `data:` URL (`img-src data:` already in the CSP).
- **Hosted web:** the browser cannot read the sandbox filesystem, so
  `WsResearchTransport.getSourceImage` fetches
  `GET /api/sessions/{id}/image?filename=images/<key>.jpg` — a control-plane
  route (`sessions.py`) that reads the file from the session's sandbox
  (`sandbox.read_file`, same pattern as the sidecar route) with the same
  `images/<key>.jpg` validation, and streams `image/jpeg` back. (This is
  distinct from `image_proxy.py`, which is a separate, still-stubbed route for
  proxying *FamilySearch* image bytes.)

**Sequencing.** The core text-returning tool (§5–§7) ships first and is useful
on its own; image persistence + the Electron and hosted-web viewers followed.

### 8.6 Deriving `sources[].transcription_truncated` at the write boundary

The truncation of a read is known **here**, at `image_transcribe` (§6.2), but the
consumer that persists a source is not: `record-extractor` does not hold
`image_transcribe` (only `image-reader` does), so it receives the transcription
*text* relayed across a subagent boundary, with the `truncated` flag gone. A
model asked to set `transcription_truncated` from that relayed text can only
guess from prose — and was observed to set it while saving no transcription at
all. So the field is **derived at the write boundary, never
asserted by the agent**:

**The single invariant: nothing moves from
"partial" to "whole", in memory or in the document.** Every remaining error is
then an unneeded badge, never a false all-clear — which is what makes the
agent-supplied `image_filename` join key acceptable (a wrong-but-resolvable key
can add a `true` badge, never a false "verified whole").

- **Record (write side).** On a read that hit the cap and persisted the image,
  `image_transcribe` records it: `recordImageReadCap(projectPath, imageRef,
  truncated)` in `src/utils/image-store.ts`. It is a module-level, **add-only**
  `Set<string>` keyed `${projectId-or-projectPath}\0${imageRef}` — the imageRef
  being the same `images/<key>.jpg` string a source cites as `image_filename`
  (§8.5), and the scope being the bound store's `projectId` where it has one
  (patron isolation under the shared-process `http.ts` entrypoint), else the
  `projectPath`. Membership means verified **partial**; absence means **not
  established** (a whole read or no read). It is add-only — a whole read
  (`!truncated`) records nothing — so once an image is in the set it stays: a later
  narrower read that happens to come back uncapped cannot move it to whole, which is
  stickiness expressed by construction rather than by a guard clause. Both key
  halves arrive from an LLM relay, so the key canonicalizes each: backslashes and a
  trailing separator off `projectPath`, and (via `posix.normalize`) backslashes, a
  leading `./`, doubled `//` and interior `/./` off `imageRef` — the same folding
  the GC applies to its referenced set, so a source cited as `./images//x.jpg` still
  both joins the cap and protects its scan from the sweep. It lives in
  `image-store.ts`, not `image-transcribe.ts`, because both the writer
  (`image_transcribe`) and the reader (`research_append`) already import that
  module. Process-lifetime and never persisted (as `browseBudgetSeen` is, §5.8), and
  scoped the same way — both now key on the shared `projectScope` helper
  (`image-store.ts`): the bound store's `projectId` where it has one, else the
  normalized `projectPath` — so both isolate patrons on the shared-process entrypoint.
- **Derive (persist side).** In `research_append`'s `prepareOps`, after the
  source-reuse rewrite, every `sources` op is folded with its siblings onto the
  persisted entry to get the `image_filename` the batch actually leaves behind —
  so the reference may arrive in an earlier op, or already be persisted, and need
  not be re-sent by the op carrying the transcription. That result reads
  `sourceImageCapState(projectPath, image_filename)` and sets the field from it —
  **authoritative**, any agent-supplied value stripped first. The persisted marker
  is **`true` or absent, never `false`**: `true` is written only when the image is
  in the cap set *and* the op carries a non-empty `transcription`; every other case
  (not in the set, or no text) leaves the key deleted. On an `update` the deleted
  key is absent from the patch, so the merge keeps the persisted value: an image not
  in the cap set permits an in-place `transcription` refinement, and a persisted
  `true` **survives** such a refinement — it may then over-report (complete text
  under a `true` badge), accepted as an unneeded badge and never a false "verified
  whole" (ruling C 2026-09-21 removed the guard that had rejected the refinement).
- **Invariant.** `validate_research_schema` rejects a persisted `false` (the marker
  is `true` or absent) and rejects `transcription_truncated: true` beside an empty
  or null `transcription` — the persisted-side mirror of the tool's own guarantee
  that a zero-content capped read throws rather than returning `truncated: true`
  (§6.2).

**Known limitation — the join needs a persisted image.** Like the browse
budget's ARK blind spot (§5.8), this derivation has a hole, but a *different*
one, because the key is `image_filename`, not imageId:

- A read with no `projectPath` persists no scan, so its source has no
  `image_filename` to join on — its truncation is **not** marked. (A truncated
  read is still visible in the tool response; only the persisted marker is lost.)
- The cache is process-lifetime and never persisted, so a cap recorded in one
  MCP-server process is lost if the process restarts before the `research_append`
  that cites the image — the same boundedness the browse budget carries.
- An **ARK** read is *not* a blind spot here: `saveSourceImage` mints an
  `image_filename` for an ARK label just as for an imageId, so it joins. This is
  the one place this mechanism reaches further than the imageId-keyed browse
  budget it is modelled on.

## 9. Wiring (standard MCP-tool checklist)

- `src/tools/image-transcribe.ts` — tool + `imageTranscribeToolSchema`.
- `src/tools/configure-openrouter.ts` — key-set tool + schema.
- `src/types/image-transcribe.ts` — tool I/O + OpenRouter request/response
  types.
- Register both schemas in `allToolSchemas` (`src/tool-schemas.ts`) — the
  single source of truth and the packaging-drift test's reference.
- Dispatch both in `src/index.ts`.
- Add both tool names to `manifest.json`'s `tools` array (kept in sync with
  `allToolSchemas` by `tests/packaging/manifest.test.ts`).
- Add the new per-user config keys to the config table in **CLAUDE.md**
  (§ "Secrets/config convention") and `research-schema`-adjacent docs if
  referenced.
- `dev/try-image-transcribe.ts` — one-shot live smoke test against real
  OpenRouter + a real FS image (mirrors `dev/try-image-read.ts`).

## 10. Migration (skills + subagent)

- **`record-extraction/SKILL.md`**: keep delegating the **Image** input path
  to `@plugin:image-reader` (the subagent OCRs every scan with the hosted VLM). The
  skill's prose contract barely changes — it still receives a text
  transcription + extracted-facts list and keeps the NOT-READ→pivot-to-indexes
  behavior. Thread `projectPath` through so the subagent's `image_transcribe`
  call can stage the JPEG (§8.5). For desktop setup, when `image_transcribe`
  errors "no key" the error directs the user to set `openRouterApiKey` in
  `~/.familysearch-mcp/config.json` directly; `configure_openrouter` saves
  only a model slug override. Preserve the "reserve image transcription for facts that exist only on
  the image" guidance. (A Sonnet-5 second-opinion escalation was considered and
  **dropped** — the viewer lets a human verify a cite-worthy read against the
  scan; a user-invoked Opus transcription is parked in §15.9.)
- **`image-reader` subagent: one reader only.** Its sole reader is
  `image_transcribe` for every image; it never reads a scan inline with Claude's
  own vision. It returns **text only**, so record-extraction's contract is
  unchanged. Its one tool is `image_transcribe` (`mcp__genealogy__*`),
  `model: claude-sonnet-4-6` (relays/formats text only — the hosted VLM does the OCR),
  and `docs/specs/image-reader-agent-spec.md` is updated to match. Follow the
  **lane rule** (`docs/skill-lifecycle.md` §5): this is a tooling change
  (lane 1).
- File any deferred follow-ups (e.g. multi-image batching) as a GitHub issue in
  the same PR that defers them — `gh issue create --label developer`, see
  `CLAUDE.md` § "Work you find along the way".

## 11. Cost & privacy

- **Cost**: a hosted VLM on OpenRouter is far cheaper per image than Claude
  vision and moves OCR off the main model. Measured 2026-08-30 (§4.5): Gemini
  3.7 Flash $0.0146/page against Opus 5's $0.1418 — roughly $0.58 versus $5.67
  per 40-transcribe research run. The switch from Qwen ($0.0023/page, $0.09 per
  run) gives up ~$0.49 per run to cut hallucinations from 37 to 8.
- **Privacy**: this sends FamilySearch **record scans (PII)** to a third
  party (OpenRouter → an underlying inference provider), where FS OAuth kept
  them first-party. Mitigations to spec: set OpenRouter's
  `provider.data_collection: "deny"` (and consider pinning allowed providers)
  so prompts aren't retained for training; document the change in
  user-facing README/CLAUDE.md so it's a known, consented behavior. Confirm
  this is acceptable to Dallan before shipping — it is a policy decision, not
  just a technical one.

## 12. Fallback if Phase 0 fails — NOT TRIGGERED (Phase 0 passed, PR 723)

*Phase 0 passed, so this fallback is not used; kept as a record of the
alternatives that were considered.* If Qwen (any variant) cannot match the
Claude path on the hard corpus, do **not** ship `image_transcribe`. Fall back to keeping the current
`image-reader` subagent (Claude vision) and solving T13's *size* problem by
response-shaping `image_read` itself, per the earlier brainstorm:

- **A — server-side sizing:** probe whether FS DAS (`das/v2/dgs:.../dist.jpg`)
  honors a size/region/quality param (IIIF-style). If so, downscale or
  region-crop server-side with **zero** bundled dependency.
- **B — adaptive re-encode** to a byte budget with jimp (grayscale +
  quality-first, hard floor, refuse-not-mush).
- **C — two-pass region crop:** downscaled overview + full-DPI `region`
  follow-up, preserving legibility on the specific entry.

These are documented so the fallback is a known path, not a restart.

## 13. Testing

### 13.1 Phase 0 experiment
Per §4 — the quality gate. It was the most important test and it preceded
implementation; it passed (PR 723).

### 13.2 Unit tests (`tests/tools/image-transcribe.test.ts`)

Unlike `image_read` (which the mock MCP server **cannot** exercise because it
can't emit image content blocks — see `image-reader-agent-spec.md` §7), this
tool **returns text**, so it is fully unit-testable by mocking `fetch`.
Mirror `tests/tools/wiki-search.test.ts` (stub global `fetch`, mock the
`config.js` getters):

- **Request shape**: given a resolvable imageId, asserts the OpenRouter POST
  carries the configured model, a `data:image/jpeg;base64,...` image_url,
  `Authorization: Bearer <key>`, and `temperature: 0`.
- **Happy path**: mocked OpenRouter response → `transcription` extracted from
  `choices[0].message.content`; metadata populated (model, `sizeBytes`).
- **`lookingFor`**: sets `found` from the FOUND/NOT FOUND marker; asserts the
  full transcription is still returned (never shortened).
- **No key** → LLM-instruction error, **and `fetch` to OpenRouter is never
  called** (fail closed).
- **OpenRouter non-2xx** → clean `OpenRouter OCR failed: …`.
- **OpenRouter unreachable** (fetch rejects) → friendly error.
- **FS fetch 404 / non-image** → reuse and assert the shared-fetch errors.
- **Empty OCR content** → throws (no fabricated transcription).
- **Input validation**: neither/both of imageId/ark; bad formats (reuse
  `image_read`'s cases via the shared resolver).

### 13.3 Image-prep unit tests — not applicable

Pre-processing was decided against (§7, PR 723), so there is no `image-prep`
module to test.

### 13.4 `configure_openrouter` unit tests

Saves model to config via `saveConfig` (mock it); schema has no `apiKey`
property; `OPENROUTER_API_KEY_MISSING_MESSAGE` names the config file path
and field, and does not instruct Claude to receive the key via the tool.

### 13.5 e2e validation gate (the real T13 proof)

Re-run the T13-failing fixtures with `image_transcribe` wired into
record-extraction — including `clark-parents` and the birk/cruz/zuniga/bottem
scenarios from the closing report. The landing gate is a scored run in which:

- an image that **previously hard-refused** (>700 KB raw) now yields a
  transcription and the facts land as assertions;
- the transcription is a **genuine read** (the historical `clark-parents`
  run *fabricated* its image read — a run that merely finishes is **not**
  sufficient; see `image-reader-agent-spec.md` §7);
- **≥2 scans across separate calls** succeed, confirming the transport-cap /
  accumulation failure mode is gone (it should be structurally impossible now
  — the bytes never enter the transcript — but prove it end-to-end).

Record the passing scored run + `.ann.json` per the usual e2e gate.

## 14. Files to create / modify

**Create**
- `docs/specs/image-transcribe-tool-spec.md` (this doc)
- `src/tools/image-transcribe.ts`
- `src/tools/configure-openrouter.ts`
- `src/types/image-transcribe.ts`
- `src/utils/fs-image-fetch.ts` (lifted from `image-read.ts`)
- `src/utils/image-store.ts` *(image-persistence: save + TTL-GC, §8.5)*
- `dev/try-image-transcribe.ts` — `--project <dir> --file uploads/<name>`
- `tests/tools/image-transcribe.test.ts`
- `tests/tools/configure-openrouter.test.ts`
- Phase 0 results write-up *(done: PR 723; the model-comparison conclusions live in §5 of this spec — Qwen 67% / Sonnet 5 76% / Sonnet 4.6 60% on hard hands, **superseded by §4.5**, and why an opt-in Sonnet-5 second opinion was dropped)*

**Modify**
- `src/types/auth.ts` — `openRouterApiKey`, `openRouterModel` on `AppConfig`
- `src/auth/config.ts` — `getOpenRouterApiKey`, `getOpenRouterModel`, default
  slug constant, missing-key message
- `src/tools/image-read.ts` — use the shared fetcher (dedupe only)
- `src/tool-schemas.ts` — register both new schemas
- `src/index.ts` — dispatch both
- `manifest.json` — add both tool names
- `packages/engine/plugin/skills/record-extraction/SKILL.md` — route Image
  path to `image_transcribe`
- `docs/specs/image-read-spec.md` — cross-reference
- `CLAUDE.md` — new per-user config keys in the config table
- A GitHub issue per deferred follow-up (e.g. multi-image batching), filed in
  the same PR — see root `CLAUDE.md` § "Work you find along the way"

*Uploaded-file input, payload cap and staging:*
- `src/tools/image-transcribe.ts` — `file` input, `MAX_OCR_INPUT_BYTES`, staging + `digest`
- `src/types/image-transcribe.ts` — `file`, `staged`, `stagingError`, `digest`, `StagedTranscription`
- `src/utils/results-staging.ts` — `STAGING_SEARCH_TOOLS` beside a wider `STAGING_CAPABLE_TOOLS`
- `src/tools/record-read.ts` + `src/types/record-read.ts` — a live read with `projectPath` stages the record
- `src/tools/person-read.ts` — narrows the widened return; `src/tools/sidecar-read.ts` — `not_text` points at `image_transcribe({ file })`
- `tests/tools/{image-transcribe,record-read,no-project,research-log-append,sidecar-read}.test.ts`, `tests/utils/results-staging.test.ts`
- `eval/harness/tests/unit/test_mock_mcp.py` (parity lint compares the SEARCH sets), `eval/CLAUDE.md` (parity list)
- `docs/specs/search-result-staging-spec.md` §2 / §5 / §11, `docs/specs/sidecar-read-tool-spec.md` §7, `README.md`

*Image-persistence increment (§8.5):*
- `src/tools/research-append.ts` — TTL-GC sweep of unreferenced `images/*.jpg` after each write
- `docs/specs/schemas/research.schema.json` + `packages/schema/schemas/research.schema.json` — add `sources[].image_filename`
- `packages/schema/src/index.ts` — mirror `image_filename` on the `Source` type
- `packages/engine/mcp-server/src/validation/validator.ts` — allow `image_filename` on the source field set
- `docs/specs/research-schema-spec.md` — `image_filename` prose row
- `packages/engine/plugin/agents/image-reader.md` + `.../skills/record-extraction/SKILL.md` — thread `project_path` → `imageRef` → `image_filename`

*Hosted + e2e key bridges (§6.5):*
- `apps/server/app/config.py` — `openrouter_api_key` on `Settings`
- `apps/server/app/fs_oauth.py` (+ `sessions.py`) — `write_config` sibling writing sandbox `config.json`
- `eval/harness/e2e/` setup — stage `OPENROUTER_API_KEY` from `eval/.env` into `config.json`
- `eval/Setup.bat` — write `OPENROUTER_API_KEY` into `eval/.env`

*Electron viewer (fast-follow):*
- `apps/electron/main` + `packages/viewer-ui` (+ `transport.ts`) — display the saved scan

**Keep + extend (not retire)**
- `packages/engine/plugin/agents/image-reader.md` — make `image_transcribe`
  the **sole** reader for every image; drop the inline `image_read`
  path; `model` stays **claude-sonnet-4-6** (the agent relays/formats text
  only — the hosted VLM does the OCR).
- `docs/specs/image-reader-agent-spec.md` — document the single-reader design.

## 15. Open questions for the researcher

1. ~~**Exact model + tier.**~~ RE-DECIDED 2026-08-30 (§4.5): `google/gemini-3.7-flash`.
   Was `qwen/qwen3-vl-235b-a22b-instruct`
   — Instruct, not Thinking; raw bytes. This is the §6.3 default.
2. ~~**Does prep help, and which steps?**~~ RESOLVED (PR 723): no — prep hurt
   accuracy and doubled hallucinations. No `jimp`.
3. **Prompt/language hinting.** Does the reader benefit from a language hint
   ("German church register, Kurrent script") in the OCR prompt, or does the
   reuse-`image-reader.md` prompt suffice?
4. **OpenRouter rate limits / latency / provider routing** for the chosen
   model, and whether `provider.data_collection: "deny"` narrows availability
   or raises cost.
5. **Privacy sign-off.** Is sending FS record scans to OpenRouter acceptable
   (§11)? Policy call for Dallan.
6. ~~**Partial-win handling.**~~ RESOLVED (PR 723): one model is the sole reader
   for all record types incl. German — no per-record-type split. A Sonnet-5 second
   opinion was considered and dropped (the viewer lets a human verify a
   cite-worthy read against the scan; a user-invoked Opus transcription is
   parked in §15.9 below).
7. **Batching / cost.** Worth a multi-image call later, or is one-per-call
   fine? (Kept out of v1.)
8. ~~**Fallback if OpenRouter is down** at runtime.~~ RESOLVED 2026-08-30 — see
   §5.9. Degrade to a clean NOT-READ→pivot-to-indexes still holds, but only
   after **one** bounded retry on a transport failure.
9. **User-invoked Opus transcription ("Flow 2") — parked, not requested.**
   Brainstormed alongside this spec and never asked for by a user, so it is
   recorded here rather than carried as work. The research workflow stays on
   **one default reader**; this would let a user ask Claude to transcribe *one specific*
   image with **Opus** on demand (premium, higher accuracy). Recommended shape:
   a user-only tool `image_transcribe_opus`, a thin wrapper over the same
   host-side OCR helper with the model pinned to an Opus slug **via OpenRouter**
   (so it inherits any-size + text-out + no base64 — the bytes never cross the
   MCP stdio transport), which the research skills do **not** list in
   `allowed-tools`; invoked by the main session on request or a
   `/transcribe-image` command. Present the transcription; optionally write it
   into the source's `transcription` (the tool can already persist the scan via
   `projectPath`). Ideal future UX: a "Transcribe with Opus" button in the
   viewer beside the saved scan — needs a viewer→action channel. Open impl
   detail: Opus via OpenRouter (reuses the key; may lag the latest 4.8) vs the
   Anthropic API directly (latest, needs an Anthropic-key path). Revisit only
   on a real user request.

## 16. References

- `docs/record-extraction-consolidation-closing-report.md` §1 (T13)
- `docs/specs/image-read-spec.md` (`image_read`'s inline-base64 path is no
  longer used by the `image-reader` subagent; it stays only for the Issue #28
  pixel consumer, and its transport floor still guards that single read)
- `docs/specs/image-reader-agent-spec.md` (the subagent — **kept**; single
  reader via `image_transcribe`; its OCR prompt/output protocol is reused
  verbatim)
- `~/pioneeracademy/book-to-tree/backend/src/book_to_tree/ocr/image_prep.py`
  (`enhance_for_ocr` — the prep pipeline the spike evaluated and rejected; §7)
- `src/tools/wiki-search.ts` + `tests/tools/wiki-search.test.ts` (HTTP-tool
  and mocked-`fetch` test patterns to mirror)
- `src/auth/config.ts` (`loadConfig`/`saveConfig`/`get*` — key-storage
  pattern to follow)
- `docs/skill-lifecycle.md` §5 (lane rule for the SKILL.md migration)
