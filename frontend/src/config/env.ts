export type AuthMode = "mock" | "api";

export interface FrontendConfig {
  authMode: AuthMode;
  apiBaseUrl: string;
}

export interface FrontendEnvironment {
  VITE_AUTH_MODE?: string;
  VITE_API_BASE_URL?: string;
  PROD?: boolean;
}

export const DEFAULT_AUTH_MODE: AuthMode = "mock";
export const DEFAULT_API_BASE_URL = "";

function parseAuthMode(value: string | undefined): AuthMode {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return DEFAULT_AUTH_MODE;
  }
  if (normalized === "mock" || normalized === "api") {
    return normalized;
  }

  throw new Error(
    `Unsupported VITE_AUTH_MODE "${value}". Expected "mock" or "api".`,
  );
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim() || DEFAULT_API_BASE_URL;
  return normalized.replace(/\/+$/, "");
}

export function parseFrontendConfig(
  environment: FrontendEnvironment,
): FrontendConfig {
  const authMode = parseAuthMode(environment.VITE_AUTH_MODE);
  if (environment.PROD && authMode === "mock") {
    throw new Error(
      'VITE_AUTH_MODE must be "api" for production builds; mock accounts are development-only.',
    );
  }
  return {
    authMode,
    apiBaseUrl: normalizeApiBaseUrl(environment.VITE_API_BASE_URL),
  };
}

export const frontendConfig = parseFrontendConfig({
  VITE_AUTH_MODE: import.meta.env.VITE_AUTH_MODE,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  PROD: import.meta.env.PROD,
});
