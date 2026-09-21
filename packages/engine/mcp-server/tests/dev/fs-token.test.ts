import { describe, it, expect } from "vitest";
import {
  DEFAULT_MIN_LIFE_MINUTES,
  main,
  parseMinLifeMinutes,
  tokenWithMinLife,
  type TokenIO,
} from "../../dev/fs-token.js";
import { EXPIRY_BUFFER_MS } from "../../src/auth/config.js";
import type { TokenStore } from "../../src/types/auth.js";

/**
 * The prototype's token supplier (`make proto-token`, apps/server/proto/env.sh).
 *
 * The defect these pin: `getValidToken(LOCAL)` returns the stored access token unchanged
 * unless it has ALREADY expired, so a refresh run at minute 52 of a one-hour token is a
 * no-op that hands the stack eight minutes of life — which is how the D17 run died
 * mid-delegation. The script now forces a refresh inside a `--min-life` window, and the
 * window is checked by the auth module's own `isExpired`, whose EXPIRY_BUFFER_MS stacks
 * on top: a token is refreshed once its remaining life is at or under
 * `--min-life + EXPIRY_BUFFER_MS`. Both sides of that boundary are asserted below, and so
 * is the default's size — a window narrower than the 1800 s step ceiling only narrows the
 * D17 failure, since a turn may run longer than the token it started on.
 *
 * No network and no disk: the auth module's side is injected. What is NOT injected is
 * `isExpired` itself, so these exercise the module's real check rather than a stand-in.
 */

const NOW = 1_780_000_000_000;
const MINUTE = 60_000;

const store = (msLeft: number, accessToken = "live-token"): TokenStore => ({
  accessToken,
  refreshToken: "refresh-token",
  expiresAt: NOW + msLeft,
});

type Calls = { refreshed: string[]; saved: TokenStore[]; deferred: number };

const io = (
  tokens: TokenStore | null,
  calls: Calls,
  overrides: Partial<TokenIO> = {}
): TokenIO => ({
  loadTokens: async () => tokens,
  saveTokens: async (t) => {
    calls.saved.push(t);
  },
  refreshAccessToken: async (refreshToken) => {
    calls.refreshed.push(refreshToken);
    return { accessToken: "fresh-token", refreshToken: "next-refresh", expiresAt: NOW + 3600_000 };
  },
  getValidToken: async () => {
    calls.deferred += 1;
    return "deferred-token";
  },
  now: () => NOW,
  ...overrides,
});

const calls = (): Calls => ({ refreshed: [], saved: [], deferred: 0 });

describe("parseMinLifeMinutes", () => {
  it("defaults to the step ceiling in minutes and reads both spellings of the flag", () => {
    expect(parseMinLifeMinutes([])).toBe(DEFAULT_MIN_LIFE_MINUTES);
    expect(DEFAULT_MIN_LIFE_MINUTES).toBe(30);
    expect(parseMinLifeMinutes(["--min-life", "25"])).toBe(25);
    expect(parseMinLifeMinutes(["--min-life=25"])).toBe(25);
    expect(parseMinLifeMinutes(["--min-life", "0"])).toBe(0);
  });

  it("refuses every shape that would otherwise print a token it never checked", () => {
    // Each of these is a way a guard exits 0 having done nothing: a value that parses
    // to NaN, an empty one that parses to 0 (which would disable the window), a flag
    // with nothing after it, a negative window, and a typo'd flag name.
    expect(() => parseMinLifeMinutes(["--min-life", "soon"])).toThrow(/non-negative number/);
    expect(() => parseMinLifeMinutes(["--min-life="])).toThrow(/needs a value/);
    expect(() => parseMinLifeMinutes(["--min-life", ""])).toThrow(/needs a value/);
    expect(() => parseMinLifeMinutes(["--min-life"])).toThrow(/needs a value/);
    expect(() => parseMinLifeMinutes(["--min-life", "-5"])).toThrow(/non-negative number/);
    expect(() => parseMinLifeMinutes(["--minlife", "20"])).toThrow(/unknown argument/);
  });
});

