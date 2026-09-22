import type { Principal } from "../auth/principal.js";
import { getOpenRouterApiKey, getOpenRouterModel } from "../auth/config.js";
import {
  resolveFsImageInput,
  fetchFsImageBytes,
} from "../utils/fs-image-fetch.js";
import { saveSourceImage } from "../utils/image-store.js";
import { fetchWithTimeout, isFetchTimeout } from "../utils/http.js";
import { expandLookingFor } from "../utils/name-variants.js";
import { getProjectStore } from "../store/project-store.js";
import {
  classifyProjectPath,
  MISSING_PROJECT_PATH_MESSAGE,
  missingProjectDirMessage,
  noProjectResult,
  type NoProjectResult,
} from "../utils/project-io.js";
import { stageSearchResults, type StagedHandle } from "../utils/results-staging.js";
import type {
  ImageTranscribeInput,
  ImageTranscribeResult,
  OpenRouterChatResponse,
  StagedTranscription,
} from "../types/image-transcribe.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Browse budget (issue #1081, spec §5.8). From the (N+1)th distinct image in one
// image group in one project onward, a successful transcription carries an
// advisory `browseBudget` — the page read still returns in full; nothing is
// refused (a read persists nothing, so a wrong refusal would hard-block a
// researcher mid-browse with no reset but a server restart — the ADR-0011
// read-tool carve-out).
const BROWSE_BUDGET_IMAGES = 20;

// Distinct imageIds seen per (project, image-group), keyed
// `${projectPath}\0${imageGroup}`. Keyed by PROJECT too, deliberately: the MCP
// server process outlives one conversation, so a group-only key would tell a
// second project it had already browsed 20 pages on its first read. Process-
// lifetime, never persisted; re-reading an image already in the set does not
// advance the count. Follows place-search.ts's module-cache precedent.
const browseBudgetSeen = new Map<string, Set<string>>();

/** Test-only reset — the Map is module-level and persists across `it()` blocks,
 *  which `vi` mock resets do not clear. Mirrors `__clearPlaceSearchCacheForTests`. */
export function __clearBrowseBudgetForTests(): void {
  browseBudgetSeen.clear();
}

/**
 * Record this image against the (project, group) browse counter and return the
 * advisory once the group passes `BROWSE_BUDGET_IMAGES` distinct images.
 *
 * Returns `undefined` for an ark-only call: an ARK carries no image-group number,
 * so a hunt driven by `ark` is never counted (spec §5.8 known limitation).
 */
function recordBrowseAndCheckBudget(
  imageId: string | undefined,
  projectPath: string | undefined,
): ImageTranscribeResult["browseBudget"] {
  if (!imageId) return undefined;
  const imageGroup = imageId.split("_")[0];
  const key = `${projectPath ?? "<no-project>"}\0${imageGroup}`;
  let seen = browseBudgetSeen.get(key);
  if (!seen) {
    seen = new Set<string>();
    browseBudgetSeen.set(key, seen);
  }
  seen.add(imageId);
  if (seen.size <= BROWSE_BUDGET_IMAGES) return undefined;
  return {
    imageGroup,
    distinctImagesRead: seen.size,
    notice:
      `You have now transcribed ${seen.size} distinct images from image group ` +
      `${imageGroup} in this project. Page-by-page browsing rarely pays past this ` +
      `point. Log the browse with a negative outcome (research_log_append) and ` +
      `pivot to the indexed route — record_search, record_read, or fulltext_search ` +
      `— or ask the user whether to keep paging.`,
  };
}

