import { performLogin } from "../auth/login.js";
import type { LoginResult } from "../types/auth.js";

export type LoginToolInput = Record<string, never>;

export async function loginTool(
  _input: LoginToolInput = {} as LoginToolInput
): Promise<LoginResult> {
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
