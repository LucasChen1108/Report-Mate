// client.ts — the single HTTP seam between the frontend and the Go backend.
//
// SCOPE (task 11.3 / shell): this module holds what every api/* module needs:
// the base URL, the typed error classes the pages already catch, and the
// internal `request<T>` helper that is the ONE place `fetch` is called
// (src/api/README.md). It was extracted verbatim out of api/templates.ts so
// the reports, dashboard, and attachments clients written next wave inherit
// the same error contract instead of re-inventing one per module.
//
// WHY ONE HELPER: cross-cutting concerns live here and nowhere else —
//   - base URL resolution (VITE_API_BASE_URL),
//   - the Authorization header (attached once, below, from the stored token),
//   - status -> typed rejection mapping (422 / 403 / everything else).
// A page that wants a new endpoint writes a one-line wrapper, not another
// fetch with its own half-correct error handling.
//
// AUTHORITY NOTE: the token is read from localStorage through getStoredToken()
// below, the same helper auth/AuthContext.tsx writes through. When the auth
// agent lands real login, it keeps writing that key and this file needs no
// change.

// The structured body the backend returns on a 422 validation failure. The
// builder maps this to a message and highlights the offending element via
// `elementId` (Req 5.6).
export interface ValidationError {
  code: "validation_error";
  message: string;
  elementId: string | null; // offending field/section id when applicable
}

// Typed rejection carrying the backend's ValidationError body (HTTP 422). The
// builder catches this to surface the message and highlight `elementId`.
export class ApiValidationError extends Error {
  readonly code = "validation_error" as const;
  readonly elementId: string | null;

  constructor(body: ValidationError) {
    super(body.message);
    this.name = "ApiValidationError";
    this.elementId = body.elementId;
    // Restore the prototype chain when targeting older transpile settings.
    Object.setPrototypeOf(this, ApiValidationError.prototype);
  }
}

// Typed rejection for an authorization failure (HTTP 403). Surfaced distinctly
// so the builder can present an access-denied message (Req 6.1, 6.2).
export class ApiAuthorizationError extends Error {
  constructor(message = "You are not authorized to perform this action.") {
    super(message);
    this.name = "ApiAuthorizationError";
    Object.setPrototypeOf(this, ApiAuthorizationError.prototype);
  }
}

// Generic rejection for any other non-2xx response.
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

// Configurable base URL. The paths in each api/* module already include the
// `/api` prefix, so the base defaults to an empty string and the Vite dev proxy
// (vite.config.ts) forwards `/api` to the Go server. Override with
// VITE_API_BASE_URL (e.g. a full origin) when the API lives on a different host.
export const BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// The localStorage key holding the bearer token. Exported so auth/AuthContext
// writes through the same constant rather than a duplicated string literal.
export const TOKEN_STORAGE_KEY = "reportmate.token";

// Read the stored bearer token, or null when there is none. Wrapped in
// try/catch because localStorage throws in a few browser configurations
// (private mode, blocked site data) and a missing token must degrade to an
// unauthenticated request, not an app crash.
export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Type guard for a well-formed ValidationError body.
export function isValidationErrorBody(value: unknown): value is ValidationError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    body.code === "validation_error" &&
    typeof body.message === "string" &&
    (body.elementId === null || typeof body.elementId === "string")
  );
}

// Internal request helper: the single point where fetch is called. It sets the
// JSON content type, serializes the body, attaches the auth token, and maps the
// response to either a parsed value or a typed rejection.
//
// FormData bodies (attachment/photo uploads) are passed through UNSERIALIZED
// and WITHOUT a Content-Type header — the browser must set that header itself
// so it can append the multipart boundary parameter. Setting it by hand
// produces a boundary-less multipart request the backend cannot parse.
export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const headers: Record<string, string> = {};
  if (!isFormData && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: isFormData
      ? (body as FormData)
      : body === undefined
        ? undefined
        : JSON.stringify(body),
  });

  if (response.ok) {
    // 204 No Content and empty bodies decode to undefined; callers of this
    // client always expect a JSON body, but guard against an empty payload.
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // 422 -> typed validation rejection carrying the ValidationError body.
  if (response.status === 422) {
    const parsed = await response.json().catch(() => null);
    if (isValidationErrorBody(parsed)) {
      throw new ApiValidationError(parsed);
    }
    throw new ApiValidationError({
      code: "validation_error",
      message: "The template failed validation.",
      elementId: null,
    });
  }

  // 403 -> distinct authorization rejection.
  if (response.status === 403) {
    const parsed = (await response.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    const message =
      parsed && typeof parsed.message === "string" ? parsed.message : undefined;
    throw new ApiAuthorizationError(message);
  }

  // Any other non-2xx -> generic error.
  const detail = await response.text().catch(() => "");
  throw new ApiError(
    response.status,
    detail || `Request failed with status ${response.status}`,
  );
}