// VLM OCR on a full page scan is the slowest call this server makes, and the
// budget has to clear a slow-but-genuine read without waiting out a hung one.
// Measured 2026-09-08 over 59 live reads on the current default model, the whole
// call runs p50 18.7s / p90 40.6s / max 50.1s. So 180s is not a latency budget
// but a hang-catcher, 3.6x the slowest healthy read. Sized in the spec, not
// guessed — re-measure there after a model change, and never from run-log
// timelines, which are per SDK message rather than per tool call. This budget
// holds only where the call is not bridged (the harnesses and the hosted
// control plane, both verified over stdio): in Cowork the device bridge aborts
// every MCP call at 60s, so any OCR past a minute is lost there regardless of
// this value. Whether the desktop `.mcpb` is bridged too has not been measured;
// see docs/architecture.md "Other environment differences that bite".
const OCR_TIMEOUT_MS = 180_000;

// Explicit output-token budget. Setting it makes the cap OURS and the
// truncation case reproducible. Note the DIRECTION: for the current default
// google/gemini-3.7-flash OpenRouter's /api/v1/models reports
// top_provider.max_completion_tokens = 65536 and we previously sent no
// `max_tokens`, so 16000 LOWERS the effective cap rather than raising it. It is
// still well above a page's content. Measured 2026-09-07 over the committed e2e
// run logs: of 455 image_transcribe calls, 219 are excluded by the harness's
// 14-day capture strip and 126 have a transcription size recoverable from the
// `full length N chars` marker (or an unelided summary). Over those 126 the
// largest is 6,443 chars (~1.6k output tokens), median 1,573; under the current
// default specifically, 36 calls with a max of 4,940 chars (~1.2k tokens).
// Re-derive by scanning eval/runlogs/e2e/** for that marker — NOT with
// `make e2e-transcribe-failures`, which reports reachability, not sizes.
// Treat it as a dated bound, not a proof: reasoning tokens draw on this SAME
// budget (Gemini is reasoning-capable and reasoning is not disabled), so a
// reasoning-heavy read could reach 16000 before the page ends.
// A cap that does bind surfaces as `truncated` (detection reads finish_reason
// AND native_finish_reason, case-insensitively), so it is visible, never silent.
export const OCR_MAX_TOKENS = 16000;

// The largest input the tool will send to the OCR model, in RAW bytes, on every
// input source (issue #2048). The bytes travel host→OpenRouter as a base64 data
// URL inside a JSON body, and the only documented limit in that chain is the
// default model's provider: Gemini's "inline image data limits your total
// request size (text prompts, system instructions, and inline bytes) to 20MB"
// (ai.google.dev, image-understanding). OpenRouter documents no request-body
// cap of its own. 14 MiB raw × 4/3 base64 = 19.6 MB, under 20 MB with the
// prompt. Refused with an actionable error rather than downscaled: image
// pre-processing was measured to LOWER accuracy and double hallucinations
// (spec §7, PR 723), and the engine ships no native binary. The figure is
// Gemini's; an `openRouterModel` override changes the true limit, and this
// stays a conservative constant. Uploads may be up to 25 MiB
// (apps/server sessions.py), so a 14–25 MiB upload is the case this names.
export const MAX_OCR_INPUT_BYTES = 14 * 1024 * 1024;

// The digest's bounded excerpt (issue #2489): enough for a caller to triage a
// staged transcription without asking for the full text.
const DIGEST_EXCERPT_CHARS = 300;

// One retry, transport failures only. Measured over the committed e2e corpus,
// 24 of 175 classifiable calls (14%) died at the transport with no socket code
// and 6 timed out; on one run two consecutive losses led the agent to declare
// the OCR route "network-unreachable in this environment" and abandon images
// for the rest of the run, concluding from an indexed namesake instead. Probes
// on both sides found the path healthy minutes later (70/70, then 46/46), so
// the failures are intermittent — which is what a single retry is for. Whether
// the transience is host-side or provider-side is still unclassified, and does
// not change this: a bounded retry is the right response either way.
const OCR_TRANSPORT_RETRIES = 1;
const OCR_TRANSPORT_RETRY_DELAY_MS = 1_000;

// OpenRouter attribution headers (recommended, not required). Stable app id.
const APP_REFERER = "https://github.com/PioneerAIAcademy/cowork-genealogy";
const APP_TITLE = "cowork-genealogy";

