import type { Principal } from "../auth/principal.js";
import { performLogin } from "../auth/login.js";
import { isHostedMode, HOSTED_LOGIN_UNAVAILABLE } from "../auth/config.js";
import type { LoginResult } from "../types/auth.js";

export type LoginToolInput = Record<string, never>;

export async function loginTool(
  _input: LoginToolInput,
  principal: Principal
): Promise<LoginResult> {
  // In the hosted VM the loopback OAuth flow is unrecoverable: the callback
  // listener binds the sandbox's 127.0.0.1:1837, but the registered redirect
  // resolves on the user's laptop. Starting it would return a confident
  // "a browser tab should have opened" that can never succeed (the alpha-user
  // report). Refuse, without claiming the session was rejected: this answer
  // checks nothing, and an agent that called login after an image 403 read the
  // old "not accepting this session" text as confirmation.
  if (await isHostedMode(principal)) {
    return { success: false, message: HOSTED_LOGIN_UNAVAILABLE };
  }
  return performLogin();
}

export const loginToolSchema = {
  name: "login",
  description:
    "Start the FamilySearch OAuth login flow. Opens the user's browser for authorization " +
    "and saves the resulting tokens to ~/.familysearch-mcp/tokens.json. " +
    "Must be called before using tools that require authentication.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};
