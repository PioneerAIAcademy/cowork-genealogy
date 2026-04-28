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
  clientId?: string;
}
