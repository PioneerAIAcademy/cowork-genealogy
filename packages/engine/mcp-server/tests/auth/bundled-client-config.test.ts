import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { BUNDLED_CLIENT_CONFIG_PATH } from "../../src/auth/config.js";

// Sanity check on the actual bundled JSON file. If this fails, the .mcpb will
// ship without a usable client ID and every authenticated tool breaks.
describe("bundled FamilySearch client config", () => {
  it("exists on disk at the resolved bundled path", () => {
    expect(existsSync(BUNDLED_CLIENT_CONFIG_PATH)).toBe(true);
  });

  it("parses as JSON and contains a non-empty clientId string", () => {
    const raw = readFileSync(BUNDLED_CLIENT_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { clientId?: unknown };
    expect(typeof parsed.clientId).toBe("string");
    expect((parsed.clientId as string).trim().length).toBeGreaterThan(0);
  });
});
