import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generatePKCE, generateState } from "../../src/auth/pkce.js";

describe("generatePKCE", () => {
  it("produces a verifier of 43 base64url characters", () => {
    const { codeVerifier } = generatePKCE();
    expect(codeVerifier).toHaveLength(43);
  });

  it("produces a verifier containing only URL-safe base64 characters", () => {
    const { codeVerifier } = generatePKCE();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a challenge that is valid base64url of length 43", () => {
    const { codeChallenge } = generatePKCE();
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toHaveLength(43);
  });

  it("produces a challenge equal to SHA-256(verifier) encoded as base64url", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const expected = createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(codeChallenge).toBe(expected);
  });
});

describe("generateState", () => {
  it("produces 32 hexadecimal characters", () => {
    const state = generateState();
    expect(state).toHaveLength(32);
    expect(state).toMatch(/^[0-9a-f]+$/);
  });
});
