import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/login.js", () => ({
  performLogin: vi.fn(),
}));

import { loginTool } from "../../src/tools/login.js";
import { performLogin } from "../../src/auth/login.js";

const mockedPerformLogin = vi.mocked(performLogin);

beforeEach(() => {
  mockedPerformLogin.mockReset();
});

describe("loginTool", () => {
  it("returns the success result from performLogin", async () => {
    mockedPerformLogin.mockResolvedValueOnce({
      success: true,
      message: "Login successful.",
    });

    const result = await loginTool();

    expect(result).toEqual({ success: true, message: "Login successful." });
  });

  it("returns the failure result from performLogin", async () => {
    mockedPerformLogin.mockResolvedValueOnce({
      success: false,
      message: "Login timed out after 5 minutes. Call the login tool again to retry.",
    });

    const result = await loginTool();

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/timed out/);
  });

  it("forwards the clientId argument to performLogin for first-time bootstrap", async () => {
    mockedPerformLogin.mockResolvedValueOnce({
      success: true,
      message: "Login successful.",
    });

    await loginTool({ clientId: "fs-internal-dev-key-000262" });

    expect(mockedPerformLogin).toHaveBeenCalledWith({
      clientId: "fs-internal-dev-key-000262",
    });
  });
});
