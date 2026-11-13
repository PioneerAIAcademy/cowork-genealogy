// Whether FamilySearch still accepts a connector caller's session (self-hosted
// beta E3, issue #3995): the check behind `project_context`'s and
// `auth_status`'s `signInUrl`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bearerPrincipal, connectorPrincipal, LOCAL } from "../../src/auth/principal.js";
import { authStatusTool } from "../../src/tools/auth-status.js";
import {
  SESSION_CHECK_TTL_MS,
  __resetSessionChecksForTests,
  connectorSession,
} from "../../src/utils/session-check.js";
import { __resetUserLimitsForTests } from "../../src/utils/user-limits.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const answer = (status: number) => new Response("{}", { status });
const connector = (accessToken = "fs-token", userId = "u_1") =>
  connectorPrincipal({ accessToken, userId, config: { webPublicUrl: "https://beta.example" } });

beforeEach(() => {
  mockFetch.mockReset();
  __resetSessionChecksForTests();
  __resetUserLimitsForTests();
});

describe("connectorSession", () => {
  it("asks FamilySearch's current-user endpoint with the caller's own token", async () => {
    mockFetch.mockResolvedValue(answer(200));
    expect(await connectorSession(connector())).toBe("live");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.familysearch.org/platform/users/current");
    expect(new Headers((init as RequestInit).headers).get("authorization")).toBe("Bearer fs-token");
  });

  it("is ended on a 401, and only on a 401", async () => {
    mockFetch.mockResolvedValue(answer(401));
    expect(await connectorSession(connector())).toBe("ended");
  });

  it.each([403, 429, 500, 503])("learns nothing from a %i: an outage must not send a signed-in user to sign in", async (status) => {
    mockFetch.mockResolvedValue(answer(status));
    expect(await connectorSession(connector())).toBeUndefined();
  });

  it("learns nothing when the request fails, and never throws", async () => {
    mockFetch.mockRejectedValue(new Error("socket hang up"));
    expect(await connectorSession(connector())).toBeUndefined();
  });

  it("asks nothing for a worker or the desktop", async () => {
    expect(await connectorSession(bearerPrincipal("worker-token", {}))).toBeUndefined();
    expect(await connectorSession(LOCAL)).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a connector caller with no FamilySearch token is ended, without a request", async () => {
    expect(await connectorSession(connector(""))).toBe("ended");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("remembers an answer for a user, briefly", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    mockFetch.mockResolvedValue(answer(401));
    expect(await connectorSession(connector(), now)).toBe("ended");
    clock += SESSION_CHECK_TTL_MS - 1;
    expect(await connectorSession(connector(), now)).toBe("ended");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    clock += 1;
    expect(await connectorSession(connector(), now)).toBe("ended");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("a new token is a new question at once: signing in again shows on the next call", async () => {
    mockFetch.mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(200));
    expect(await connectorSession(connector("old-token"))).toBe("ended");
    expect(await connectorSession(connector("new-token"))).toBe("live");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps one user's answer from another's", async () => {
    mockFetch.mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(200));
    expect(await connectorSession(connector("token-a", "u_a"))).toBe("ended");
    expect(await connectorSession(connector("token-b", "u_b"))).toBe("live");
    expect(await connectorSession(connector("token-a", "u_a"))).toBe("ended");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not remember an answer it never got", async () => {
    mockFetch.mockResolvedValueOnce(answer(500)).mockResolvedValueOnce(answer(401));
    expect(await connectorSession(connector())).toBeUndefined();
    expect(await connectorSession(connector())).toBe("ended");
  });
});

describe("auth_status for a connector caller", () => {
  it("reports the account, and the sign-in link once the session has ended", async () => {
    mockFetch.mockResolvedValue(answer(401));
    expect(await authStatusTool({}, connector())).toMatchObject({
      loggedIn: false,
      accountId: "u_1",
      signInUrl: "https://beta.example/auth/familysearch/login",
    });
  });

  it("is logged in, with no link, while FamilySearch accepts the session", async () => {
    mockFetch.mockResolvedValue(answer(200));
    const status = await authStatusTool({}, connector());
    expect(status).toMatchObject({ loggedIn: true, accountId: "u_1" });
    expect(status).not.toHaveProperty("signInUrl");
  });

  it("reads as before when the check learns nothing", async () => {
    mockFetch.mockResolvedValue(answer(503));
    const status = await authStatusTool({}, connector());
    expect(status).toMatchObject({ loggedIn: true, accountId: "u_1" });
    expect(status).not.toHaveProperty("signInUrl");
  });

  it("is unchanged for the worker: no request, no account, no link", async () => {
    const status = await authStatusTool({}, bearerPrincipal("worker-token", {}));
    expect(Object.keys(status).sort()).toEqual(["buildId", "loggedIn"]);
    expect(status.loggedIn).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
