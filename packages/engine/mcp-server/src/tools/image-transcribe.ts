import type { Principal } from "../auth/principal.js";
import { getOpenRouterApiKey, getOpenRouterModel } from "../auth/config.js";
import { memoryPageId, resolveMemoryArtifactUrl } from "../utils/memories.js";
import {
  resolveFsImageInput,
  fetchFsImageBytes,
  extractImageContextQuery,
  foldImageArkInput,
  receivedKeys,
} from "../utils/fs-image-fetch.js";
import { imageViewerUrl } from "../utils/ark.js";
import { imageGroupPlace } from "../utils/image-group.js";
import {
  saveSourceImage,
  recordImageReadCap,
  projectScope,
} from "../utils/image-store.js";
import { expandLookingFor } from "../utils/name-variants.js";
import {
  runOcr,
  runFoundCheck,
  buildOcrPrompt,
  OCR_TIMEOUT_MS,
  OCR_MAX_TOKENS,
  MAX_OCR_INPUT_BYTES,
  withTranscriptionSlot,
} from "../utils/ocr.js";
import { checkImageBrowseCap, recordImageBrowse } from "../utils/browse-budget.js";
import { connectorUserId } from "../utils/user-limits.js";
import { monotonicNow } from "../utils/fs-budget.js";
import { getProjectStore } from "../store/project-store.js";
import {
  classifyProjectPath,
  MISSING_PROJECT_PATH_MESSAGE,
  missingProjectDirMessage,
  noProjectResult,
  type NoProjectResult,
} from "../utils/project-io.js";
import { stageSearchResults, type StagedHandle } from "../utils/results-staging.js";
import {
  compactImageTranscribeAnswer,
  normalizeTranscription,
  transcriptionDigest,
} from "../utils/staged-compaction.js";
import type {
  ImageTranscribeInput,
  ImageTranscribeResult,
  ImageTranscribeToolResponse,
  OpenRouterChatResponse,
  StagedTranscription,
} from "../types/image-transcribe.js";

// Re-exported so existing importers (tests, dev/probe-ocr-finish-reason.ts) keep
// their import path after the extraction to src/utils/ (issue #2183).
export { OCR_MAX_TOKENS, MAX_OCR_INPUT_BYTES };

// Connector time budget (self-hosted beta E5, issue #3996). Claude's per-call
// timeout was measured at 230s (issue #3529 item 4, 2026-11-08); 180s leaves
// room for the trip both ways and the staging write. The deadline starts when
// the tool is entered (`enteredAt` below), so the Memories lookup, the fetch
// and the OCR all spend from it. Applies only to a connector-surface caller
// (`connectorUserId(principal) !== undefined`); LOCAL and the worker keep
// today's unbudgeted behavior (the 90s fetch + its fallback, the full 180s
// `OCR_TIMEOUT_MS`).
const CONNECTOR_TRANSCRIBE_BUDGET_MS = 180_000;

// Well under the budget: the download leg measures p50 1.9s / max 8.0s
// (fs-image-fetch.ts's IMAGE_FETCH_TIMEOUT_MS comment). One attempt only for a
// connector caller — no fallback-URL retry — so this is also the whole fetch
// leg's worst case, not a per-attempt figure multiplied by two.
const CONNECTOR_FETCH_TIMEOUT_MS = 30_000;

// Reserved off the OCR budget for what runs after the OCR returns and before
// the call ends: saveSourceImage's write and stageSearchResults's write.
const CONNECTOR_STAGING_MARGIN_MS = 5_000;

/** Whichever is tighter wins: `capMs`, or what `remainingMs` leaves after
 *  `marginMs` — floored to a whole millisecond at least 1, never zero or
 *  negative. `remainingMs` comes from `monotonicNow()` (`performance.now()`),
 *  which is fractional, unlike `Date.now()`; passing a non-integer through to
 *  `fetchWithTimeout`/`AbortSignal.timeout` throws `ERR_OUT_OF_RANGE` (Node
 *  requires an integer there), so this is the one place that must round.
 *  Shared by the connector fetch-leg and OCR-leg clamps below; `marginMs`
 *  defaults to 0 for the fetch leg, which reserves nothing past it. */
