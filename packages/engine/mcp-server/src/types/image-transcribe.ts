export interface ImageTranscribeInput {
  imageId?: string;
  ark?: string;
  /**
   * Optional search key — who/what to locate on the page. Sets a FOUND /
   * NOT FOUND pointer; it never shortens or slants the full transcription,
   * and any assertion in it is ignored. Mirrors the image-reader subagent's
   * `looking_for`.
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
  /** True only when the OCR hit its output-token cap (finish_reason
   *  === "length"): the transcription above is PARTIAL and the rest of the
   *  page is unread, not empty. Absent on a complete read. See spec §6.2. */
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
   *  project onward. Advisory only — the transcription above is complete and
   *  unaffected. See spec §5.8. */
  browseBudget?: {
    /** The image-group prefix, e.g. "004261111". */
    imageGroup: string;
    /** Distinct images transcribed from this group in this project so far. */
    distinctImagesRead: number;
    /** The advisory the caller should act on (pivot to indexed search). */
    notice: string;
  };
  metadata: {
    imageId?: string;
    ark?: string;
    /** The OpenRouter model slug actually used. */
    model: string;
    /** Raw FamilySearch image size (sent to OCR as-is; no pre-processing). */
    sizeBytes: number;
  };
}

/** The subset of OpenRouter's chat-completions response we read. */
export interface OpenRouterChatResponse {
  choices?: Array<{
    message?: { content?: string | null };
    /** OpenAI-compatible stop reason. "length" marks an output-token-cap
     *  truncation; "stop" a complete read. (Probe: dev/probe-ocr-finish-reason.ts.) */
    finish_reason?: string | null;
    /** The provider's own un-normalized stop reason. OpenRouter usually maps a
     *  cap to `finish_reason: "length"`, but not every provider normalizes
     *  cleanly (e.g. Gemini emits "MAX_TOKENS"), so we read this as a fallback
     *  signal. Both were captured by the probe. */
    native_finish_reason?: string | null;
  }>;
  error?: { message?: string; code?: number };
}
