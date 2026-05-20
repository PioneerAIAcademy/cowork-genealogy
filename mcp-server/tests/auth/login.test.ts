import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { REDIRECT_URI } from "../../src/auth/config.js";

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

const httpState = vi.hoisted(() => ({
  handler: undefined as RequestHandler | undefined,
  listenCalls: [] as Array<{ port: unknown; host: unknown }>,
  closeMock: vi.fn(),
}));

vi.mock("node:http", () => {
  const fakeServer = {
    listen: vi.fn((port: unknown, host: unknown, cb?: () => void) => {
      httpState.listenCalls.push({ port, host });
      // The real server.listen signals readiness via this callback; the
      // non-blocking login resolves startCallbackServer() from it.
      if (typeof cb === "function") cb();
      return fakeServer;
    }),
    once: vi.fn(() => fakeServer),
    close: httpState.closeMock,
  };
  return {
    createServer: vi.fn((handler: RequestHandler) => {
      httpState.handler = handler;
      return fakeServer;
    }),
  };
});

vi.mock("open", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/auth/config.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/config.js")>();
  return {
    ...actual,
    getClientId: vi.fn().mockResolvedValue("test-client-id"),
  };
});

vi.mock("../../src/auth/refresh.js", () => ({
  exchangeCodeForTokens: vi.fn(),
}));

vi.mock("../../src/auth/tokenManager.js", () => ({
  saveTokens: vi.fn(),
}));

import open from "open";
import { performLogin } from "../../src/auth/login.js";
import { exchangeCodeForTokens } from "../../src/auth/refresh.js";
import { saveTokens } from "../../src/auth/tokenManager.js";

const mockedOpen = vi.mocked(open);
const mockedExchange = vi.mocked(exchangeCodeForTokens);
const mockedSaveTokens = vi.mocked(saveTokens);

const AUTH_ENDPOINT =
  "https://ident.familysearch.org/cis-web/oauth2/v3/authorization";

function flushMicrotasks(times = 12): Promise<void> {
  return new Promise((resolve) => {
    let remaining = times;
    const drain = () => {
      if (remaining-- <= 0) return resolve();
      queueMicrotask(drain);
    };
    drain();
  });
}

function simulateCallback(query: Record<string, string>): void {
  if (!httpState.handler) throw new Error("No callback handler captured");
  const req = {
    url: `/callback?${new URLSearchParams(query).toString()}`,
  } as IncomingMessage;
  const res = {
    writeHead: vi.fn().mockReturnThis(),
    end: vi.fn(),
  } as unknown as ServerResponse;
  httpState.handler(req, res);
}

// The auth URL is in both the open() call and the result message.
function authUrlState(): string {
  const url = mockedOpen.mock.calls[0][0] as string;
  return new URL(url).searchParams.get("state") ?? "";
}

function urlFromMessage(message: string): URL {
  const match = message.match(/https:\/\/ident\.familysearch\.org\S+/);
  if (!match) throw new Error("No authorization URL in message");
  return new URL(match[0]);
}

beforeEach(() => {
  httpState.handler = undefined;
  httpState.listenCalls = [];
  httpState.closeMock.mockReset();
  httpState.closeMock.mockImplementation((cb?: () => void) => {
    cb?.();
  });
  mockedOpen.mockReset();
  mockedOpen.mockResolvedValue(
    undefined as unknown as Awaited<ReturnType<typeof open>>,
  );
  mockedExchange.mockReset();
  mockedSaveTokens.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  // Complete any flow the test left in flight so the module-level
  // pendingAuthUrl is cleared before the next test runs.
  if (httpState.handler) {
    simulateCallback({ code: "cleanup", state: authUrlState() });
    await flushMicrotasks();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("performLogin", () => {
  it("starts the callback listener on 127.0.0.1:1837", async () => {
    await performLogin();
    expect(httpState.listenCalls).toEqual([{ port: 1837, host: "127.0.0.1" }]);
  });

  it("returns immediately with the authorization URL in the message", async () => {
    const result = await performLogin();

    expect(result.success).toBe(true);
    expect(result.message).toContain(AUTH_ENDPOINT);

    const url = urlFromMessage(result.message);
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(url.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("attempts to open the browser with the authorization URL", async () => {
    await performLogin();
    await flushMicrotasks();

    expect(mockedOpen).toHaveBeenCalledTimes(1);
    const opened = new URL(mockedOpen.mock.calls[0][0] as string);
    expect(opened.origin + opened.pathname).toBe(AUTH_ENDPOINT);
  });

  it("does not block on a browser-open failure — still returns the URL", async () => {
    mockedOpen.mockRejectedValueOnce(new Error("no display"));

    const result = await performLogin();

    expect(result.success).toBe(true);
    expect(result.message).toContain(AUTH_ENDPOINT);
  });

  it("exchanges the code and saves tokens after a successful callback", async () => {
    mockedExchange.mockResolvedValueOnce({
      accessToken: "acc",
      refreshToken: "ref",
      expiresAt: Date.now() + 3_600_000,
    });

    await performLogin();
    await flushMicrotasks();

    simulateCallback({ code: "auth-code", state: authUrlState() });
    await flushMicrotasks();

    expect(mockedExchange).toHaveBeenCalledWith(
      "auth-code",
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    );
    expect(mockedSaveTokens).toHaveBeenCalledTimes(1);
  });

  it("does not exchange tokens when the callback state does not match", async () => {
    await performLogin();
    await flushMicrotasks();

    simulateCallback({ code: "auth-code", state: "bogus-state" });
    await flushMicrotasks();

    expect(mockedExchange).not.toHaveBeenCalled();
    expect(mockedSaveTokens).not.toHaveBeenCalled();
  });

  it("hands back the same URL when a login is already in progress", async () => {
    const first = await performLogin();
    const second = await performLogin();

    expect(second.success).toBe(true);
    expect(second.message).toContain("already in progress");
    expect(urlFromMessage(second.message).toString()).toBe(
      urlFromMessage(first.message).toString(),
    );
    // Only one callback server was ever started.
    expect(httpState.listenCalls).toHaveLength(1);
  });

  it("clears the in-flight flow after the login window times out", async () => {
    vi.useFakeTimers();

    await performLogin();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

    expect(httpState.closeMock).toHaveBeenCalled();
    expect(mockedExchange).not.toHaveBeenCalled();

    // pendingAuthUrl is cleared, so a fresh login starts a new listener.
    vi.useRealTimers();
    await performLogin();
    expect(httpState.listenCalls).toHaveLength(2);
  });
});