// The OCR prompt is baked into the tool (never caller-supplied) so behavior
// matches today's Claude-vision `image-reader` read: faithful full-page
// transcription, original spelling/language, illegible marked not guessed.
function buildOcrPrompt(lookingFor?: string): string {
  const base =
    "Transcribe every genealogically relevant entry on this record image " +
    "verbatim: names, dates, places, ages, relationships, sponsors/witnesses, " +
    "and any marginal notes. Preserve the original spelling, capitalization, " +
    "and line/row layout. Do not modernize or normalize. Mark anything you " +
    "cannot read [illegible] — never guess.";
  const key = lookingFor?.trim();
  if (key) {
    return (
      base +
      `\n\nAfter the transcription, on a final line, report whether the page ` +
      `mentions "${key}" by writing exactly FOUND or NOT FOUND. This is a ` +
      `locate hint only — it must not change or shorten the transcription above.`
    );
  }
  return base;
}

// Node's global `fetch` rejects with `TypeError: fetch failed` and hangs the
// real socket-level reason (ECONNRESET, ENOTFOUND, UND_ERR_*, a TLS error) off
// `.cause` — the bare `.message` is always the useless string "fetch failed".
// Walk that chain so the thrown "Could not reach OpenRouter" carries the code
// that tells host-side from provider-side (#1594). `AggregateError.errors` is
// flattened too — a DNS attempt arrives as a bundle. Depth- and cycle-bounded
// so a self-referential cause cannot loop. `fetchWithTimeout`'s own timeout
// error already carries a full message and no `.cause`, so it passes through
// unchanged.
function describeFetchError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const push = (label: string) => {
    if (label && !parts.includes(label)) parts.push(label);
  };
  const labelOf = (e: unknown): string => {
    if (!(e instanceof Error)) return String(e);
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" && code.length > 0
      ? `${code}: ${e.message}`
      : e.message;
  };
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 6 && current != null && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    push(labelOf(current));
    const agg = (current as { errors?: unknown }).errors;
    if (Array.isArray(agg)) for (const e of agg) push(labelOf(e));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" <- ") || "unknown error";
}

/**
 * The content type an uploaded file actually IS, decided by its magic bytes and
 * never by its extension — a `.jpg`-named PDF is sent as a PDF. Returns null for
 * anything the OCR model cannot read as a page.
 */
export function sniffContentType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return "application/pdf";
  }
  return null;
}

/**
 * Shape check on a `file` ref, before any I/O, so an obviously wrong value is
 * reported as such rather than as "not found". The store's containment check
 * (`FsProjectStore.readableReal`: realpath'd, symlink-aware) is the guard that
 * matters; this only names the common mistakes.
 */
function fileRefProblem(ref: string): string | null {
  const rule =
    "`file` is a project-relative POSIX path inside the project folder (e.g. uploads/scan.jpg): " +
    "no leading slash, no drive letter, no backslashes, no '.' or '..' segments.";
  if (ref.trim() === "") return `\`file\` is empty. ${rule}`;
  if (ref.includes("\\")) return `\`file\` '${ref}' contains a backslash — use '/'. ${rule}`;
  if (ref.includes("\u0000")) return `\`file\` contains a NUL character. ${rule}`;
  if (ref.startsWith("/") || /^[A-Za-z]:/.test(ref)) {
    return `\`file\` '${ref}' is an absolute path — it must be relative to projectPath. ${rule}`;
  }
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === "." || seg === "..") {
      return `\`file\` '${ref}' has an empty, '.' or '..' segment. ${rule}`;
    }
  }
  return null;
}

/** `capture:<basename without extension>` — the record-extraction id convention
 *  for a document that has no FamilySearch identifier. */
function captureIdFor(ref: string): string {
  const base = ref.split("/").pop() ?? ref;
  return `capture:${base.replace(/\.[A-Za-z0-9]+$/, "")}`;
}