function clampToBudget(remainingMs: number, capMs: number, marginMs = 0): number {
  return Math.max(1, Math.floor(Math.min(capMs, remainingMs - marginMs)));
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

/** `capture:<basename without extension>` — the extraction id convention
 *  for a document that has no FamilySearch identifier. */
function captureIdFor(ref: string): string {
  const base = ref.split("/").pop() ?? ref;
  return `capture:${base.replace(/\.[A-Za-z0-9]+$/, "")}`;
}

/** Exactly one input form, checked HERE: `resolveFsImageInput` is shared with
 *  image_read and knows only the three FamilySearch shapes.
 *
 *  Pure and idempotent, so it runs in the exported wrapper (before a slot is
 *  taken, so a malformed call is told what conflicts rather than that the
 *  server is busy) and again in the body, which stays safe to call directly. */
function assertOneImageForm(input: ImageTranscribeInput): void {
  const forms = (["imageId", "ark", "memoryArtifactUrl", "file"] as const).filter(
    (k) => typeof input[k] === "string" && input[k] !== "",
  );
  if (forms.length === 0) {
    throw new Error(
      "image_transcribe requires one of imageId, ark, memoryArtifactUrl, or file " +
        `(a project-relative path to an uploaded image or PDF, with projectPath). ${receivedKeys(input)}`,
    );
  }
  if (forms.length > 1) {
    throw new Error(
      `Provide exactly one of imageId, ark, memoryArtifactUrl, or file — not ${forms.join(" and ")}.`,
    );
  }
}

/**
 * OCR a FamilySearch page scan via a hosted VLM (OpenRouter, default
 * Gemini Flash) and return the transcription as text. The image bytes go
 * host-side → OpenRouter and never cross the MCP transport, so there is no
 * size cap (unlike image_read). See docs/specs/image-transcribe-tool-spec.md.
 *
 * Holds one transcription slot for the whole call (`GENEALOGY_MAX_TRANSCRIPTIONS`,
 * self-hosted beta E4). A thin wrapper rather than a `try`/`finally` around the
 * body: the slot then covers EVERY caller of this function — `person_read`'s
 * memories phase included, which calls it directly rather than through the MCP
 * wrapper — with no re-indent of the 320-line body and no edit at the line
 * issue #3996 also works on. Off unless configured, in which case
 * `withTranscriptionSlot` calls straight through.
 *
 * INPUT SHAPE IS VALIDATED FIRST, before the slot: a caller who passes two
 * conflicting identifiers should be told which ones conflict, not that the
 * server is busy — otherwise it retries the same malformed call forever.
 */
export async function imageTranscribeTool(
  input: ImageTranscribeInput,
  principal: Principal,
  opts: { ocrTimeoutMs?: number; imageKey?: string } = {},
): Promise<ImageTranscribeResult | NoProjectResult> {
  // Fold BEFORE validating: `imageArk` becomes `ark` here, and checking the
  // unfolded input would read a valid imageArk call as "no image input".
  // Folding is idempotent, so the body's own fold is still correct for a
  // direct call to the inner function.
  const folded = foldImageArkInput(input, "image_transcribe");
  assertOneImageForm(folded);
  return withTranscriptionSlot(() => imageTranscribeToolInner(folded, principal, opts));
}

async function imageTranscribeToolInner(
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
  // The connector time budget (#3996) starts HERE, at entry — before the
  // Memories lookup, the fetch and the OCR all have a chance to spend from it.
  // monotonicNow() (utils/fs-budget.ts), not Date.now(): a wall-clock step
  // (an NTP correction, a host suspend/resume) must never hand a connector
  // call MORE time than the budget actually allows.
  const enteredAt = monotonicNow();
  const isConnector = connectorUserId(principal) !== undefined;
  const remainingBudgetMs = (): number => CONNECTOR_TRANSCRIBE_BUDGET_MS - (monotonicNow() - enteredAt);

  input = foldImageArkInput(input, "image_transcribe");
  assertOneImageForm(input);

  let bytes: Uint8Array;
  let contentType: string;
  let sizeBytes: number;
  let label: string;
  let pageId: string | null = null;
  let resolvedMemoryUrl = "";
  let apiKey: string;
  let model: string;
  // The staged page's place: its FamilySearch image group's coverage place.
  let groupPlace: Promise<string | null> = Promise.resolve(null);

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
    // A Memories *page* URL carries no path to the bytes, so it is resolved to
    // the direct artifact URL first. resolveFsImageInput stays synchronous, and
    // its MEMORY_ARTIFACT_PATTERN check then runs on the RESOLVED url — that is
    // the host check, unchanged.
    //
    // This resolution lives HERE, not in resolveFsImageInput, on purpose.
    // `ImageReadInput extends FsImageInput`, so a direct image_read call can
    // carry memoryArtifactUrl (server.ts refuses it over MCP) — lifting the resolve into the
    // shared resolver would quietly give image_read page-URL support, against
    // the image_transcribe-only ruling (lead, 2026-09-29; placement confirmed
    // 2026-09-30). image_read would also mostly pay the lookup and then refuse
    // the bytes on its 700 KB inline cap. One caller, so it stays in the tool
    // until there is a second.
    pageId = input.memoryArtifactUrl !== undefined ? memoryPageId(input.memoryArtifactUrl) : null;
    if (pageId !== null) resolvedMemoryUrl = await resolveMemoryArtifactUrl(pageId, principal);
    const forFetch =
      pageId !== null ? { ...input, memoryArtifactUrl: resolvedMemoryUrl } : input;

    const resolved = resolveFsImageInput(forFetch, "image_transcribe");
    // Deliberately the RESOLVED url: it feeds imageKey and the staged element's
    // id, so a page-URL read and a direct-URL read of one artifact land on the
    // same images/<key>.jpg instead of retaining the scan twice. The staged
    // `source` below keeps the url the agent actually passed.
    label = resolved.label;

    // The hard image cap (§5.8): refuse before the fetch and the OCR.
    const browse = await checkImageBrowseCap(input, input.projectPath, "image_transcribe", principal);

    // Resolve credentials/config before FETCHING the image: a missing key should
    // fail fast and never leave a fetched scan unused. It sits below the input
    // resolve on purpose — hoisting it above made a malformed ark report a
    // missing OpenRouter key instead of its own shape error. The Memories lookup
    // above is the one call a keyless page-URL request can still waste, and it
    // is small; the image fetch, which is not, is still behind this.
    apiKey = await getOpenRouterApiKey(principal);
    model = await getOpenRouterModel(principal);

    // Looked up beside the page fetch and the OCR, for the staged element only.
    // It never throws: any failure leaves the page without a place.
    if (input.projectPath && (input.imageId !== undefined || input.ark !== undefined)) {
      groupPlace = imageGroupPlace({ imageId: input.imageId, ark: input.ark }, principal);
    }

    // One download attempt for a connector caller — no fallback-URL retry —
    // with a per-attempt timeout well under the connector budget (#3996).
    // clampToBudget floors at 1ms: a memoryArtifactUrl fetch hands this value
    // straight to AbortSignal.timeout() (fetchFsImageBytes sends no principal
    // for that shape), which throws on a negative number rather than failing
    // cleanly, if the Memories lookup above already spent the whole budget.
    const fetched = await fetchFsImageBytes(
      resolved.url,
      isConnector ? undefined : resolved.fallbackUrl,
      principal,
      resolved.memoryShape,
      isConnector ? { timeoutMs: clampToBudget(remainingBudgetMs(), CONNECTOR_FETCH_TIMEOUT_MS) } : {},
    );
    await recordImageBrowse(browse);
    bytes = fetched.bytes;
    contentType = fetched.contentType;
    sizeBytes = fetched.sizeBytes;
  }

  // Expand recognized given names in lookingFor with historical diminutives
  // (issue #607). The model reads this as natural language, so all forms
  // (including scribal abbreviations with periods) are included. It feeds ONLY
  // the text-only found check below — never the OCR prompt, where a hinted name
  // primes the read to return it in rows the page does not have (issue #3718).
  const lookingForExpansion = input.lookingFor
    ? expandLookingFor(input.lookingFor)
    : null;
  const expandedLookingFor = lookingForExpansion?.expanded ?? input.lookingFor;

  // One budget spans the OCR read AND the found check: the second call runs on
  // what the first leaves, so lookingFor never widens this leg's worst case.
  // Reuses clampToBudget for the same cap-at-OCR_TIMEOUT_MS shape the
  // connector clamps below use; `opts.ocrTimeoutMs` is always a whole
  // millisecond value, so clampToBudget's floor is a no-op here.
  const nominalOcrBudgetMs = clampToBudget(opts.ocrTimeoutMs ?? OCR_TIMEOUT_MS, OCR_TIMEOUT_MS);
  // For a connector caller, additionally clamp to what the overall 180s budget
  // has left (minus a fixed margin for the staging write that runs after the
  // OCR returns) — whichever cap is tighter wins, so person_read's own ~40s
  // memories-phase budget (`opts.ocrTimeoutMs`) still applies even here.
  // runOcr/runFoundCheck stay principal-free (#3996); this is computed here,
  // not passed down.
  const ocrBudgetMs = isConnector
    ? clampToBudget(remainingBudgetMs(), nominalOcrBudgetMs, CONNECTOR_STAGING_MARGIN_MS)
    : nominalOcrBudgetMs;
  const ocrStartedAt = Date.now();

  // The transport, the size refusal, the single transport retry, the status
  // triage and the truncation detection all live in utils/ocr.ts (issue #2183)
  // so volume_bisect can probe a page without pasting them.
  const ocr = await runOcr({
    bytes,
    contentType,
    sizeBytes,
    prompt: buildOcrPrompt(),
    apiKey,
    model,
    timeoutMs: ocrBudgetMs,
    maxTokens: OCR_MAX_TOKENS,
  });
  const transcription = normalizeTranscription(ocr.text);
  const truncated = ocr.truncated;
  const truncationNotice = ocr.truncationNotice;

  // Persist the scan for a retained source (§8.5, design B) — best-effort: the
  // transcription is the primary payload, so a save failure (e.g. a bad
  // projectPath) omits imageRef rather than losing the text. A TTL sweep in
  // research_append GCs images no source ends up citing.
  let imageRef: string | undefined;
  // A `file` input is already retained at its own path inside the project; a
  // copy under images/ would be a second byte-copy the *.jpg GC and the viewer
  // do not expect, and citing an upload is record-structurer's business (#2490).
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
        // `label` is the caller's input verbatim EXCEPT on a Memories page url,
        // which resolves to the artifact url first — so both routes to one
        // artifact share a key instead of retaining the scan twice. For a
        // memory artifact it is a whole URL: it sanitizes to a ~70-character
        // filename carrying the host and the ctx param. person_read passes the
        // memory id instead, so the scan lands at images/<memory id>.jpg.
        imageKey: opts.imageKey ?? label,
        bytes,
      });
    } catch {
      imageRef = undefined;
    }
    // Record the cap against the persisted image so research_append can derive
    // transcription_truncated when a source cites it (#2457). Outside the try above
    // so a throw here cannot discard a scan already written to disk (#2457 r7 note);
    // only reachable with a persisted image — an imageRef is exactly what a source's
    // image_filename joins on.
    if (imageRef) recordImageReadCap(input.projectPath, imageRef, truncated);
  }

  // `found` comes from a SECOND, text-only call over the transcription — the
  // OCR prompt carries no lookingFor (issue #3718). Skipped on a truncated
  // read: a target may sit below the cut, so a half-read page must never yield
  // a clean NOT FOUND negative (#1974). Best-effort — any failure omits `found`
  // (the transcription is the primary payload) — and it runs BEFORE staging so
  // the staged element carries it.
  const key = input.lookingFor?.trim();
  let found: "FOUND" | "NOT FOUND" | undefined;
  if (key && !truncated) {
    try {
      found = await runFoundCheck({
        transcription,
        lookingFor: expandedLookingFor ?? key,
        apiKey,
        model,
        timeoutMs: Math.max(1, ocrBudgetMs - (Date.now() - ocrStartedAt)),
      });
    } catch {
      found = undefined;
    }
  }

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
    const given = {
      ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
      ...(input.ark !== undefined ? { ark: input.ark } : {}),
      ...(input.memoryArtifactUrl !== undefined ? { memoryArtifactUrl: input.memoryArtifactUrl } : {}),
      ...(input.file !== undefined ? { file: input.file } : {}),
    };
    const place = await groupPlace;
    const element: StagedTranscription = {
      id,
      source: { ...given, ...(place ? { place } : {}) },
      content_type: contentType,
      size_bytes: sizeBytes,
      model,
      transcription,
      ...(truncated ? { truncated: true as const } : {}),
      ...(found ? { found } : {}),
      ...(imageRef ? { image_ref: imageRef } : {}),
    };
    try {
      staged = await stageSearchResults({
        projectPath: input.projectPath,
        tool: "image_transcribe",
        response: {
          query: { ...given, ...(input.lookingFor ? { lookingFor: input.lookingFor } : {}) },
          results: [element],
        },
      });
    } catch (error) {
      staged = null;
      stagingError = error instanceof Error ? error.message : String(error);
    }
    digest = transcriptionDigest(id, transcription);
  }

  const viewerUrl = imageViewerUrl(
    { imageId: input.imageId, ark: input.ark },
    extractImageContextQuery,
  );

  return {
    transcription,
    ...(viewerUrl ? { viewerUrl } : {}),
    ...(truncated ? { truncated: true as const, truncationNotice } : {}),
    ...(found ? { found } : {}),
    ...(imageRef ? { imageRef } : {}),
    ...(staged !== undefined ? { staged } : {}),
    ...(stagingError !== undefined ? { stagingError } : {}),
    ...(digest !== undefined ? { digest } : {}),
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
      // The artifact url a Memories PAGE url resolved to. Returned so the caller
      // can pass it directly next time: person_read's spec tells readers
      // artifact_url "saves the lookup", and without this the one caller that
      // just performed the lookup is the only one that cannot benefit from it.
      ...(pageId !== null ? { memoryArtifactUrl: resolvedMemoryUrl } : {}),
      contentType,
      model,
      sizeBytes,
    },
  };
}

