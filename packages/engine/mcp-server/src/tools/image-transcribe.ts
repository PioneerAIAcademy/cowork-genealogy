import type { Principal } from "../auth/principal.js";
import { getOpenRouterApiKey, getOpenRouterModel } from "../auth/config.js";
import { memoryPageId, resolveMemoryArtifactUrl } from "../utils/memories.js";
import {
  resolveFsImageInput,
  fetchFsImageBytes,
  extractImageContextQuery,
} from "../utils/fs-image-fetch.js";
import { imageViewerUrl } from "../utils/ark.js";
import {
  saveSourceImage,
  recordImageReadCap,
  projectScope,
} from "../utils/image-store.js";
import { expandLookingFor } from "../utils/name-variants.js";
import {
  runOcr,
  buildOcrPrompt,
  parseFound,
  OCR_TIMEOUT_MS,
  OCR_MAX_TOKENS,
  MAX_OCR_INPUT_BYTES,
} from "../utils/ocr.js";
import { checkImageBrowseCap, recordImageBrowse } from "../utils/browse-budget.js";
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

// Re-exported so existing importers (tests, dev/probe-ocr-finish-reason.ts) keep
// their import path after the extraction to src/utils/ (issue #2183).
export { OCR_MAX_TOKENS, MAX_OCR_INPUT_BYTES };

// The digest's bounded excerpt (issue #2489): enough for a caller to triage a
// staged transcription without asking for the full text.
const DIGEST_EXCERPT_CHARS = 300;

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
  let pageId: string | null = null;
  let resolvedMemoryUrl = "";
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
    // A Memories *page* URL carries no path to the bytes, so it is resolved to
    // the direct artifact URL first. resolveFsImageInput stays synchronous, and
    // its MEMORY_ARTIFACT_PATTERN check then runs on the RESOLVED url — that is
    // the host check, unchanged.
    //
    // This resolution lives HERE, not in resolveFsImageInput, on purpose.
    // `ImageReadInput extends FsImageInput`, so image_read already accepts
    // memoryArtifactUrl without advertising it — lifting the resolve into the
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
    const browse = await checkImageBrowseCap(input, input.projectPath, "image_transcribe");

    // Resolve credentials/config before FETCHING the image: a missing key should
    // fail fast and never leave a fetched scan unused. It sits below the input
    // resolve on purpose — hoisting it above made a malformed ark report a
    // missing OpenRouter key instead of its own shape error. The Memories lookup
    // above is the one call a keyless page-URL request can still waste, and it
    // is small; the image fetch, which is not, is still behind this.
    apiKey = await getOpenRouterApiKey(principal);
    model = await getOpenRouterModel(principal);

    const fetched = await fetchFsImageBytes(
      resolved.url,
      resolved.fallbackUrl,
      principal,
      resolved.memoryShape,
    );
    await recordImageBrowse(browse);
    bytes = fetched.bytes;
    contentType = fetched.contentType;
    sizeBytes = fetched.sizeBytes;
  }

  // Expand recognized given names in lookingFor with historical diminutives
  // (issue #607). The VLM reads this as natural language, so all forms
  // (including scribal abbreviations with periods) are included.
  const lookingForExpansion = input.lookingFor
    ? expandLookingFor(input.lookingFor)
    : null;
  const expandedLookingFor = lookingForExpansion?.expanded ?? input.lookingFor;

  // The transport, the size refusal, the single transport retry, the status
  // triage and the truncation detection all live in utils/ocr.ts (issue #2183)
  // so volume_bisect can probe a page without pasting them.
  const ocr = await runOcr({
    bytes,
    contentType,
    sizeBytes,
    prompt: buildOcrPrompt(expandedLookingFor),
    apiKey,
    model,
    timeoutMs: opts.ocrTimeoutMs,
    maxTokens: OCR_MAX_TOKENS,
  });
  const transcription = ocr.text;
  const truncated = ocr.truncated;
  const truncationNotice = ocr.truncationNotice;

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

export const imageTranscribeToolSchema = {
  name: "image_transcribe",
  description:
    "OCR a FamilySearch page scan and return the transcription as TEXT. Use " +
    "this for large scans that image_read refuses (over its inline size cap): " +
    "the image is OCR'd host-side and never enters the conversation, so there " +
    "is no size limit. Also transcribes a FamilySearch MEMORY artifact " +
    "(memoryArtifactUrl) — its direct artifact URL or its page URL " +
    "(familysearch.org/photos/artifacts/<id> or /memories/<id>) — " +
    "including a PDF, and an UPLOADED image or PDF already " +
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
          "Absolute path to the project folder; required with `file`, optional " +
          "otherwise. When set, the transcription is staged host-side (`staged`, " +
          "`digest`) and a fetched FamilySearch scan is saved under images/ with its " +
          "project-relative path returned as imageRef, so a retained source can cite " +
          "it (image_filename) for viewer display.",
      },
    },
  },
};
