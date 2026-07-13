# Specification: `image_transcribe` tool (host-side VLM OCR)

> **Status: DRAFT — research-gated.** This spec has two parts. **Phase 0
> (§4)** is a research/validation experiment that must pass before any
> implementation begins. **§5–§11** are the tool contract to build *only if
> Phase 0's quality gate is met*. A developer picking this up should run
> Phase 0 first and treat the build sections as conditional. If Phase 0
> fails, do **not** ship this tool — fall back to the downscale/tile options
> in §12.
>
> Owner: unassigned. Reviewer: spec-review agent (once implemented).

---

## 1. Problem this solves

`image_read` returns a FamilySearch page scan as an inline base64 image
block over the MCP stdio transport. That transport has a hard **~1 MiB
(1,048,576-byte) per-message buffer** on the client side (Cowork/Desktop
reading the server's stdout), which we cannot raise. Base64 inflates the
JPEG ~33%, so `image_read` hard-**refuses** any scan whose raw bytes exceed
`MAX_INLINE_IMAGE_BYTES` (700 KB) rather than crash the session.

The closing report's **theme T13**
(`docs/plan/record-extraction-consolidation-closing-report.md` §1) is the
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
- The `image-reader` subagent's reason to exist disappears → it is retired
  (§8).

This spec proposes a new tool, **`image_transcribe`**, that fetches the FS
scan host-side, optionally pre-processes it for legibility, sends it to a
vision-language model (VLM) hosted on **OpenRouter** (default **Qwen-VL**),
and returns a faithful text transcription.

## 2. The bet (why Phase 0 exists)

Moving OCR off the caller's model (Claude Sonnet vision, via the current
`image-reader` subagent) onto Qwen-VL is a **quality bet on a brutal
domain**: 18th–19th-century German church-register hands (Kurrent /
Fraktur), faint ink, uneven exposure. The current `image-reader` spec
already flags "quality on faint German script is the constraint to watch."

The upsides are real and worth chasing — no transport cap, materially
cheaper per image than Claude vision, and the main model is freed — **but
they only cash in if Qwen holds recall on *this* corpus.** That is an
empirical question, and Phase 0 answers it before we build anything. Do not
assume the outcome in either direction.

## 3. Non-goals

