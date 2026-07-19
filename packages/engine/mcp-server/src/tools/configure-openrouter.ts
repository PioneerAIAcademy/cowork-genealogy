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
    "Save the user's OpenRouter API key (and optionally a model slug) to the " +
    "per-user config so image_transcribe can OCR scans. Call this when " +
    "image_transcribe reports no key, or the key was rejected: ask the user " +
    "for their key from https://openrouter.ai/keys, then pass it here. Stored " +
    "locally (mode 0o600), never echoed back. Applies to all future projects.",
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
          "Qwen-VL model when unset.",
      },
    },
    required: ["apiKey"],
  },
};
