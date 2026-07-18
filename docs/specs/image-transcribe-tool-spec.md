# Specification: `image_transcribe` tool (host-side VLM OCR)

> **Status: Phase 0 PASSED — build approved (spike PR 723).** This spec was
> research-gated: **Phase 0 (§4)** had to clear a quality gate before the
> **§5–§11** build contract could proceed. It did (see the revision note
> below), so the build is unblocked and the §12 fallback is not triggered.
> §4 is retained as the record of the experiment that was run.
>
> Owner: unassigned. Reviewer: spec-review agent (once implemented).
>
> **Revision (2026-07-17) — three changes from the original draft, per a
> design review:**
> 1. **Hybrid, not full replacement.** Claude's own vision (`image_read` +
>    the `image-reader` subagent) is **kept** for small images (≤700 KB);
>    `image_transcribe` handles only the large scans `image_read` refuses.
>    The `image-reader` subagent is **not retired** — it gains
>    `image_transcribe` as an oversize fallback. Collapsing to Qwen-only
>    stays a spike-gated future option, not an upfront move.
> 2. **Image persistence + viewing (§8.5).** The backing JPEG is saved for
>    **retained** sources so the Electron viewer (then the hosted web
>    viewer) can show the scan beside its transcription.
> 3. **Key handling stays config-only (§6.4–§6.5)** — the MCP server reads
>    the key only from `~/.familysearch-mcp/config.json`, never from env —
>    with two orchestration-layer bridges added for e2e and the hosted
>    sandbox.
>
> **Phase 0 is COMPLETE — spike PR 723 (`docs/plan/ocr-quality-spike-results.md`).**
> The gate passed: build the tool and route large scans to **Qwen3-VL-235B
> Instruct, raw bytes — no pre-processing** (prep *lowered* accuracy and
> doubled hallucinations, so §7's `jimp` path is dropped, not built). Bonus:
> **Sonnet 5 ≫ Sonnet 4.6 for OCR**, so the `image-reader` small-image path is
> bumped 4.6 → 5 (see its spec §4). The one open item is a German
> Kurrent/Fraktur pass — the domain the bet is framed around, untested by the
> spike.

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

For the **large** scans `image_read` refuses today, this is a clean win.
But we deliberately **keep** Claude's own vision (`image_read` + the
`image-reader` subagent) for **small** images — Claude's genealogical
judgment on a scan it can already read is worth preserving, and Phase 0
(§4) tests whether Qwen matches it. So `image_transcribe` is the
**large-image path**, and the `image-reader` subagent stays as the
small-image reader that **routes** oversize reads to it (§8). The
subagent is not retired; its base64-isolation job simply no longer
applies to the large-image path.

This spec proposes a new tool, **`image_transcribe`**, that fetches the FS
scan host-side and sends the raw bytes to a vision-language model (VLM)
hosted on **OpenRouter** (default **Qwen3-VL-235B Instruct**), returning a
faithful text transcription.

## 2. The bet (why Phase 0 exists)

Moving OCR off the caller's model (Claude Sonnet vision, via the current
`image-reader` subagent) onto Qwen-VL is a **quality bet on a brutal
domain**: 18th–19th-century German church-register hands (Kurrent /
Fraktur), faint ink, uneven exposure. The current `image-reader` spec
already flags "quality on faint German script is the constraint to watch."

The upsides are real and worth chasing — no transport cap, materially
cheaper per image than Claude vision, and the main model is freed — **but
they only cash in if Qwen holds recall on *this* corpus.** That was an
empirical question, and Phase 0 answered it (PR 723): Qwen Instruct clears
the bar on the hard subset, so the tool is built. (German Kurrent/Fraktur
remains untested — the one open item.)

## 3. Non-goals

