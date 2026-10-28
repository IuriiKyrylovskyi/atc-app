export interface User {
  sub: string; // User ID from IDP
  upn: string; // User Principal Name
  name: string;
  email: string;
  avatar?: string;
  amr: string[]; // Authentication Methods References (pwd, otp)
  acr: string; // Authentication Context Class Reference
  auth_time: number;
  mfa_time?: number;
  enabled?: boolean;
}

export interface LoginCredentials {
  username: string;
  password: string;
  otp?: string; // One-Time Password for MFA
}

export interface StepUpCredentials {
  otp: string;
  backup_code?: string | null;
  client_id: string;
  return_to: string;
}

export interface AuthResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  mfaRequired: boolean;
  expiresAt: number | null;
}

export interface JWTPayload {
  iss: string; // Issuer
  aud: string; // Audience
  sub: string; // Subject (user ID)
  upn: string; // User Principal Name
  name: string;
  email: string;
  amr: string[]; // Authentication methods
  acr: string; // Authentication context
  auth_time: number;
  iat: number; // Issued at
  exp: number; // Expiration
  jti: string; // JWT ID
  mfa_time?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface MeResponse {
  sub: string;
  upn: string;
  name: string;
  email: string;
  amr: string[];
  acr: string;
  auth_time: number;
  mfa_time?: number;
  iat: number;
  exp: number;
  expires_in: number;
  jti: string;
  iss: string;
  aud: string;
}
