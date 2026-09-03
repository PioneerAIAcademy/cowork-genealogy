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

  it("accepts an empty call (no model)", async () => {
    const result = await configureOpenRouterTool({});
    expect(saveConfigMock).toHaveBeenCalled();
    expect(result.model).toBeNull();
  });
});

describe("configureOpenRouterSchema", () => {
  it("does not accept an apiKey parameter", () => {
    expect(configureOpenRouterSchema.inputSchema.properties).not.toHaveProperty(
      "apiKey"
    );
  });

  it("does not require any parameter", () => {
    expect(configureOpenRouterSchema.inputSchema).not.toHaveProperty(
      "required"
    );
  });

  it("description tells the user to set the key in config.json, not in chat", () => {
    expect(configureOpenRouterSchema.description).toContain(
      "config.json"
    );
    expect(configureOpenRouterSchema.description).toMatch(
      /never ask.*paste.*key|does NOT accept an API key/i
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

  it("does not instruct Claude to receive the key via configure_openrouter", () => {
    expect(OPENROUTER_API_KEY_MISSING_MESSAGE).not.toMatch(
      /call configure_openrouter/i
    );
  });
});
