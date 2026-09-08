import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const saveConfigMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/config.js")>();
  return {
    ...actual,
    saveConfig: saveConfigMock,
  };
});

import {
  configureOpenRouterTool,
  configureOpenRouterSchema,
} from "../../src/tools/configure-openrouter.js";
import { OPENROUTER_API_KEY_MISSING_MESSAGE } from "../../src/auth/config.js";

beforeEach(() => {
  saveConfigMock.mockReset();
  saveConfigMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("configureOpenRouterTool", () => {
  it("saves a model via saveConfig", async () => {
    const result = await configureOpenRouterTool({ model: "qwen/other-vl" });
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ openRouterModel: "qwen/other-vl" })
    );
    expect(result.saved).toBe(true);
    expect(result.model).toBe("qwen/other-vl");
  });

  it("trims surrounding whitespace on model", async () => {
    await configureOpenRouterTool({ model: "  qwen/trimmed  " });
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ openRouterModel: "qwen/trimmed" })
    );
  });

  it("writes nothing when there is no model to save", async () => {
    // saveConfig() rewrites the whole file from loadConfig(), which yields {}
    // for a config.json it cannot parse — so an empty patch would clobber it.
    const result = await configureOpenRouterTool({});
    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(result).toEqual({ saved: false, model: null });
  });

  it("writes nothing when the model is only whitespace", async () => {
    const result = await configureOpenRouterTool({ model: "   " });
    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(result.saved).toBe(false);
  });
});

/**
 * Strip explicitly-negated sentences ("Do not ask…") so a prohibition cannot
 * mask a live instruction to collect the key.
 */
function withoutProhibitions(text: string): string {
  return text.replace(/\b(?:do not|don't|never)\b[^.]*\./gi, "");
}

describe("configureOpenRouterSchema", () => {
  it("takes the model slug and nothing else", () => {
    expect(Object.keys(configureOpenRouterSchema.inputSchema.properties)).toEqual([
      "model",
    ]);
  });

  it("does not require any parameter", () => {
    expect(configureOpenRouterSchema.inputSchema).not.toHaveProperty("required");
  });

  it("description disclaims the key parameter", () => {
    expect(configureOpenRouterSchema.description).toMatch(
      /does not accept an api key/i
    );
  });

  it("description forbids collecting the key in chat", () => {
    expect(configureOpenRouterSchema.description).toMatch(
      /\b(?:never|do not|don't)\b[^.]*paste[^.]*chat/i
    );
  });

  it("description points at the config file", () => {
    expect(configureOpenRouterSchema.description).toContain(
      "~/.familysearch-mcp/config.json"
    );
  });
});

describe("OPENROUTER_API_KEY_MISSING_MESSAGE", () => {
  it("names the config file path", () => {
    expect(OPENROUTER_API_KEY_MISSING_MESSAGE).toContain(
      "~/.familysearch-mcp/config.json"
    );
  });

  it("names the JSON field", () => {
    expect(OPENROUTER_API_KEY_MISSING_MESSAGE).toContain("openRouterApiKey");
  });

  it("forbids collecting the key in chat", () => {
    expect(OPENROUTER_API_KEY_MISSING_MESSAGE).toMatch(
      /\b(?:do not|don't|never)\b[^.]*paste[^.]*chat/i
    );
  });

  it("never offers configure_openrouter as the key channel", () => {
    expect(OPENROUTER_API_KEY_MISSING_MESSAGE).not.toMatch(
      /configure_openrouter/i
    );
  });

  it("carries no surviving instruction to collect the key from the user", () => {
    expect(withoutProhibitions(OPENROUTER_API_KEY_MISSING_MESSAGE)).not.toMatch(
      /\b(?:ask|paste|send|provide|share|enter)\b/i
    );
  });
});
