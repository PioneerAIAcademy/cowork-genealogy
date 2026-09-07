import { saveConfig } from "../auth/config.js";

export interface ConfigureOpenRouterInput {
  model?: string;
}

export interface ConfigureOpenRouterResult {
  saved: boolean;
  model: string | null;
}

/**
 * Save an optional OpenRouter model slug to the per-user config
 * (~/.familysearch-mcp/config.json, 0o600) so image_transcribe uses
 * a non-default OCR model. The API key is set by the user directly
 * in the config file — it never passes through a tool call.
 */
export async function configureOpenRouterTool(
  input: ConfigureOpenRouterInput
): Promise<ConfigureOpenRouterResult> {
  const model = input.model?.trim() || null;
  // Nothing to write. saveConfig() round-trips the whole file and loadConfig()
  // returns {} for one it cannot parse, so an empty patch rewrites a corrupt
  // config.json as {} and discards content the user could still recover.
  if (!model) return { saved: false, model: null };
  await saveConfig({ openRouterModel: model });
  return { saved: true, model };
}

export const configureOpenRouterSchema = {
  name: "configure_openrouter",
  description:
    "Save an OpenRouter model slug to the per-user config so " +
    "image_transcribe uses a non-default OCR model. This tool does NOT " +
    "accept an API key — the user must set \"openRouterApiKey\" in " +
    "~/.familysearch-mcp/config.json directly (from https://openrouter.ai/keys). " +
    "Never ask the user to paste a key into the chat.",
  inputSchema: {
    type: "object" as const,
    properties: {
      model: {
        type: "string",
        description:
          "OpenRouter model slug for OCR. Defaults to the built-in " +
          "Gemini Flash model when unset.",
      },
    },
  },
};
