import { describe, it, expect } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { principalFromHeaders } from "../../src/http-server.js";

// The header → principal seam of the Streamable HTTP entrypoint. What matters
// most is the last block: no input, however malformed, yields LOCAL — that
// fallback would let an unauthenticated request act as the host's own user.

const baseConfig = { wikiApiUrl: "https://wiki.example", openRouterApiKey: "or-key" };

function bearerOf(headers: IncomingHttpHeaders): { token: string; hosted: unknown } {
  const p = principalFromHeaders(headers, baseConfig);
  if (p.kind !== "bearer") throw new Error(`expected a bearer, got ${p.kind}`);
  return { token: p.accessToken, hosted: p.config.hosted };
}

describe("principalFromHeaders", () => {
  it("extracts the token from `Authorization: Bearer <token>`", () => {
    expect(bearerOf({ authorization: "Bearer tok-123" }).token).toBe("tok-123");
  });

  it("matches the scheme case-insensitively and trims surrounding whitespace", () => {
    expect(bearerOf({ authorization: "bearer tok-123" }).token).toBe("tok-123");
    expect(bearerOf({ authorization: "BEARER tok-123" }).token).toBe("tok-123");
    expect(bearerOf({ authorization: "  Bearer   tok-123  " }).token).toBe("tok-123");
  });

  it("a missing header is a bearer with an empty token and hosted implied", () => {
    const p = bearerOf({});
    expect(p.token).toBe("");
    expect(p.hosted).toBe(true);
  });

  it("a malformed header is an empty bearer, never a guess at the token", () => {
    for (const authorization of ["Basic x", "Bearer", "Bearer   ", "tok-123", ""]) {
      expect(bearerOf({ authorization }).token, JSON.stringify(authorization)).toBe("");
    }
  });

  it("carries the base config through, with hosted forced on", () => {
    const p = principalFromHeaders({ authorization: "Bearer t" }, { ...baseConfig, hosted: false });
    expect(p.kind).toBe("bearer");
    if (p.kind === "bearer") {
      expect(p.config).toEqual({ ...baseConfig, hosted: true });
    }
  });

  it("never returns the local principal, whatever the headers", () => {
    const inputs: IncomingHttpHeaders[] = [
      {},
      { authorization: undefined },
      { authorization: "" },
      { authorization: "Bearer" },
      { authorization: "Bearer tok" },
      { authorization: "Basic dXNlcjpwYXNz" },
      { authorization: "Digest x" },
      { authorization: ["Bearer a", "Bearer b"] as unknown as string },
      { "x-authorization": "Bearer tok" },
      { cookie: "session=abc" },
    ];
    for (const headers of inputs) {
      expect(principalFromHeaders(headers, baseConfig).kind, JSON.stringify(headers)).not.toBe("local");
    }
  });
});