function parseFound(text: string): "FOUND" | "NOT FOUND" | undefined {
  // The prompt asks for the marker on a FINAL line ("write exactly FOUND or
  // NOT FOUND"). Read the last non-empty line and require the marker at its
  // start, so body text like "infant found abandoned" cannot spoof it.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (/^\W*NOT\s+FOUND\b/i.test(last)) return "NOT FOUND";
  if (/^\W*FOUND\b/i.test(last)) return "FOUND";
  return undefined;
}

/**
 * OCR a FamilySearch page scan via a hosted VLM (OpenRouter, default
 * Gemini Flash) and return the transcription as text. The image bytes go
 * host-side → OpenRouter and never cross the MCP transport, so there is no
 * size cap (unlike image_read). See docs/specs/image-transcribe-tool-spec.md.
 */
export async function imageTranscribeTool(
  input: ImageTranscribeInput,
  principal: Principal,
  /**
   * Internal only — not on the MCP schema, so no caller across the tool
   * boundary can set it. person_read's memories phase runs every OCR under one
   * ~40s wall-clock budget; without a cap here a single call would keep its own
   * 180s hang-catcher and go on running after the phase had already given up on
   * it, burning an OpenRouter call nothing will read. Capping the underlying
   * fetch aborts it for real rather than abandoning the promise.
   */
  opts: { ocrTimeoutMs?: number; imageKey?: string } = {},
): Promise<ImageTranscribeResult | NoProjectResult> {
  // Exactly one input form, checked HERE: `resolveFsImageInput` is shared with
  // image_read and knows only the three FamilySearch shapes.
  const forms = (["imageId", "ark", "memoryArtifactUrl", "file"] as const).filter(
    (k) => typeof input[k] === "string" && input[k] !== "",
  );
  if (forms.length === 0) {
    throw new Error(
      "image_transcribe requires one of imageId, ark, memoryArtifactUrl, or file " +
        "(a project-relative path to an uploaded image or PDF, with projectPath).",
    );
  }
  if (forms.length > 1) {
    throw new Error(
      `Provide exactly one of imageId, ark, memoryArtifactUrl, or file — not ${forms.join(" and ")}.`,
    );
  }

  let bytes: Uint8Array;
  let contentType: string;
  let sizeBytes: number;
  let label: string;
  let apiKey: string;
  let model: string;

  if (input.file !== undefined) {
    // An uploaded image or PDF already inside the project folder (issue #2048).
    // No FamilySearch token — the bytes are the researcher's own upload, not an
    // FS-hosted scan — and no transport cap: the file goes host→OpenRouter only.
    // The project is classified FIRST so a folder that is not a project gets the
    // no-project ANSWER (#1695) rather than a key error or a path error.
    const cls = await classifyProjectPath(input.projectPath);
    if (cls === "missing_arg") {
      throw new Error(`${MISSING_PROJECT_PATH_MESSAGE} when \`file\` is given — the path is relative to it.`);
    }
    if (cls === "missing_dir") throw new Error(missingProjectDirMessage(input.projectPath));
    if (cls === "no_project") return noProjectResult("read");
    const projectPath = input.projectPath as string;

    const problem = fileRefProblem(input.file);
    if (problem) throw new Error(problem);

    // Resolve credentials/config BEFORE reading: a missing key should fail fast.
    apiKey = await getOpenRouterApiKey(principal);
    model = await getOpenRouterModel(principal);

    try {
      bytes = await getProjectStore().readBytes(projectPath, input.file);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new Error(
          `\`file\` '${input.file}' was not found under the project folder. Uploaded files ` +
            "live under uploads/<name>; check the exact name (it is case-sensitive).",
        );
      }
      if (code === "EISDIR") throw new Error(`\`file\` '${input.file}' is a directory, not a file.`);
      throw e; // the store's containment / regular-file refusals carry their own message
    }
    const sniffed = sniffContentType(bytes);
    if (!sniffed) {
      throw new Error(
        `\`file\` '${input.file}' is not an image or a PDF (by its content, not its name) — ` +
          "image_transcribe reads JPEG, PNG, GIF, WEBP and PDF. A text upload is read by sidecar_read.",
      );
    }
    contentType = sniffed;
    sizeBytes = bytes.length;
    label = input.file;
  } else {
    const resolved = resolveFsImageInput(input, "image_transcribe");
    label = resolved.label;

    // Resolve credentials/config BEFORE fetching the image: a missing key
    // should fail fast (and never leave a fetched scan unused). getOpenRouterApiKey
    // throws an LLM-actionable error naming config.json when absent.
    apiKey = await getOpenRouterApiKey(principal);
    model = await getOpenRouterModel(principal);

    const fetched = await fetchFsImageBytes(
      resolved.url,
      resolved.fallbackUrl,
      principal,
      resolved.memoryShape,
    );
    bytes = fetched.bytes;
    contentType = fetched.contentType;
    sizeBytes = fetched.sizeBytes;
  }

  if (sizeBytes > MAX_OCR_INPUT_BYTES) {
    throw new Error(
      `This ${contentType} is ${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB, over the ` +
        `${MAX_OCR_INPUT_BYTES / (1024 * 1024)} MiB the OCR request can carry (the model's ` +
        "documented 20 MB request limit, after base64 encoding). It was not sent. Ask the " +
        "user to re-save the image at a lower quality or resolution, or to split a " +
        "multi-page PDF into single pages, and upload that instead.",
    );
  }
  const dataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  // Expand recognized given names in lookingFor with historical diminutives
  // (issue #607). The VLM reads this as natural language, so all forms
  // (including scribal abbreviations with periods) are included.
  const lookingForExpansion = input.lookingFor
    ? expandLookingFor(input.lookingFor)
    : null;
  const expandedLookingFor = lookingForExpansion?.expanded ?? input.lookingFor;
  const prompt = buildOcrPrompt(expandedLookingFor);

  let response!: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetchWithTimeout(
        OPENROUTER_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": APP_REFERER,
            "X-Title": APP_TITLE,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: OCR_MAX_TOKENS,
            // Privacy: FamilySearch scans are PII — do not let the provider
            // retain prompts for training. See spec §11.
            provider: { data_collection: "deny" },
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: dataUrl } },
                ],
              },
            ],
          }),
        },
        Math.max(1, Math.min(opts.ocrTimeoutMs ?? OCR_TIMEOUT_MS, OCR_TIMEOUT_MS)),
      );
      break;
    } catch (error) {
      // Retry a TRANSPORT failure once; never a timeout. A timeout has already
      // spent OCR_TIMEOUT_MS, so a second attempt doubles the worst case — the
      // objection that kept a retry out until now. The transport branch is the
      // cheaper one to re-attempt, but only USUALLY: it catches every non-timeout
      // fetch rejection, which includes a reset after the request was sent and
      // inference may already have been billed. The corpus cannot separate those
      // — 0 of 30 recorded failures carry a socket cause code — so this is a
      // reasoned default, not a measured one. Re-check it once coded failures
      // accumulate.
      if (attempt >= OCR_TRANSPORT_RETRIES || isFetchTimeout(error)) {
        throw new Error(
          `Could not reach OpenRouter${attempt > 0 ? " (2 attempts)" : ""}. ` +
            `(${describeFetchError(error)})` +
            (attempt > 0
              ? " A retry already failed, so this is more than one transient blip" +
                " — but it is still one image, not a verdict on the network."
              : ""),
        );
      }
      await new Promise((r) => setTimeout(r, OCR_TRANSPORT_RETRY_DELAY_MS));
    }
  }

  // Auth failures are LLM-actionable — the key needs replacing in config.json. Transient
  // failures (429/5xx) are not; they surface as retryable, not a re-prompt.
  if (response.status === 401) {
    throw new Error(
      "The OpenRouter API key was rejected (401). Tell the user to update the " +
        "\"openRouterApiKey\" field in ~/.familysearch-mcp/config.json with a " +
        "current key from https://openrouter.ai/keys.",
    );
  }
  if (response.status === 402) {
    throw new Error(
      "OpenRouter reports the account is out of credits (402). Ask the user " +
        "to add credits at https://openrouter.ai.",
    );
  }
  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 300);
    } catch {
      // ignore — the status line is enough
    }
    throw new Error(
      `OpenRouter OCR failed: ${response.status} ${response.statusText}` +
        (body ? ` — ${body}` : ""),
    );
  }

  const data = (await response.json()) as OpenRouterChatResponse;
  const choice = data.choices?.[0];
  const transcription = choice?.message?.content?.trim() ?? "";

  // Output-token-cap truncation, computed BEFORE the empty-content guard: a cap
  // can bind while the model is still emitting reasoning tokens, leaving content
  // empty, so reading finish_reason only after a non-empty check would discard
  // the very signal this exists to surface (the empty read would misfile as an
  // unreadable scan). A cap is marked by finish_reason OR native_finish_reason —
  // OpenAI-normalized "length" or a provider's native "MAX_TOKENS" — matched
  // case-insensitively so a lowercase/odd-cased spelling (some models via
  // OpenRouter emit "max_tokens") is still caught, regardless of which field it
  // lands in. Out of scope: a model that stops early on its own ("stop", page
  // unfinished) and a transport cut (already thrown by fetchWithTimeout) — #1974.
  // `reason` is typed string|null but arrives via the unchecked `as
  // OpenRouterChatResponse` cast, so guard the type before `.trim()` — a number,
  // boolean, array or object would otherwise throw and turn a complete read into
  // a spurious tool error (the `=== "length"` this replaced could not throw).
  const marksCap = (reason: unknown): boolean => {
    if (typeof reason !== "string") return false;
    const v = reason.trim().toUpperCase();
    return v === "LENGTH" || v === "MAX_TOKENS";
  };
  const truncated =
    marksCap(choice?.finish_reason) || marksCap(choice?.native_finish_reason);

  if (transcription.length === 0) {
    // Throw either way — a zero-content read has nothing to return — but name
    // WHICH failure it was, so the invariant "truncated:true never ships beside
    // an empty transcription" holds while the caller still learns a cap bound.
    throw new Error(
      truncated
        ? "OpenRouter hit its output-token limit before returning any " +
            "transcription (the budget was likely spent on reasoning). The page " +
            "was not read — do not fabricate; a retry at this cap is unlikely to " +
            "help, so pivot to the indexed record (record_read / record_search)."
        : "OpenRouter returned an empty transcription. Do not fabricate a read — " +
            "pivot to the indexed record for this image (record_read / record_search).",
    );
  }

  // A capped read with content is non-empty, so it would otherwise pass as an
  // ordinary success. The transcription stays verbatim — the signal rides the
  // sibling fields below (spec §6.2).
  const truncationNotice = truncated
    ? "This transcription is INCOMPLETE — the OCR hit its output-token limit and " +
      "stopped partway down the page. The transcription above is what was read; the " +
      "rest of the page is UNREAD, not blank. Do not treat any target as absent from " +
      "this partial read."
    : undefined;

  // Persist the scan for a retained source (§8.5, design B) — best-effort: the
  // transcription is the primary payload, so a save failure (e.g. a bad
  // projectPath) omits imageRef rather than losing the text. A TTL sweep in
  // research_append GCs images no source ends up citing.
  let imageRef: string | undefined;
  // A `file` input is already retained at its own path inside the project; a
  // copy under images/ would be a second byte-copy the *.jpg GC and the viewer
  // do not expect, and citing an upload is document-capture's business (#2490).
  if (input.projectPath && input.file === undefined) {
    // SCANS ONLY, and enforced here rather than only in person_read's caller.
    // `imageFilenameFor` hardcodes `.jpg` and `gcUnreferencedImages` sweeps
    // `images/*.jpg`, so retaining a PDF writes PDF bytes under a .jpg name --
    // unreadable to the viewer and mis-swept by the GC. `memoryArtifactUrl`
    // newly accepts application/pdf and `projectPath` is on this tool's own
    // schema, so this path is reachable straight from the LLM; it is also
    // exactly the call a budget-skipped memory's note invites, and PDFs carry
    // the wills. The text is still returned -- only retention is refused.
    try {
      if (!contentType.toLowerCase().startsWith("image/")) throw new Error("not an image");
      imageRef = await saveSourceImage({
        projectPath: input.projectPath,
        // `label` is the caller's input verbatim, which for a memory artifact
        // is a whole URL -- it sanitizes to a ~70-character filename carrying
        // the host and the ctx param. person_read passes the memory id
        // instead, so the scan lands at images/<memory id>.jpg.
        imageKey: opts.imageKey ?? label,
        bytes,
      });
    } catch {
      imageRef = undefined;
    }
  }

  const browseBudget = recordBrowseAndCheckBudget(
    input.imageId,
    input.projectPath,
  );

  // Suppress found on a truncated read: the FOUND/NOT FOUND marker rides a final
  // line the model never reached, and a target may sit below the cut — a
  // half-read page must never yield a clean NOT FOUND negative (#1974).
  const key = input.lookingFor?.trim();
  const found = key && !truncated ? parseFound(transcription) : undefined;

  // Stage the transcription (issue #2489, merged into #2048): the same channel
  // the search tools use, as a ONE-element results[] so finalize's invariants
  // hold unchanged. Best-effort — the text is the primary payload, so a staging
  // failure yields `staged: null` + `stagingError`, never a tool error. The
  // digest is what a caller triages on without the full text.
  let staged: StagedHandle | null | undefined;
  let stagingError: string | undefined;
  let digest: ImageTranscribeResult["digest"];
  if (input.projectPath) {
    const id = input.file !== undefined ? captureIdFor(input.file) : label;
    const element: StagedTranscription = {
      id,
      source: {
        ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
        ...(input.ark !== undefined ? { ark: input.ark } : {}),
        ...(input.memoryArtifactUrl !== undefined ? { memoryArtifactUrl: input.memoryArtifactUrl } : {}),
        ...(input.file !== undefined ? { file: input.file } : {}),
      },
      content_type: contentType,
      size_bytes: sizeBytes,
      model,
      transcription,
      ...(truncated ? { truncated: true as const } : {}),
      ...(found ? { found } : {}),
    };
    try {
      staged = await stageSearchResults({
        projectPath: input.projectPath,
        tool: "image_transcribe",
        response: {
          query: { ...element.source, ...(input.lookingFor ? { lookingFor: input.lookingFor } : {}) },
          results: [element],
        },
      });
    } catch (error) {
      staged = null;
      stagingError = error instanceof Error ? error.message : String(error);
    }
    digest = {
      id,
      chars: transcription.length,
      excerpt: transcription.slice(0, DIGEST_EXCERPT_CHARS),
      ...(found ? { found } : {}),
      ...(truncated ? { truncated: true as const } : {}),
    };
  }

  return {
    transcription,
    ...(truncated ? { truncated: true as const, truncationNotice } : {}),
    ...(found ? { found } : {}),
    ...(imageRef ? { imageRef } : {}),
    ...(staged !== undefined ? { staged } : {}),
    ...(stagingError !== undefined ? { stagingError } : {}),
    ...(digest !== undefined ? { digest } : {}),
    ...(browseBudget ? { browseBudget } : {}),
    ...(lookingForExpansion && input.lookingFor
      ? {
          nameExpansion: {
            original: input.lookingFor,
            expanded: lookingForExpansion.expanded,
            expansions: lookingForExpansion.expansions,
          },
        }
      : {}),
    metadata: {
      ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
      ...(input.ark !== undefined ? { ark: input.ark } : {}),
      ...(input.file !== undefined ? { file: input.file } : {}),
      contentType,
      model,
      sizeBytes,
    },
  };
}

