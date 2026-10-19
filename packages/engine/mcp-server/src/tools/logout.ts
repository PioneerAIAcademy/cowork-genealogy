import type { Principal } from "../auth/principal.js";
import { clearTokens } from "../auth/tokenManager.js";
import { HOSTED_SESSION_MANAGED_MESSAGE } from "../auth/config.js";

export type LogoutToolInput = Record<string, never>;

export interface LogoutToolResult {
  success: boolean;
  message: string;
}

export async function logoutTool(
  _input: LogoutToolInput,
  principal: Principal
): Promise<LogoutToolResult> {
  // A bearer principal has no token file to clear: the web tier owns the
  // session, so sign-out happens there.
  if (principal.kind === "bearer") {
    return { success: false, message: HOSTED_SESSION_MANAGED_MESSAGE };
  }
  await clearTokens();
  return {
    success: true,
    message: "Logged out of FamilySearch. Stored tokens have been cleared.",
  };
}

export const logoutToolSchema = {
  name: "logout",
  description:
    "Clear the stored FamilySearch tokens, ending the current session. " +
    "Safe to call even when not logged in.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};
