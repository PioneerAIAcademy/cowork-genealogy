export interface ImageTranscribeInput {
  imageId?: string;
  ark?: string;
  /** A FamilySearch memory artifact URL, as carried by a person_read source
   *  that came from the memories API. Already a direct bytes URL, so it is
   *  used as-is rather than resolved, and it is fetched WITHOUT a token. */
  memoryArtifactUrl?: string;
  /** A project-relative POSIX path to an uploaded image or PDF inside the
   *  project folder (`uploads/<name>` is where the hosted upload endpoint puts
   *  them). Requires `projectPath`. Read through the ProjectStore, sniffed by
   *  magic bytes, fetched with NO FamilySearch token (issue #2048). */
  file?: string;
  /**
   * Optional search key — who/what to locate on the page. On a complete read it
   * sets a FOUND / NOT FOUND pointer (`found`); the pointer is withheld on a
   * truncated read (a half-read page cannot support a clean NOT FOUND). It never
   * shortens or slants the full transcription, and any assertion in it is
   * ignored. Mirrors the image-reader subagent's `looking_for`.
   */
  lookingFor?: string;
  /** Absolute project-folder path. When given, the fetched JPEG is saved under
   *  images/<key>.jpg and its project-relative path returned as `imageRef` (§8.5). */
  projectPath?: string;
}

export interface ImageTranscribeResult {
  /** Faithful full-page OCR — the primary payload. Never doctored: a
   *  truncation is signalled by the sibling `truncated`/`truncationNotice`
   *  fields, not by splicing prose into this text. */
  transcription: string;
  /** True only when the OCR hit its output-token cap (finish_reason or
   *  native_finish_reason marks it — see §6.2 for the exact match): the
   *  transcription above is PARTIAL and the rest of the page is unread, not
   *  empty. Absent on a complete read. */
  truncated?: true;
  /** Tool-voiced, human-readable companion to `truncated` — a plain sentence
   *  the caller can surface without improvising. Present iff `truncated`. */
  truncationNotice?: string;
  /** Present only when `lookingFor` was provided. Suppressed on a truncated
   *  read — a half-read page must never surface a clean NOT FOUND. */
  found?: "FOUND" | "NOT FOUND";
  /** Project-relative path of the saved scan (images/<key>.jpg), present only
   *  when projectPath was supplied and the save succeeded (§8.5). */
  imageRef?: string;
  /** Present only from the (N+1)th distinct image in one image group in one
   *  project onward. Advisory only, and independent of `truncated` — the two can
   *  co-occur (a browse-budget read can also be output-cap truncated). See spec
   *  §5.8. */
  browseBudget?: {
    /** The image-group prefix, e.g. "004261111". */
    imageGroup: string;
    /** Distinct images transcribed from this group in this project so far. */
    distinctImagesRead: number;
    /** The advisory the caller should act on (pivot to indexed search). */
    notice: string;
  };
  /** Present when `lookingFor` contained a recognized given name and
   *  expansion fired. Tells the caller what the VLM was primed with. */
  nameExpansion?: {
    original: string;
    expanded: string;
    expansions: Record<string, string[]>;
  };
  /**
   * The staging handle (search-result-staging-spec.md), present iff
   * `projectPath` was given: the transcription is retained host-side as a
   * one-element `results[]` envelope under results/.staging/ and
   * `research_log_append({ stagedResultsRef })` finalizes it into the log
   * entry's sidecar. `null` when staging failed (see `stagingError`).
   */
  staged?: { resultsRef: string; returnedCount: number } | null;
  /** Why `staged` is null — staging is best-effort and never fails the read. */
  stagingError?: string;
  /**
   * What a caller triages on without the full text (issue #2489): the id the
   * staged element carries, the transcription's length, a bounded excerpt, and
   * the `found` / `truncated` markers. Present iff `projectPath` was given.
   */
  digest?: {
    id: string;
    chars: number;
    excerpt: string;
    found?: "FOUND" | "NOT FOUND";
    truncated?: true;
  };
  metadata: {
    imageId?: string;
    ark?: string;
    /** The project-relative ref that was read, for a `file` input. */
    file?: string;
    /** The content type sent to the OCR model (`image/jpeg`, `application/pdf`, …). */
    contentType: string;
    /** The OpenRouter model slug actually used. */
    model: string;
    /** Raw input size in bytes (sent to OCR as-is; no pre-processing). */
    sizeBytes: number;
  };
}

/** The element `image_transcribe` stages (snake_case: persisted project state). */
export interface StagedTranscription {
  /** The imageId / ark / memory URL, or `capture:<basename>` for a `file`. */
  id: string;
  source: { imageId?: string; ark?: string; memoryArtifactUrl?: string; file?: string };
  content_type: string;
  size_bytes: number;
  model: string;
  transcription: string;
  truncated?: true;
  found?: "FOUND" | "NOT FOUND";
}

/** The subset of OpenRouter's chat-completions response we read. */
export interface OpenRouterChatResponse {
  choices?: Array<{
    message?: { content?: string | null };
    /** OpenAI-compatible stop reason. "length" marks an output-token-cap
     *  truncation — measured (probe: dev/probe-ocr-finish-reason.ts). "stop" is
     *  the non-cap value from the OpenAI contract; the probe captured no
     *  complete-page read, so that half is inferred, not measured. */
    finish_reason?: string | null;
    /** The provider's own un-normalized stop reason. The shipped default
     *  (Gemini) DOES normalize — it reports `finish_reason: "length"` and
     *  `native_finish_reason: "MAX_TOKENS"` together (probe:
     *  dev/probe-ocr-finish-reason.ts). We read this field as insurance for a
     *  model (reachable via the openRouterModel override) that does not
     *  normalize, or spells the cap differently. */
    native_finish_reason?: string | null;
  }>;
  error?: { message?: string; code?: number };
}