describe("tokenWithMinLife", () => {
  it("hands over a token with life left, untouched", async () => {
    const c = calls();
    const token = await tokenWithMinLife(10, io(store(40 * MINUTE), c));
    expect(token).toBe("live-token");
    expect(c.refreshed).toEqual([]);
    expect(c.saved).toEqual([]);
  });

  it("refreshes and persists one inside the window, and returns the NEW token", async () => {
    const c = calls();
    const token = await tokenWithMinLife(10, io(store(8 * MINUTE), c));
    expect(token).toBe("fresh-token");
    expect(c.refreshed).toEqual(["refresh-token"]);
    expect(c.saved.map((t) => t.accessToken)).toEqual(["fresh-token"]);
  });

  it("the D17 token — 52 minutes into an hour — is refreshed, where getValidToken kept it", async () => {
    const c = calls();
    expect(await tokenWithMinLife(DEFAULT_MIN_LIFE_MINUTES, io(store(8 * MINUTE), c))).toBe(
      "fresh-token"
    );
    expect(c.refreshed).toHaveLength(1);
  });

  it("puts the boundary at --min-life plus the module's own expiry buffer, both sides", async () => {
    const edge = 10 * MINUTE + EXPIRY_BUFFER_MS;
    const kept = calls();
    expect(await tokenWithMinLife(10, io(store(edge + 1), kept))).toBe("live-token");
    expect(kept.refreshed).toEqual([]);
    const forced = calls();
    expect(await tokenWithMinLife(10, io(store(edge), forced))).toBe("fresh-token");
    expect(forced.refreshed).toHaveLength(1);
  });

  it("a wider window forces a refresh the default would have skipped", async () => {
    const c = calls();
    expect(await tokenWithMinLife(45, io(store(40 * MINUTE), c))).toBe("fresh-token");
    expect(c.refreshed).toHaveLength(1);
  });

  it("the default window outlives a full-length turn at the prototype's step ceiling", async () => {
    // 1800 s (READ_TIMEOUT_S) is how long a prototype turn may run before the shim kills
    // the worker. The window that binds is the one apps/server/proto/env.sh asks for, and
    // its own test holds that against the compose file; this holds the standalone default
    // to the same floor without the engine reading the control plane's files.
    expect(DEFAULT_MIN_LIFE_MINUTES).toBeGreaterThanOrEqual(30);
    // A token with exactly a full-length turn of life left is refreshed, not handed over.
    const c = calls();
    expect(await tokenWithMinLife(DEFAULT_MIN_LIFE_MINUTES, io(store(30 * MINUTE), c))).toBe(
      "fresh-token"
    );
    expect(c.refreshed).toHaveLength(1);
  });

  it("defers to getValidToken when there is no session and when there is nothing to refresh with", async () => {
    const none = calls();
    expect(await tokenWithMinLife(10, io(null, none))).toBe("deferred-token");
    expect(none.deferred).toBe(1);
    const noRefresh = calls();
    const stale: TokenStore = { accessToken: "live-token", expiresAt: NOW + 8 * MINUTE };
    expect(await tokenWithMinLife(10, io(stale, noRefresh))).toBe("deferred-token");
    expect(noRefresh.deferred).toBe(1);
    expect(noRefresh.refreshed).toEqual([]);
  });

  it("fails loudly when the refresh token is itself dead, instead of handing over the dying one", async () => {
    const c = calls();
    const dead = io(store(2 * MINUTE), c, {
      refreshAccessToken: async () => {
        throw new Error("FamilySearch token error: invalid_grant");
      },
    });
    await expect(tokenWithMinLife(10, dead)).rejects.toThrow(/invalid_grant/);
    await expect(tokenWithMinLife(10, dead)).rejects.toThrow(/make e2e-login/);
    expect(c.saved).toEqual([]);
  });
});

describe("main", () => {
  const capture = (): { text: string[]; write: (t: string) => void } => {
    const text: string[] = [];
    return { text, write: (t) => text.push(t) };
  };

  it("writes the token to stdout and exits 0", async () => {
    const out = capture();
    const err = capture();
    const code = await main([], io(store(40 * MINUTE), calls()), out.write, err.write);
    expect(code).toBe(0);
    expect(out.text).toEqual(["live-token"]);
    expect(err.text).toEqual([]);
  });

  it("exits 2 with the reason on stderr and NOTHING on stdout when a token cannot be had", async () => {
    const c = calls();
    const dead = io(store(2 * MINUTE), c, {
      refreshAccessToken: async () => {
        throw new Error("FamilySearch token error: invalid_grant");
      },
    });
    const out = capture();
    const err = capture();
    expect(await main([], dead, out.write, err.write)).toBe(2);
    expect(out.text).toEqual([]);
    expect(err.text.join("")).toMatch(/^fs-token: FamilySearch refresh failed/);
  });

  it("exits 2 on a bad flag without reading a token at all", async () => {
    const c = calls();
    const out = capture();
    const err = capture();
    expect(await main(["--min-life", "soon"], io(store(40 * MINUTE), c), out.write, err.write)).toBe(2);
    expect(out.text).toEqual([]);
    expect(err.text.join("")).toMatch(/non-negative number/);
    expect(c.deferred).toBe(0);
  });
});