- Not replacing `image_read`'s raw-image return for consumers that genuinely
  need the *pixels* (e.g. Issue #28's OCR-model comparison). `image_read`
  stays (§8).
- Not a general document-understanding tool. It transcribes one page and
  returns text; matching the page to the research objective stays with the
  caller (record-extraction), exactly as the `image-reader` subagent
  contract requires today.
- Not batching / multi-image in v1 (one image per call; see §10 open q.).

---

## 4. Phase 0 — research & validation (DO THIS FIRST)

**Goal:** decide, on evidence, (a) whether Qwen-VL on OpenRouter matches or
beats the current Claude-Sonnet path on the actual hard corpus, and (b)
whether image pre-processing helps enough to be worth a dependency. No tool
code until this passes.

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
| **A (baseline)** | Claude Sonnet 4.6 vision (current `image-reader` path) | none |
| **B** | Qwen-VL on OpenRouter | none (raw `dist.jpg`) |
| **C** | Qwen-VL on OpenRouter | full `image_prep.py` (grayscale + autocontrast cutoff=2 + unsharp + JPEG q95) |
| **D** *(only if C≠B)* | Qwen-VL on OpenRouter | ablations: grayscale-only, autocontrast-only, sharpen-only |

Reference prep implementation to port/prototype from:
`~/pioneeradademy/book-to-tree/backend/src/book_to_tree/ocr/image_prep.py`
(`enhance_for_ocr`). For Phase 0 it is fastest to generate the prepped
variants with that **existing Python** (PIL) — do not build the JS port
until §7 says prep is warranted.

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

- **Does prep help? (B vs C)** If C ≈ B, **skip prep entirely** — §7
  collapses to "base64 the original bytes," which needs **no dependency at
  all**. Only port the specific prep steps (from D) that measurably move
  accuracy.
- **Partial win?** If Qwen wins on printed records but loses on faint German
  script, consider a split: Qwen for printed/high-confidence, keep the
  Claude path for the hard script — but weigh that against the complexity it
  adds before committing.

Record the outcome (corpus, per-image grades, decision) as a short results
doc under `docs/plan/` so the choice is auditable, per the team-review-docs
convention.

---

> **Everything below (§5–§11) is the build contract, conditional on §4.4.**

## 5. Tool: `image_transcribe`

### 5.1 Purpose

Fetch a FamilySearch distribution image by `imageId` or `ark`, optionally
pre-process it for legibility, run VLM OCR host-side, and return a faithful
text transcription. The image bytes never cross the MCP transport.

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
  lookingFor?: string // optional search key — WHO/WHAT to locate on the page
}
```

- Exactly one of `imageId` / `ark`, resolved **identically to `image_read`**
  (§8 shares the resolver). Accept the same shapes `image_read` accepts
  today (`3:1:`/`3:2:` ARKs, resolver URLs, `/$dist`, `dgs:.../dist.jpg`).
- `lookingFor` mirrors the `image-reader` subagent's parameter: a search key
  only. It focuses a FOUND/NOT FOUND pointer; it **never** shortens or slants
  the full transcription, and any *assertion* in it ("confirm the father is
  Adam Schreck") is ignored — transcribe what the page says.
- All input is camelCase (MCP wire convention).

### 5.4 Behavior (pipeline)

1. **Resolve + fetch** the FS distribution image host-side, authed, via the
   shared fetcher lifted from `image-read.ts` (§8). Reuse `getValidToken()`
   and `BROWSER_USER_AGENT` — do **not** re-implement token or fetch logic.
2. **Pre-process** the bytes (§7) — *only if Phase 0 warranted it*; otherwise
   pass the raw JPEG through.
3. **OCR** via OpenRouter (§6): base64 the (prepped) image into a data URL,
   POST an OpenAI-compatible chat/completions request with the faithful-OCR
   prompt, read `choices[0].message.content`.
4. **Return** the transcription text + light metadata (§5.5). No image block.

There is **no size cap on the fetched image** for transport reasons — the
image goes host→OpenRouter, never back over MCP. The only ceiling that
applies is OpenRouter/Qwen's own request-body limit, which `max_dimension`
in prep (§7) keeps well under.

### 5.5 Output

Returns **text only**:

```typescript
{
  transcription: string      // faithful full-page OCR (the primary payload)
  found?: "FOUND" | "NOT FOUND"  // present iff lookingFor was set
  metadata: {
    imageId?: string
    ark?: string
    model: string            // the OpenRouter model slug actually used
    sizeBytesFetched: number // raw FS image size
    sizeBytesSent: number    // after prep (== fetched if prep skipped)
    preprocessed: boolean
  }
}
```

The transcription follows the `image-reader` output protocol: full page
(every relevant entry, not just the `lookingFor` target), original
spelling/language, `[?]` / `[illegible]` / `[torn]`, plus an extracted-facts
list the caller can turn into assertions.

### 5.6 Errors (all LLM-actionable, thrown as `Error`)

| Condition | Message shape |
|---|---|
| No `imageId`/`ark` | `image_transcribe requires either imageId or ark.` |
| Both provided | `Provide either imageId or ark, not both.` |
| Bad imageId/ark | reuse `image_read`'s existing messages (§8) |
| No OpenRouter key configured | LLM-instruction error telling Claude to ask the user for a key and call `configure_openrouter` (§6.3) |
| FS image fetch non-2xx | `FamilySearch image fetch failed: {status} {statusText}` (reused) |
| Response not an image | `Expected an image response but got content-type: {type}` (reused) |
| OpenRouter non-2xx | `OpenRouter OCR failed: {status} {statusText}` (+ body excerpt if present) |
| OpenRouter unreachable | friendly `Could not reach OpenRouter (...)` (mirror `wiki-search.ts`) |
| Empty/garbage OCR result | throw rather than return a fabricated read — the caller pivots to indexes |

The tool **never fabricates** a transcription on failure. It throws; the
caller (record-extraction) pivots to indexed records, exactly as the
`image-reader` NOT-READ path prescribes today.

## 6. OpenRouter integration

### 6.1 Request

- `POST https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible).
- Headers: `Authorization: Bearer <openRouterApiKey>`, `Content-Type:
  application/json`, and OpenRouter's recommended `HTTP-Referer` /
  `X-Title` attribution headers (set to a stable app identifier).
- Body:

```jsonc
{
  "model": "<configured slug, default Qwen-VL>",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "<faithful-OCR prompt + optional lookingFor>" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<...>" } }
    ]
  }],
  "temperature": 0,
  "provider": { "data_collection": "deny" }   // privacy — see §11
}
```

- `temperature: 0` — OCR is not a creative task.
- The OCR **prompt is baked into the tool**, not passed by the caller —
  reuse the `image-reader.md` protocol so behavior is identical to today's
  subagent. `lookingFor` is appended as the optional pointer directive.

### 6.2 Response