export const imageTranscribeToolSchema = {
  name: "image_transcribe",
  description:
    "OCR a FamilySearch page scan and return the transcription as TEXT. Use " +
    "this for large scans that image_read refuses (over its inline size cap): " +
    "the image is OCR'd host-side and never enters the conversation, so there " +
    "is no size limit. Also transcribes a FamilySearch MEMORY artifact " +
    "(memoryArtifactUrl), including a PDF, and an UPLOADED image or PDF already " +
    "inside the project folder (file, e.g. uploads/scan.jpg, with projectPath). " +
    "Provide exactly one of imageId, ark, memoryArtifactUrl, or file. Requires " +
    "FamilySearch auth (call login) for imageId/ark only; memoryArtifactUrl and " +
    "file need none. Needs an OpenRouter API key (set in " +
    "~/.familysearch-mcp/config.json if it reports no key). Inputs over 14 MiB " +
    "are refused with the remedy. With projectPath the transcription is also " +
    "staged host-side: hand `staged.resultsRef` to research_log_append as " +
    "stagedResultsRef, and triage on `digest` without re-reading the text.",
  inputSchema: {
    type: "object" as const,
    properties: {
      imageId: {
        type: "string",
        description:
          "FamilySearch Image Group Number NUMBER_NUMBER (e.g. 004884748_02613), " +
          "as returned by image_search.",
      },
      ark: {
        type: "string",
        description:
          "A FamilySearch document-image ARK when no imageId is available — " +
          "ark:/61903/3:1:... or 3:2:... (e.g. fulltext_search's `id`), a bare " +
          "3:1:.../3:2:... id, a resolver URL for one, or a resolved distribution URL. " +
          "IMPORTANT: some document-image ARKs are waypoints into a multi-image " +
          "film/register — the bare ARK can silently resolve to the WRONG image " +
          "within that group. If the record was reached via a FamilySearch page " +
          "URL carrying i=/cc=/groupId= query parameters (e.g. from the browser or " +
          "a citation), pass the FULL URL including them, not just the bare ARK — " +
          "those parameters are preserved and select the correct image.",
      },
      memoryArtifactUrl: {
        type: "string",
        description:
          "A FamilySearch memory artifact URL, as carried by a person_read " +
          "source that came from a person's memories (a scanned will, " +
          "certificate, obituary clipping or compiled history uploaded by a " +
          "relative). PDFs are supported here as well as images. Needs no " +
          "FamilySearch login.",
      },
      file: {
        type: "string",
        description:
          "A project-relative POSIX path to an uploaded image or PDF inside the " +
          "project folder — the hosted upload endpoint writes uploads/<name>. " +
          "Requires projectPath. JPEG, PNG, GIF, WEBP or PDF, decided by the " +
          "file's bytes, not its name. No FamilySearch login needed.",
      },
      lookingFor: {
        type: "string",
        description:
          "Optional: who or what to locate on the page. A search key only — on a " +
          "complete read it sets a FOUND/NOT FOUND pointer, but it never shortens " +
          "or slants the full transcription. The pointer is withheld on a " +
          "truncated read (`truncated: true`): a half-read page cannot support a " +
          "clean NOT FOUND, so `found` is absent there — judge from the returned " +
          "lines and treat the rest of the page as unread.",
      },
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project folder; required with `file`, optional " +
          "otherwise. When set, the transcription is staged host-side (`staged`, " +
          "`digest`) and a fetched FamilySearch scan is saved under images/ with its " +
          "project-relative path returned as imageRef, so a retained source can cite " +
          "it (image_filename) for viewer display.",
      },
    },
  },
};