/**
 * The MCP entry point. In a project (issue #2490, lead ruling 2026-10-16) the
 * page is staged and the inline `transcription` dropped, so the caller gets
 * `staged.resultsRef`, `digest` and `found`; the text comes back inline only
 * when staging failed. Every leg goes through `compactImageTranscribeAnswer`.
 *
 * With no project — no `projectPath`, or a folder holding neither project file —
 * a FamilySearch scan or memory is read with `projectPath` removed, so nothing
 * is saved or staged anywhere and the text comes back inline (issue #4136, lead
 * ruling 2026-11-02). The read counts under the in-memory no-project image cap
 * (spec §5.8). A `file` keeps its project-relative path, so it still needs one.
 *
 * person_read calls `imageTranscribeTool` directly and keeps the text; the
 * strip lives here so it cannot reach that leg.
 */
export async function imageTranscribeMcpTool(
  input: ImageTranscribeInput,
  principal: Principal,
): Promise<ImageTranscribeToolResponse | NoProjectResult> {
  if (input?.file !== undefined) return compactOrPass(await imageTranscribeTool(input, principal));
  const cls = input?.projectPath === undefined ? "missing_arg" : await classifyProjectPath(input.projectPath);
  if (cls === "missing_dir") throw new Error(missingProjectDirMessage(input.projectPath));
  if (cls === "missing_arg" || cls === "no_project") {
    const { projectPath: _dropped, ...unsaved } = input;
    return compactOrPass(await imageTranscribeTool(unsaved, principal));
  }
  return compactOrPass(await imageTranscribeTool(input, principal));
}

