import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/tokenManager.js", () => ({
  clearTokens: vi.fn(),
}));

import { logoutTool } from "../../src/tools/logout.js";
import { clearTokens } from "../../src/auth/tokenManager.js";

const mockedClearTokens = vi.mocked(clearTokens);

beforeEach(() => {
  mockedClearTokens.mockReset();
});

describe("logoutTool", () => {
  it("clears stored tokens and reports success", async () => {
    mockedClearTokens.mockResolvedValueOnce(undefined);

    const result = await logoutTool();

    expect(mockedClearTokens).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/[Ll]ogged out/);
  });

  it("still reports success when no tokens were present (idempotent)", async () => {
    mockedClearTokens.mockResolvedValueOnce(undefined);

    const result = await logoutTool();

    expect(result).toEqual({
      success: true,
      message: expect.stringMatching(/[Ll]ogged out/),
    });
  });
});
