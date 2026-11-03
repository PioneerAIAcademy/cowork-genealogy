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
  /** The engine build (`<base>+<date>.<sha>[.dirty]` or `<base>+dev`), on every branch — #2126. */
  buildId: string;
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
  openRouterApiKey?: string;
  openRouterModel?: string;
  /** The web tier's public origin. Set, `project_create` and `project_context`
   *  return `projectUrl` (`<origin>/#/p/<id>`) for a store that knows its
   *  project id (src/utils/project-links.ts). */
  webPublicUrl?: string;
  /** On, `project_context` also returns `uploadUrl` (`<projectUrl>/upload`). */
  uploadsEnabled?: boolean;
  /** The beta's transcription switch. Unset means run as today. Its reader is
   *  issue #3996. */
  transcriptionEnabled?: boolean;
  /** Which matcher scores `same_person` and ranking: `"familysearch"` (the default) or `"service"`. */
  matcher?: "familysearch" | "service";
  /** The matcher service's base URL; required when `matcher` is `"service"`. */
  matcherUrl?: string;
  /** This caller's bearer key for the matcher service; required when `matcher` is `"service"`. */
  matcherApiKey?: string;
}
