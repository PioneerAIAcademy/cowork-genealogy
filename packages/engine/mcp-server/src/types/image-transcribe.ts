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
}

export interface ImageTranscribeResult {
  /** Faithful full-page OCR — the primary payload. */
  transcription: string;
  /** Present only when `lookingFor` was provided. */
  found?: "FOUND" | "NOT FOUND";
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
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string; code?: number };
}
