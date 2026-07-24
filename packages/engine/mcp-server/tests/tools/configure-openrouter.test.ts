import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const saveConfigMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  saveConfig: saveConfigMock,
}));

import { configureOpenRouterTool } from "../../src/tools/configure-openrouter.js";

beforeEach(() => {
  saveConfigMock.mockReset();
  saveConfigMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("configureOpenRouterTool", () => {
  it("saves the key via saveConfig and returns a masked preview (never the full key)", async () => {
    const result = await configureOpenRouterTool({
      apiKey: "sk-or-v1-abcd1234ef",
    });

    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ openRouterApiKey: "sk-or-v1-abcd1234ef" })
    );
    expect(result.saved).toBe(true);
    expect(result.keyPreview).not.toContain("abcd1234");
    expect(result.keyPreview).toMatch(/^sk-or…/);
  });

  it("trims surrounding whitespace before saving", async () => {
    await configureOpenRouterTool({ apiKey: "  sk-or-trimmed123  " });
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ openRouterApiKey: "sk-or-trimmed123" })
    );
  });

  it("passes an optional model through", async () => {
    await configureOpenRouterTool({
      apiKey: "sk-or-xyz12345",
      model: "qwen/other-vl",
    });
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        openRouterApiKey: "sk-or-xyz12345",
        openRouterModel: "qwen/other-vl",
      })
    );
  });

  it("does not set openRouterModel when the model is omitted", async () => {
    await configureOpenRouterTool({ apiKey: "sk-or-xyz12345" });
    const arg = saveConfigMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("openRouterModel");
  });

  it("rejects an empty/whitespace or missing key without saving", async () => {
    await expect(configureOpenRouterTool({ apiKey: "   " })).rejects.toThrow(
      /non-empty OpenRouter API key/
    );
    await expect(configureOpenRouterTool({})).rejects.toThrow(
      /non-empty OpenRouter API key/
    );
    expect(saveConfigMock).not.toHaveBeenCalled();
  });
});
