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
    listen: vi.fn((port: unknown, host: unknown) => {
      httpState.listenCalls.push({ port, host });
      return fakeServer;
    }),
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
    saveConfig: vi.fn().mockResolvedValue(undefined),
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

function flushMicrotasks(times = 5): Promise<void> {
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
  const req = { url: `/callback?${new URLSearchParams(query).toString()}` } as IncomingMessage;
  const res = {
    writeHead: vi.fn().mockReturnThis(),
    end: vi.fn(),
  } as unknown as ServerResponse;
  httpState.handler(req, res);
}

function authUrlState(): string {
  const url = mockedOpen.mock.calls[0][0] as string;
  return new URL(url).searchParams.get("state") ?? "";
}

beforeEach(() => {
  httpState.handler = undefined;
  httpState.listenCalls = [];
  httpState.closeMock.mockReset();
  httpState.closeMock.mockImplementation((cb?: () => void) => {
    cb?.();
  });
  mockedOpen.mockReset();
  mockedOpen.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof open>>);
  mockedExchange.mockReset();
  mockedSaveTokens.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("performLogin", () => {
  it("starts the callback server on 127.0.0.1:1837", async () => {
    mockedExchange.mockResolvedValueOnce({
      accessToken: "a",
      expiresAt: Date.now() + 3_600_000,
    });

    const loginPromise = performLogin();
    await flushMicrotasks();

    expect(httpState.listenCalls).toEqual([{ port: 1837, host: "127.0.0.1" }]);

    simulateCallback({ code: "c", state: authUrlState() });
    const result = await loginPromise;
    expect(result.success).toBe(true);
  });

  it("opens the browser with the authorization URL containing the expected OAuth parameters", async () => {
    mockedExchange.mockResolvedValueOnce({
      accessToken: "a",
      expiresAt: Date.now() + 3_600_000,
    });

    const loginPromise = performLogin();
    await flushMicrotasks();

    expect(mockedOpen).toHaveBeenCalledTimes(1);
    const opened = new URL(mockedOpen.mock.calls[0][0] as string);
    expect(opened.origin + opened.pathname).toBe(
      "https://ident.familysearch.org/cis-web/oauth2/v3/authorization"
    );
    expect(opened.searchParams.get("client_id")).toBe("test-client-id");
    expect(opened.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(opened.searchParams.get("response_type")).toBe("code");
    expect(opened.searchParams.get("scope")).toBe("offline_access");
    expect(opened.searchParams.get("code_challenge_method")).toBe("S256");
    expect(opened.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(opened.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/);

    simulateCallback({ code: "c", state: authUrlState() });
    await loginPromise;
  });

  it("exchanges the code for tokens and saves them on a successful callback", async () => {
    mockedExchange.mockResolvedValueOnce({
      accessToken: "acc",
      refreshToken: "ref",
      expiresAt: Date.now() + 3_600_000,
    });

    const loginPromise = performLogin();
    await flushMicrotasks();

    simulateCallback({ code: "auth-code", state: authUrlState() });
    const result = await loginPromise;

    expect(result).toEqual({ success: true, message: "Login successful." });
    expect(mockedExchange).toHaveBeenCalledWith(
      "auth-code",
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    );
    expect(mockedSaveTokens).toHaveBeenCalledTimes(1);
  });

  it("returns a failure message on state mismatch and does not exchange tokens", async () => {
    const loginPromise = performLogin();
    await flushMicrotasks();

    simulateCallback({ code: "auth-code", state: "bogus-state" });
    const result = await loginPromise;

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/state mismatch/);
    expect(mockedExchange).not.toHaveBeenCalled();
    expect(mockedSaveTokens).not.toHaveBeenCalled();
  });

  it("returns a timeout failure when no callback arrives within the login window", async () => {
    vi.useFakeTimers();

    const loginPromise = performLogin();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    const result = await loginPromise;

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/timed out/);
    expect(mockedExchange).not.toHaveBeenCalled();
  });
});
