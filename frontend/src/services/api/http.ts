import type { ServiceErrorCode } from "../../auth/contracts";
import { ServiceError } from "../errors";

const SERVICE_ERROR_CODES = new Set<ServiceErrorCode>([
  "invalid_credentials",
  "inactive_account",
  "session_expired",
  "invalid_code",
  "expired_code",
  "revoked_code",
  "used_code",
  "company_mismatch",
  "conflict",
  "validation_error",
  "unauthenticated",
  "forbidden",
  "not_found",
  "rate_limited",
  "network_error",
  "internal_error",
]);

interface ApiErrorBody {
  code?: unknown;
  message?: unknown;
  field?: unknown;
}

function fallbackCode(status: number): ServiceErrorCode {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation_error";
  if (status === 429) return "rate_limited";
  return "internal_error";
}

export async function apiRequest<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ServiceError({
      code: "network_error",
      message: "Could not reach the server. Please try again.",
    });
  }

  const text = await response.text();
  const parsed = text
    ? (() => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return null;
        }
      })()
    : undefined;

  if (response.ok) return parsed as T;

  const errorBody =
    typeof parsed === "object" && parsed !== null
      ? (parsed as ApiErrorBody)
      : null;
  const code =
    typeof errorBody?.code === "string" &&
    SERVICE_ERROR_CODES.has(errorBody.code as ServiceErrorCode)
      ? (errorBody.code as ServiceErrorCode)
      : fallbackCode(response.status);
  const message =
    typeof errorBody?.message === "string"
      ? errorBody.message
      : `Request failed with status ${response.status}`;
  const field =
    typeof errorBody?.field === "string" ? errorBody.field : undefined;
  throw new ServiceError({ code, message, field, status: response.status });
}