function compactOrPass(
  out: ImageTranscribeResult | NoProjectResult,
): ImageTranscribeToolResponse | NoProjectResult {
  if ("ok" in out) return out;
  return compactImageTranscribeAnswer(out);
}

export const imageTranscribeToolSchema = {
  name: "image_transcribe",
  description:
    "OCR a FamilySearch page scan host-side. In a project it STAGES the " +
    "transcription and returns `staged.resultsRef`, a `digest` (length, a " +
    "300-character excerpt) and, with lookingFor, `found` — not the page text. " +
    "Triage on `found`/`digest`; read the page with sidecar_read({ projectPath, " +
    "ref: staged.resultsRef }) only when you need it, and hand " +
    "`staged.resultsRef` to the record-structurer agent to extract it; the text " +
    "comes back inline only when staging failed (`stagingError`). With no " +
    "project (no projectPath, or a folder holding no research.json) the text " +
    "comes back inline as `transcription` and nothing is saved; those reads " +
    "count under a 20-images-per-film cap for this server session. Use this for large scans that " +
    "image_read refuses (over its inline size cap): the image never enters the " +
    "conversation, so there is no size limit. Also transcribes a FamilySearch MEMORY artifact " +
    "(memoryArtifactUrl) — its direct artifact URL or its page URL " +
    "(familysearch.org/photos/artifacts/<id> or /memories/<id>) — " +
    "including a PDF, and an UPLOADED image or PDF already " +
    "inside a project folder (file, e.g. uploads/scan.jpg, with projectPath). " +
    "Provide exactly one of imageId, ark, memoryArtifactUrl, or file. Requires " +
    "FamilySearch auth (call login) for imageId/ark only; memoryArtifactUrl and " +
    "file need none. Needs an OpenRouter API key (set in " +
    "~/.familysearch-mcp/config.json if it reports no key). Inputs over 14 MiB " +
    "are refused with the remedy.",
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
          "3:1:.../3:2:... id, an unprefixed XXXX-XXXX-XXXX-X id (treated as 3:1:), " +
          "a resolver URL for one, or a resolved distribution URL. " +
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
          "A FamilySearch memory: a scanned will, certificate, obituary " +
          "clipping or compiled history uploaded by a relative. Either form " +
          "works — the direct artifact URL (a person_read source's " +
          "artifact_url) or the page URL a person sees " +
          "(familysearch.org/photos/artifacts/<id>, or /memories/<id>, which " +
          "is that source's url); a page URL is resolved first. PDFs are " +
          "supported as well as images. Needs no FamilySearch login.",
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
          "Absolute path to the project folder. In a project the transcription " +
          "is staged under it (`staged`, `digest`), and a fetched FamilySearch scan " +
          "is saved under images/ with its project-relative path returned as " +
          "imageRef, so a retained source can cite it (image_filename) for viewer " +
          "display. Omit it, or pass a folder that is not a project, to get the " +
          "text inline with nothing saved. Required with `file`.",
      },
    },
  },
};
