// What a CONNECTOR caller is told about signing in (self-hosted beta E3, issue
// #3995). Each wording is pinned whole: the text is the feature, and the first
// one is the message measured live to reach the user unchanged (issue #3529,
// item 10). The worker and the desktop must read exactly as they did.
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_OPENROUTER_KEY_MISSING_MESSAGE,
  HOSTED_LOGIN_UNAVAILABLE,
  HOSTED_REAUTH_INSTRUCTION,
  HOSTED_SESSION_MANAGED_MESSAGE,
  OPENROUTER_API_KEY_MISSING_MESSAGE,
  connectorLoginMessage,
  connectorLogoutMessage,
  connectorReauthMessage,
  connectorSignInUrl,
  getOpenRouterApiKey,
  isConnector,
  rejectedTokenMessage,
} from "../../src/auth/config.js";
import { bearerPrincipal, connectorPrincipal, localPrincipal } from "../../src/auth/principal.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { loginTool } from "../../src/tools/login.js";
import { logoutTool } from "../../src/tools/logout.js";

const LINK = "https://beta.example/auth/familysearch/login";
const connector = (config: Record<string, unknown> = { webPublicUrl: "https://beta.example" }, accessToken = "fs-token") =>
  connectorPrincipal({ accessToken, userId: "u_1", config });
const worker = bearerPrincipal("worker-token", { webPublicUrl: "https://beta.example" });
// The overlay wins over the developer's own config.json, so this is the desktop.
const desktop = localPrincipal({ hosted: false });

describe("the connector's sign-in link", () => {
  it("is the web tier's FamilySearch sign-in page, for a connector caller only", () => {
    expect(connectorSignInUrl(connector())).toBe(LINK);
    // One trailing slash, or several, never doubles up in the link.
    expect(connectorSignInUrl(connector({ webPublicUrl: "https://beta.example//" }))).toBe(LINK);
    expect(connectorSignInUrl(worker)).toBeUndefined();
    expect(connectorSignInUrl(desktop)).toBeUndefined();
    expect(connectorSignInUrl(connector({}))).toBeUndefined();
    expect(connectorSignInUrl(connector({ webPublicUrl: "  " }))).toBeUndefined();
  });

  it("isConnector is true for the connector door alone", () => {
    expect(isConnector(connector())).toBe(true);
    expect(isConnector(worker)).toBe(false);
    expect(isConnector(desktop)).toBe(false);
  });
});

describe("a FamilySearch session that is not accepted", () => {
  const MEASURED =
    `FamilySearch session not accepted. Sign in again at ${LINK}, ` +
    'then come back here and say "continue". Nothing is lost.';

  it("gives a connector caller the measured message, with the link and no stop order", async () => {
    expect(connectorReauthMessage(connector())).toBe(MEASURED);
    expect(await rejectedTokenMessage(connector())).toBe(MEASURED);
    // Whatever desktop text the tool passes, the connector never gets it.
    expect(await rejectedTokenMessage(connector(), "call the login tool")).toBe(MEASURED);
    for (const banned of [/login tool/i, /Reconnect FamilySearch/, /\bstop\b/i, /do not/i]) {
      expect(MEASURED).not.toMatch(banned);
    }
  });

  it("names the site when the server was given no public URL, rather than a broken link", () => {
    expect(connectorReauthMessage(connector({}))).toBe(
      "FamilySearch session not accepted. Sign in again at the Genealogy Research site, " +
        'then come back here and say "continue". Nothing is lost.',
    );
  });

  it("leaves the worker's message exactly as it was: turn.py matches its text", async () => {
    expect(await rejectedTokenMessage(worker)).toBe(HOSTED_REAUTH_INSTRUCTION);
    expect(await rejectedTokenMessage(worker, "call the login tool")).toBe(HOSTED_REAUTH_INSTRUCTION);
    expect(HOSTED_REAUTH_INSTRUCTION).toContain('Click "Reconnect FamilySearch"');
  });

  it("leaves the desktop each tool's own text", async () => {
    expect(await rejectedTokenMessage(desktop, "call the login tool to re-authenticate")).toBe(
      "call the login tool to re-authenticate",
    );
  });

  it("a request that carries no FamilySearch token is told the same, by surface", async () => {
    await expect(getValidToken(connector(undefined, ""))).rejects.toThrow(MEASURED);
    await expect(getValidToken(bearerPrincipal("", {}))).rejects.toThrow(HOSTED_REAUTH_INSTRUCTION);
    expect(await getValidToken(connector())).toBe("fs-token");
  });
});

describe("login and logout for a connector caller", () => {
  it("login names the link and claims nothing about the session", async () => {
    const answer = await loginTool({}, connector());
    expect(answer).toEqual({ success: false, message: connectorLoginMessage(connector()) });
    expect(answer.message).toBe(
      "The login tool does not sign anyone in here, and this answer says nothing about " +
        "whether the current FamilySearch session works. Only if a FamilySearch tool itself " +
        `reported a sign-in problem, tell the user to sign in again at ${LINK}, ` +
        'then say "continue". An image that fails with 403 is most likely restricted, not a sign-in problem.',
    );
    // login is called after an image 403 with a working token: an answer that
    // said the session was rejected confirmed the wrong diagnosis.
    expect(answer.message).not.toMatch(/not accept/i);
  });

  it("login is unchanged for the worker", async () => {
    expect(await loginTool({}, worker)).toEqual({ success: false, message: HOSTED_LOGIN_UNAVAILABLE });
  });

  it("logout sends a connector caller to the web tier and says what signing out there does", async () => {
    expect(await logoutTool({}, connector())).toEqual({
      success: false,
      message:
        "Signing out happens at https://beta.example: tell the user to sign out there. " +
        "That also disconnects Claude from Genealogy Research until they reconnect.",
    });
    expect(connectorLogoutMessage(connector({}))).toContain("at the Genealogy Research site:");
  });

  it("logout is unchanged for the worker", async () => {
    expect(await logoutTool({}, worker)).toEqual({ success: false, message: HOSTED_SESSION_MANAGED_MESSAGE });
  });
});

describe("a missing OpenRouter key", () => {
  it("tells a connector caller it is turned on per account, and names no settings page or file", async () => {
    await expect(getOpenRouterApiKey(connector())).rejects.toThrow(CONNECTOR_OPENROUTER_KEY_MISSING_MESSAGE);
    expect(CONNECTOR_OPENROUTER_KEY_MISSING_MESSAGE).toBe(
      "Reading images is not turned on for this account, so this image was not transcribed. " +
        "Tell the user it is turned on per account by the beta's administrator, and carry on " +
        "without this image. Do not ask the user to paste a key into the chat.",
    );
    for (const banned of [/config\.json/, /Claude Desktop/, /Extensions/, /openrouter\.ai/]) {
      expect(CONNECTOR_OPENROUTER_KEY_MISSING_MESSAGE).not.toMatch(banned);
    }
  });

  it("is unchanged for the worker and the desktop, and a key that is set is returned", async () => {
    await expect(getOpenRouterApiKey(worker)).rejects.toThrow(OPENROUTER_API_KEY_MISSING_MESSAGE);
    await expect(getOpenRouterApiKey(localPrincipal({ openRouterApiKey: "  " }))).rejects.toThrow(
      OPENROUTER_API_KEY_MISSING_MESSAGE,
    );
    expect(await getOpenRouterApiKey(connector({ openRouterApiKey: "or-key" }))).toBe("or-key");
  });
});
