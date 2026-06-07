import { clearTokens } from "../auth/tokenManager.js";

export type LogoutToolInput = Record<string, never>;

export interface LogoutToolResult {
  success: boolean;
  message: string;
}

export async function logoutTool(
  _input: LogoutToolInput = {} as LogoutToolInput
): Promise<LogoutToolResult> {
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
