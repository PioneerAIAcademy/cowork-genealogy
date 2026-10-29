import { SolutionError } from "../shared/errors.js";
import { fetchFsImage, type FsDeps, type ImageRef } from "../shared/familysearch.js";
import type { Llm } from "../shared/llm.js";
import { TRANSCRIBE_PROMPT } from "./prompt.js";

export type TranscribeImageInput = ImageRef;

export interface TranscribeImageDeps extends FsDeps {
  llm: Llm;
}

export interface TranscribeImageResult {
  text: string;
  /**
   * The model stopped before the end of the page. `text` is what it read; the
   * rest of the page is unread, not blank.
   */
  truncated: boolean;
  model: string;
  /** The FamilySearch URL the scan was read from. */
  imageUrl: string;
}

// Enough for the densest register page; a bound that binds shows as `truncated`.
const MAX_TOKENS = 16_000;

// The model sometimes wraps the page in a Markdown code fence.
const stripFence = (text: string) => text.replace(/^```[\w-]*\n([\s\S]*?)\n?(```)?$/, "$1").trim();

/** Read a FamilySearch page scan and return a verbatim transcription. */
export async function transcribeImage(
  input: TranscribeImageInput,
  deps: TranscribeImageDeps,
): Promise<TranscribeImageResult> {
  const image = await fetchFsImage(input, deps);
  const out = await deps.llm.complete({ prompt: TRANSCRIBE_PROMPT, images: [image], maxTokens: MAX_TOKENS });
  const text = stripFence(out.text);
  if (text === "") {
    throw new SolutionError(
      "upstream",
      out.truncated
        ? "The model hit its output limit before writing any transcription."
        : "The model returned an empty transcription.",
    );
  }
  return { text, truncated: out.truncated, model: out.model, imageUrl: image.url };
}
