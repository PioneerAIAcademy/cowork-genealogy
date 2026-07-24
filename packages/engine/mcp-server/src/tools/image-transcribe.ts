import { getOpenRouterApiKey, getOpenRouterModel } from "../auth/config.js";
import {
  resolveFsImageInput,
  fetchFsImageBytes,
} from "../utils/fs-image-fetch.js";
import { saveSourceImage } from "../utils/image-store.js";
import type {
  ImageTranscribeInput,
  ImageTranscribeResult,
  OpenRouterChatResponse,
} from "../types/image-transcribe.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
 * Qwen-VL) and return the transcription as text. The image bytes go
 * host-side → OpenRouter and never cross the MCP transport, so there is no
 * size cap (unlike image_read). See docs/specs/image-transcribe-tool-spec.md.
 */
export async function imageTranscribeTool(
  input: ImageTranscribeInput
): Promise<ImageTranscribeResult> {
  const { url, label } = resolveFsImageInput(input, "image_transcribe");

  // Resolve credentials/config BEFORE fetching the image: a missing key
  // should fail fast (and never leave a fetched scan unused). getOpenRouterApiKey
  // throws the LLM-actionable "call configure_openrouter" error when absent.
  const apiKey = await getOpenRouterApiKey();
  const model = await getOpenRouterModel();

  const { bytes, contentType, sizeBytes } = await fetchFsImageBytes(url);
  const dataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  const prompt = buildOcrPrompt(input.lookingFor);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
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
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach OpenRouter. (${cause})`);
  }

  // Auth failures are LLM-actionable — the key needs re-entering. Transient
  // failures (429/5xx) are not; they surface as retryable, not a re-prompt.
  if (response.status === 401) {
    throw new Error(
      "The OpenRouter API key was rejected (401). Ask the user for a current " +
        "key and call configure_openrouter."
    );
  }
  if (response.status === 402) {
    throw new Error(
      "OpenRouter reports the account is out of credits (402). Ask the user " +
        "to add credits at https://openrouter.ai."
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
        (body ? ` — ${body}` : "")
    );
  }

  const data = (await response.json()) as OpenRouterChatResponse;
  const transcription = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (transcription.length === 0) {
    throw new Error(
      "OpenRouter returned an empty transcription. Do not fabricate a read — " +
        "pivot to the indexed record for this image (record_read / record_search)."
    );
  }

  // Persist the scan for a retained source (§8.5, design B) — best-effort: the
  // transcription is the primary payload, so a save failure (e.g. a bad
  // projectPath) omits imageRef rather than losing the text. A TTL sweep in
  // research_append GCs images no source ends up citing.
  let imageRef: string | undefined;
  if (input.projectPath) {
    try {
      imageRef = await saveSourceImage({
        projectPath: input.projectPath,
        imageKey: label,
        bytes,
      });
    } catch {
      imageRef = undefined;
    }
  }

  const key = input.lookingFor?.trim();
  return {
    transcription,
    ...(key ? { found: parseFound(transcription) } : {}),
    ...(imageRef ? { imageRef } : {}),
    metadata: {
      ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
      ...(input.ark !== undefined ? { ark: input.ark } : {}),
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
    "is no size limit. Provide exactly one of imageId or ark. Requires " +
    "FamilySearch auth (call login) and an OpenRouter API key (call " +
    "configure_openrouter if it reports no key).",
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
          "3:1:.../3:2:... id, a resolver URL for one, or a resolved distribution URL.",
      },
      lookingFor: {
        type: "string",
        description:
          "Optional: who or what to locate on the page. A search key only — " +
          "it sets a FOUND/NOT FOUND pointer and never shortens or slants the " +
          "full transcription.",
      },
      projectPath: {
        type: "string",
        description:
          "Optional absolute path to the project folder. When set, the fetched " +
          "page scan is saved under images/ and its project-relative path is " +
          "returned as imageRef, so a retained source can cite it (image_filename) " +
          "for viewer display.",
      },
    },
  },
};