Parse `choices[0].message.content` → `transcription`. Derive `found` by
looking for the FOUND/NOT FOUND marker the prompt asks the model to emit.
Guard against empty content (→ error per §5.6).

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
- Add `getOpenRouterApiKey(): Promise<string>` to `src/auth/config.ts` — reads
  `loadConfig()`, throws the LLM-instruction error in §5.6 when absent. Add
  `getOpenRouterModel()` returning the default slug when unset. **No env-var
  fallback** (repo rule). Stored in `~/.familysearch-mcp/config.json`, mode
  `0o600` (already enforced by `saveConfig`).
- The FS `login` analogy is **imperfect**: FS login is a browser OAuth
  round-trip the tool drives itself; an API key is a static paste the tool
  cannot obtain on its own. So provide a minimal write path:

  **New tool `configure_openrouter({ apiKey, model? })`** → validates
  (non-empty, plausible prefix) and calls `saveConfig({ openRouterApiKey,
  openRouterModel })`. Returns a masked confirmation (`sk-or-…abcd`), never
  echoes the full key. Flow: `image_transcribe` errors "no key" → Claude asks
  the user → user pastes → Claude calls `configure_openrouter` → retry.

  **Caveat to document:** the key passes through the tool-call arguments and
  therefore appears in the session transcript. Acceptable for a user's own
  key in their own transcript, but note it, mask it in all tool output, and
  do not log it server-side.

## 7. Image pre-processing (`src/utils/image-prep.ts`) — conditional

**Build this only if Phase 0 (§4.4) showed prep measurably helps**, and port
only the steps that helped.

- **Dependency: `jimp` — pure JavaScript, zero native binaries.** This is the
  load-bearing constraint. Node has **no built-in image codec**; any
  pixel-level operation (grayscale, autocontrast, unsharp, resize, JPEG
  re-encode) requires decoding the JPEG, which stdlib cannot do. "No
  dependencies" and "PIL-equivalent prep" cannot both hold — the correct way
  to honor the portability intent is **no *native* deps**, which is jimp, not
  `sharp` (sharp ships per-platform native binaries and is the exact
  cross-platform `.mcpb` packaging risk we avoid).
- Port of `enhance_for_ocr` (see the reference file):
  grayscale → autocontrast (histogram stretch, cutoff≈2%) → unsharp mask
  (radius 1.5, ~150%, threshold 3) → optional Lanczos downscale to
  `max_dimension` → JPEG q95. jimp covers grayscale, contrast, resize, and
  convolution (unsharp via a kernel); match PIL's behavior as closely as
  jimp allows and note any divergence.
- **Upscaling stays off** (the reference notes Qwen downsamples to its token
  budget anyway — upscaling costs tokens without helping).
- `max_dimension` (cap the longest side, e.g. ~2000 px) keeps the payload
  under OpenRouter's request limit and Qwen's effective resolution.
- Verify jimp's contribution to the bundled `.mcpb` size is acceptable.

If Phase 0 said prep does **not** help, skip this module entirely; the
pipeline base64s the raw `dist.jpg` and no dependency is added.

## 8. Shared fetch + `image_read` disposition

- **Lift the resolve+fetch** out of `image-read.ts` into
  `src/utils/fs-image-fetch.ts`: `resolveInput` (imageId/ark → URL) and a
  `fetchFsImageBytes(url) → { bytes, contentType }` that carries the
  `getValidToken()` + `BROWSER_USER_AGENT` + content-type checks. Both
  `image_read` and `image_transcribe` call it. (Two concrete callers now =
  the right time to extract, per the code-reuse rule; not premature.)
