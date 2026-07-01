import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/login.js", () => ({
  performLogin: vi.fn(),
}));

import { loginTool, loginToolSchema } from "../../src/tools/login.js";
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
    expect(mockedPerformLogin).toHaveBeenCalledWith();
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
});

describe("loginToolSchema", () => {
  // Regression guards: the LLM-facing surface must never mention the client
  // ID / dev key. The MCP server reads it from a bundled file; users and the
  // LLM never need to know it exists.
  it("declares no input parameters", () => {
    expect(loginToolSchema.inputSchema.type).toBe("object");
    expect(loginToolSchema.inputSchema.properties).toEqual({});
  });

  it("description contains no client-id or developer-key wording", () => {
    expect(loginToolSchema.description).not.toMatch(/client\s*id/i);
    expect(loginToolSchema.description).not.toMatch(/dev(?:eloper)?\s*key/i);
  });
});