- Not replacing `image_read`'s raw-image return for consumers that genuinely
  need the *pixels* (e.g. Issue #28's OCR-model comparison). `image_read`
  stays (§8).
- Not replacing Claude's own vision for **small** images. `image_read` +
  the `image-reader` subagent stay the reader for scans under the 700 KB
  ceiling; `image_transcribe` is the large-image path (§1, §8).
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
`~/pioneeradademy/book-to-tree/backend/src/book_to_tree/ocr/image_prep.py`
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
- **Partial win?** The design already **keeps Claude for small images**, so
  a split is the default, not an exception: `image_transcribe`/Qwen covers
  the large scans Claude can't take, and `image_read`/Claude keeps the
  small ones. What Phase 0 additionally decides is whether Qwen is strong
  enough to *also* take the small/hard cases (letting us later simplify to
  Qwen-only) or whether Claude clearly wins there (locking in the split).

Record the outcome (corpus, per-image grades, decision) as a short results
doc under `docs/plan/` so the choice is auditable, per the team-review-docs
convention.

---

> **Everything below (§5–§11) is the build contract, conditional on §4.4.**

## 5. Tool: `image_transcribe`

### 5.1 Purpose

Fetch a FamilySearch distribution image by `imageId` or `ark`, run VLM OCR
host-side, and return a faithful text transcription. The image bytes never
cross the MCP transport.

This is the **large-image path**. Small images (≤700 KB) are still read by
Claude's own vision via `image_read` inside the `image-reader` subagent;
`image_transcribe` handles the scans `image_read` refuses (and, if Phase 0
shows Qwen matches Claude even on small scans, may later take those too —
a follow-up decision, not this spec's default). Routing lives in the
`image-reader` subagent (§8).

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
  projectPath?: string // absolute project-folder path; supply to stage the JPEG (§8.5)
}
```

- Exactly one of `imageId` / `ark`, resolved **identically to `image_read`**
  (§8 shares the resolver). Accept the same shapes `image_read` accepts
  today (`3:1:`/`3:2:` ARKs, resolver URLs, `/$dist`, `dgs:.../dist.jpg`).
- `lookingFor` mirrors the `image-reader` subagent's parameter: a search key
  only. It focuses a FOUND/NOT FOUND pointer; it **never** shortens or slants
  the full transcription, and any *assertion* in it ("confirm the father is
  Adam Schreck") is ignored — transcribe what the page says.
- `projectPath`, when given, makes the tool **stage** the fetched JPEG
  host-side under `<projectPath>/images/.staging/` and return a
  `stagedImageRef` (§8.5). Omit it (e.g. in the spike / dev smoke) to skip
  persistence and just get text. It is an absolute path the caller passes;
  the tool never invents one and validates it is inside the project.
- All input is camelCase (MCP wire convention).

### 5.4 Behavior (pipeline)

1. **Resolve + fetch** the FS distribution image host-side, authed, via the
   shared fetcher lifted from `image-read.ts` (§8). Reuse `getValidToken()`
   and `BROWSER_USER_AGENT` — do **not** re-implement token or fetch logic.
2. **No pre-processing** — the spike (PR 723) showed prep lowers accuracy, so
   the raw JPEG bytes go straight to OCR (no `jimp`; see §7).
3. **OCR** via OpenRouter (§6): base64 the raw image into a data URL, POST an
   OpenAI-compatible chat/completions request with the faithful-OCR prompt,
   read `choices[0].message.content`.
4. **Return** the transcription text + light metadata (§5.5). No image block.

There is **no size cap on the fetched image** for transport reasons — the
image goes host→OpenRouter, never back over MCP. The raw `dist.jpg` bytes are
sent as-is (no prep, §7); the spike (PR 723) confirmed Qwen3-VL reads the
large T13 scans that way with no body-limit issue. A pathological multi-MB
scan exceeding OpenRouter/Qwen's own request-body limit is an open risk, not
handled today.

### 5.5 Output

Returns **text only**:

```typescript
{
  transcription: string      // faithful full-page OCR (the primary payload)
  found?: "FOUND" | "NOT FOUND"  // present iff lookingFor was set
  stagedImageRef?: string    // present iff projectPath was given (§8.5, persistence increment) — e.g. "images/.staging/<imageId>.jpg"
  metadata: {
    imageId?: string
    ark?: string
    model: string            // the OpenRouter model slug actually used
    sizeBytes: number        // raw FS image size (sent to OCR as-is; no pre-processing)
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

  **New tool `configure_openrouter({ apiKey, model? })`** → validates the key
  is **non-empty** (no format/prefix check — OpenRouter's key format is not a
  stable contract, and a wrong key is caught cleanly at the first
  `image_transcribe` call via the 401→re-configure path) and calls
  `saveConfig({ openRouterApiKey, openRouterModel })`. Returns a masked
  confirmation (`sk-or-…abcd`), never echoes the full key. Flow: `image_transcribe` errors "no key" → Claude asks
  the user → user pastes → Claude calls `configure_openrouter` → retry.

  **Caveat to document:** the key passes through the tool-call arguments and
  therefore appears in the session transcript. Acceptable for a user's own
  key in their own transcript, but note it, mask it in all tool output, and
  do not log it server-side.

### 6.5 Key provisioning across runtimes

The server reads the key **only** from `~/.familysearch-mcp/config.json`
(`getOpenRouterApiKey`) — never from `process.env`, in any runtime. That is
the same file channel the MCP server already uses for the FS token
(`tokens.json`) and `wikiApiUrl`. Each runtime provisions that file with its
own mechanism; the env var (where one exists) is read at the
**orchestration layer**, never by the server:

| Runtime | Server runs | How `openRouterApiKey` reaches `config.json` |
|---|---|---|
| **Cowork desktop** | host (`.mcpb`) | the user pastes it → `configure_openrouter` → `saveConfig` |
| **Hosted web** | inside the E2B sandbox | Fly secret `OPENROUTER_API_KEY` → `config.py` `Settings.openrouter_api_key` → a `write_config(sandbox, {openRouterApiKey})` sibling of `fs_oauth.write_tokens`, written into the sandbox's `~/.familysearch-mcp/config.json` at session create (`sessions.py`) |
| **e2e harness** | node subprocess of the harness | the harness reads `OPENROUTER_API_KEY` from `eval/.env` and stages `openRouterApiKey` into the `~/.familysearch-mcp/config.json` the subprocess reads (consistent with e2e already depending on the developer's real `tokens.json` there) |

So the env var still does its job for e2e and the Fly control plane — both
of which legitimately read env — but it is **bridged** into the server's one
config channel rather than read by the server. This keeps the
"no env-var fallback" rule intact (the server has zero `process.env` reads)
while letting each runtime supply the key naturally. The hosted-path
`fs_oauth.write_tokens` (`TOKENS_PATH = {HOME}/.familysearch-mcp/tokens.json`,
called from `sessions.py:create_project`) is the exact pattern the
`write_config` sibling follows.

## 7. Image pre-processing — decided against (PR 723)

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
  `getValidToken()` + `BROWSER_USER_AGENT` + content-type checks. Both
  `image_read` and `image_transcribe` call it. (Two concrete callers now =
  the right time to extract, per the code-reuse rule; not premature.)
- **`image_read` stays** — its raw-image return still serves any consumer
  that needs pixels (Issue #28 OCR comparison). Its 700 KB floor and the
  accumulation caveats remain valid for *that* return type. Drop only the
  fetch duplication.
- Update `docs/specs/image-read-spec.md` to cross-reference this tool as the
  large-image transcription path, and note that the `image-reader` subagent
  now routes between `image_read` (small) and `image_transcribe` (large).

## 8.5 Image persistence + viewing (retained sources only)

`image_transcribe` returns text, but the researcher will want to **see the
scan** behind a transcription in the Electron viewer (and later the hosted
web viewer). Persist the JPEG — but only for sources the researcher keeps,
so projects don't bloat with every scan read.

**Staging → finalize (mirrors `results-staging.ts`).**
- When `projectPath` is given, `image_transcribe` stages the fetched JPEG
  host-side at `<projectPath>/images/.staging/<imageId>.jpg` — a
  **deterministic path keyed by imageId** (a new `src/utils/image-staging.ts`,
  following `results-staging.ts`) — and returns `stagedImageRef`. It does
  **not** write `research.json`. Because the path is derived from the imageId,
  `research_append` can finalize it **without** the ref being threaded back
  through the (text-only) `image-reader` subagent.
- When `research_append` persists an image-sourced source, it **finalizes**
  the staged JPEG (found at `images/.staging/<imageId>.jpg` for that source's
  imageId) to `<projectPath>/images/<source_id>.jpg` and sets a new
  `sources[].image_filename`. Staged images not finalized by the end of the
  write are discarded — so only **retained** sources keep a file: no orphans,
  no bloat. This is the same discipline the search-result sidecars use, and it
  pairs the image with the existing `sources[].transcription` field
  (`research-schema-spec.md` §5.5).

**Schema change — `sources[].image_filename`** (optional, nullable string).
A "new field" change with the full blast radius: edit `research.schema.json`
in **both** trees (`docs/specs/schemas/` and `packages/schema/schemas/`), the
prose table in `research-schema-spec.md`, the validator
(`packages/engine/mcp-server/src/validation/validator.ts`), and the
`packages/schema` TS mirror (`src/index.ts`). It is optional, so it does
**not** break `eval/fixtures/scenarios/*/research.json`. The validator's
orphan check must treat `images/` files referenced by a source as legitimate,
and unreferenced `images/*.jpg` as cleanup targets (not write-blocking).

**Viewing — Electron first, hosted web as a separate project.**
- **Electron:** the JPEG lives in the connected project folder, so
  `apps/electron/main` reads `images/<file>` and hands it to `viewer-ui` over
  the existing IPC transport; `viewer-ui` renders it beside the source's
  transcription (a `ResearchTransport` image-fetch method).
- **Hosted web:** the browser cannot read the sandbox filesystem — this is
  what `apps/server/app/image_proxy.py` (the **501 stub**) is a placeholder
  for. Wiring a real control-plane→sandbox image route is a **separate
  follow-on project**, not part of this spec's core DoD.

**Sequencing.** The core text-returning tool (§5–§7) ships first and is
useful on its own; image persistence + Electron viewing is a follow-up
increment; hosted-web viewing is its own project.

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
  to `@plugin:image-reader` (the subagent now handles the `image_read` →
  `image_transcribe` routing internally). The skill's prose contract barely
  changes — it still receives a text transcription + extracted-facts list and
  keeps the NOT-READ→pivot-to-indexes behavior. Thread `projectPath` through
  so the subagent's `image_transcribe` call can stage the JPEG (§8.5). For
  desktop setup, `configure_openrouter` is available so Claude can prompt for a
  key when `image_transcribe` errors "no key." Preserve the "reserve image
  transcription for facts that exist only on the image" guidance.
- **Keep the `image-reader` subagent; give it `image_transcribe` as a
  fallback.** It stays the small-image reader (Claude vision, base64 isolated
  in its throwaway context) and gains one branch: try `image_read`; on the
  oversize error (or a known-large image), call `image_transcribe` instead of
  the current pivot to "read the indexed record." It still returns **text
  only** to its caller, so record-extraction's contract is unchanged. Add
  `mcp__genealogy__image_transcribe` to the subagent's `tools:` and update
  `docs/specs/image-reader-agent-spec.md`. Follow the **lane rule**
  (`docs/skill-lifecycle.md` §5): this is a tooling change (lane 1).
  *(Fully retiring the subagent and routing all reads to Qwen stays a
  spike-gated future option — see §4.4 — not part of this change.)*
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
- `src/utils/image-staging.ts` *(image-persistence increment; mirrors `results-staging.ts`)*
- `dev/try-image-transcribe.ts`
- `tests/tools/image-transcribe.test.ts`
- `tests/tools/configure-openrouter.test.ts`
- Phase 0 results doc under `docs/plan/` *(done: `ocr-quality-spike-results.md`, PR 723)*

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
- `docs/TODOs.md` — any deferred follow-ups (e.g. the German Kurrent pass)

*Image-persistence increment (§8.5):*
- `src/tools/research-append.ts` — finalize the staged JPEG + set `image_filename`
- `docs/specs/schemas/research.schema.json` + `packages/schema/schemas/research.schema.json` — add `sources[].image_filename`
- `packages/schema/src/index.ts` — mirror `image_filename` on the `Source` type
- `packages/engine/mcp-server/src/validation/validator.ts` — allow `image_filename`; `images/` orphan handling
- `docs/specs/research-schema-spec.md` — `image_filename` prose row
- `packages/engine/plugin/skills/record-extraction/SKILL.md` — thread `projectPath` through

*Hosted + e2e key bridges (§6.5):*
- `apps/server/app/config.py` — `openrouter_api_key` on `Settings`
- `apps/server/app/fs_oauth.py` (+ `sessions.py`) — `write_config` sibling writing sandbox `config.json`
- `eval/harness/e2e/` setup — stage `OPENROUTER_API_KEY` from `eval/.env` into `config.json`
- `eval/Setup.bat` — write `OPENROUTER_API_KEY` into `eval/.env`

*Electron viewer (fast-follow):*
- `apps/electron/main` + `packages/viewer-ui` (+ `transport.ts`) — display the saved scan

**Keep + extend (not retire)**
- `packages/engine/plugin/agents/image-reader.md` — add `image_transcribe` as
  an oversize fallback tool, and bump `model` 4.6 → **claude-sonnet-5** (spike
  PR 723: +18 pts on hard hands, cheaper + faster). Small-image path stays
  Claude vision.
- `docs/specs/image-reader-agent-spec.md` — document the fallback routing +
  the Sonnet 5 bump.

## 15. Open questions for the researcher

1. ~~**Exact Qwen model + tier.**~~ RESOLVED (PR 723): `qwen/qwen3-vl-235b-a22b-instruct`
   — Instruct, not Thinking; raw bytes. This is the §6.3 default.
2. ~~**Does prep help, and which steps?**~~ RESOLVED (PR 723): no — prep hurt
   accuracy and doubled hallucinations. No `jimp`.
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
- `docs/specs/image-read-spec.md` (the transport floor `image_transcribe`
  routes around for large scans; kept for small ones)
- `docs/specs/image-reader-agent-spec.md` (the subagent — **kept** as the
  small-image reader; it gains `image_transcribe` as an oversize fallback and
  its OCR prompt/output protocol is reused verbatim)
- `~/pioneeradademy/book-to-tree/backend/src/book_to_tree/ocr/image_prep.py`
  (`enhance_for_ocr` — the prep pipeline the spike evaluated and rejected; §7)
- `src/tools/wiki-search.ts` + `tests/tools/wiki-search.test.ts` (HTTP-tool
  and mocked-`fetch` test patterns to mirror)
- `src/auth/config.ts` (`loadConfig`/`saveConfig`/`get*` — key-storage
  pattern to follow)
- `docs/skill-lifecycle.md` §5 (lane rule for the SKILL.md migration)