- **`image_read` stays** — its raw-image return still serves any consumer
  that needs pixels (Issue #28 OCR comparison). Its 700 KB floor and the
  accumulation caveats remain valid for *that* return type. Drop only the
  fetch duplication.
- Update `docs/specs/image-read-spec.md` to cross-reference this tool as the
  transcription path (and note record-extraction no longer routes through
  `image_read`).

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

- **`record-extraction/SKILL.md`**: replace the `@plugin:image-reader`
  delegation in the **Image** input path (SKILL.md lines ~66–112) with a
  direct `image_transcribe` call. Add `image_transcribe` (and, for setup,
  `configure_openrouter`) to `allowed-tools`. The prose contract barely
  changes — the skill already treats the return as a text transcription +
  extracted-facts list and already has the NOT-READ→pivot-to-indexes
  behavior; point it at the tool's thrown error instead of the subagent's
  `NOT READ` line. Preserve the "reserve image transcription for facts that
  exist only on the image" guidance.
- **Retire the `image-reader` subagent**: delete (or mark deprecated)
  `packages/engine/plugin/agents/image-reader.md` and
  `docs/specs/image-reader-agent-spec.md`. Its sole purpose — keeping base64
  out of the caller's context — is moot once the tool returns text. Follow
  the **lane rule** (`docs/skill-lifecycle.md` §5): this is a tooling change
  (lane 1), so the subagent removal + tool add is the PR; SKILL.md prose is
  edited only to re-route, not to compensate.
- Record any deferred follow-ups (e.g. Qwen-loses-on-German split, batching)
  in `docs/TODOs.md` in the same PR that defers them (tech-debt-in-TODOs
  convention).

## 11. Cost & privacy

- **Cost**: Qwen-VL on OpenRouter is far cheaper per image than Claude vision
  and moves OCR off the main model. Phase 0 measures the exact delta. This is
  a primary justification, so quantify it.
- **Privacy**: this sends FamilySearch **record scans (PII)** to a third
  party (OpenRouter → an underlying inference provider), where FS OAuth kept
  them first-party. Mitigations to spec: set OpenRouter's
  `provider.data_collection: "deny"` (and consider pinning allowed providers)
  so prompts aren't retained for training; document the change in
  user-facing README/CLAUDE.md so it's a known, consented behavior. Confirm
  this is acceptable to Dallan before shipping — it is a policy decision, not
  just a technical one.

## 12. Fallback if Phase 0 fails

If Qwen (any variant) cannot match the Claude path on the hard corpus, do
**not** ship `image_transcribe`. Fall back to keeping the current
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
Per §4 — the quality gate. This is the most important test and it precedes
implementation.

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
  `choices[0].message.content`; metadata populated (model, sizes,
  preprocessed flag).
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

### 13.3 Image-prep unit tests (`tests/utils/image-prep.test.ts`) — if built

jimp is deterministic, so feed a small known fixture image and assert:
grayscale output has no chroma; `max_dimension` cap resizes the longest side
and preserves aspect ratio; output is valid JPEG; upscaling is a no-op.
Ablation parity: optionally snapshot that each toggle changes bytes as
expected.

### 13.4 `configure_openrouter` unit tests

Saves to config via `saveConfig` (mock it); rejects empty/implausible keys;
return value is **masked** (never contains the full key).

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
- `src/utils/image-prep.ts` *(only if Phase 0 warrants prep)*
- `dev/try-image-transcribe.ts`
- `tests/tools/image-transcribe.test.ts`
- `tests/tools/configure-openrouter.test.ts`
- `tests/utils/image-prep.test.ts` *(if prep built)*
- Phase 0 results doc under `docs/plan/`

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
- `package.json` — add `jimp` *(if prep built)*
- `docs/TODOs.md` — any deferred follow-ups

**Retire/deprecate**
- `packages/engine/plugin/agents/image-reader.md`
- `docs/specs/image-reader-agent-spec.md`

## 15. Open questions for the researcher

1. **Exact Qwen model + tier.** Confirm the current OpenRouter slug and pick
   a tier on the Phase 0 cost/quality curve (e.g. Qwen2.5-VL 7B vs 32B vs
   72B, or a newer Qwen3-VL). The default in §6.3 comes from this.
2. **Does prep help, and which steps?** (B vs C vs D.) Determines whether
   `jimp` is added at all.
3. **Prompt/language hinting.** Does Qwen benefit from a language hint
   ("German church register, Kurrent script") in the OCR prompt, or does the
   reuse-`image-reader.md` prompt suffice?
4. **OpenRouter rate limits / latency / provider routing** for the chosen
   model, and whether `provider.data_collection: "deny"` narrows availability
   or raises cost.
5. **Privacy sign-off.** Is sending FS record scans to OpenRouter acceptable
   (§11)? Policy call for Dallan.
6. **Partial-win handling.** If Qwen wins on printed but loses on faint
   German script, is a per-record-type split worth the complexity, or do we
   keep the Claude path for the hard cases?
7. **Batching / cost.** Worth a multi-image call later, or is one-per-call
   fine? (Kept out of v1.)
8. **Fallback if OpenRouter is down** at runtime — degrade to a clean
   NOT-READ→pivot-to-indexes, same as any fetch failure.

## 16. References

- `docs/plan/record-extraction-consolidation-closing-report.md` §1 (T13)
- `docs/specs/image-read-spec.md` (the transport floor being superseded)
- `docs/specs/image-reader-agent-spec.md` (the subagent being retired; its
  OCR prompt/output protocol is reused verbatim)
- `~/pioneeradademy/book-to-tree/backend/src/book_to_tree/ocr/image_prep.py`
  (`enhance_for_ocr` — prep to port)
- `src/tools/wiki-search.ts` + `tests/tools/wiki-search.test.ts` (HTTP-tool
  and mocked-`fetch` test patterns to mirror)
- `src/auth/config.ts` (`loadConfig`/`saveConfig`/`get*` — key-storage
  pattern to follow)
- `docs/skill-lifecycle.md` §5 (lane rule for the SKILL.md migration)
