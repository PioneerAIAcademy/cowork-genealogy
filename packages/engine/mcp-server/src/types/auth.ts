export interface TokenStore {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface LoginResult {
  success: boolean;
  message: string;
}

export interface AuthStatusResult {
  loggedIn: boolean;
  expiresAt?: string;
  expiresInMinutes?: number;
  hasRefreshToken?: boolean;
}

export interface FSTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

export interface AppConfig {
  /**
   * Set by the hosted control plane when it provisions a sandbox. Marks a
   * runtime where the loopback OAuth `login` flow cannot complete, so the auth
   * errors must send the user to the web app's "Reconnect FamilySearch" button
   * instead of to the `login` tool. Absent on the desktop `.mcpb`, where
   * loopback login is the correct path.
   */
  hosted?: boolean;
  wikiApiUrl?: string;
  popStatsUrl?: string;
  learningCenterDir?: string;
  libraryDir?: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
}
