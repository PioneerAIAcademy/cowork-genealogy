import { saveConfig } from "../auth/config.js";

export interface ConfigureOpenRouterInput {
  apiKey?: string;
  model?: string;
}

export interface ConfigureOpenRouterResult {
  saved: true;
  /** Masked echo (e.g. "sk-or…1234") — the full key is never returned. */
  keyPreview: string;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "…";
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}

/**
 * Save the user's OpenRouter API key (and optional model slug) to the
 * per-user config (~/.familysearch-mcp/config.json, 0o600) so
 * image_transcribe can authenticate. First and only writer of an
 * arbitrary config key besides the OAuth token flow. Returns a masked
 * confirmation; never echoes or logs the full key.
 */
export async function configureOpenRouterTool(
  input: ConfigureOpenRouterInput
): Promise<ConfigureOpenRouterResult> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Provide a non-empty OpenRouter API key.");
  }
  const model = input.model?.trim();
  await saveConfig({
    openRouterApiKey: apiKey,
    ...(model ? { openRouterModel: model } : {}),
  });
  return { saved: true, keyPreview: maskKey(apiKey) };
}

export const configureOpenRouterSchema = {
  name: "configure_openrouter",
  description:
    "Save an OpenRouter API key (and optionally a model slug) to the " +
    "per-user config so image_transcribe can OCR scans. " +
    "IMPORTANT: do not ask the user to paste their key into the chat — " +
    "it would be stored in the session transcript. Instead, tell the user " +
    "to set \"openRouterApiKey\" in ~/.familysearch-mcp/config.json directly. " +
    "Stored locally (mode 0o600), never echoed back. Applies to all future projects.",
  inputSchema: {
    type: "object" as const,
    properties: {
      apiKey: {
        type: "string",
        description: "The user's OpenRouter API key (e.g. sk-or-...).",
      },
      model: {
        type: "string",
        description:
          "Optional OpenRouter model slug for OCR. Defaults to the built-in " +
          "Gemini Flash model when unset.",
      },
    },
    required: ["apiKey"],
  },
};
