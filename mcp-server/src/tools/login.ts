import { performLogin } from "../auth/login.js";
import type { LoginResult } from "../types/auth.js";

export interface LoginToolInput {
  clientId?: string;
}

export async function loginTool(
  input: LoginToolInput = {}
): Promise<LoginResult> {
  return performLogin({ clientId: input.clientId });
}

export const loginToolSchema = {
  name: "login",
  description:
    "Start the FamilySearch OAuth login flow. Opens the user's browser for authorization " +
    "and saves the resulting tokens to ~/.familysearch-mcp/tokens.json. " +
    "Must be called before using tools that require authentication. " +
    "If the user has not yet configured their FamilySearch client ID, pass it as `clientId` " +
    "and it will be written to ~/.familysearch-mcp/config.json automatically.",
  inputSchema: {
    type: "object",
    properties: {
      clientId: {
        type: "string",
        description:
          "Optional FamilySearch developer app key. When provided, it is saved to " +
          "~/.familysearch-mcp/config.json before the OAuth flow starts (first-time bootstrap). " +
          "Omit on subsequent calls — the stored value will be used.",
      },
    },
  },
};
