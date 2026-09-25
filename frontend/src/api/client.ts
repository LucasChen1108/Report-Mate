import type { ServiceErrorCode } from "../auth/contracts";
import { frontendConfig } from "../config/env";
import { ServiceError } from "../services/errors";

export interface ValidationError {
  code: "validation_error";
  message: string;
  elementId: string | null;
}

interface ApiErrorBody {
  code?: unknown;
  message?: unknown;
  field?: unknown;
  elementId?: unknown;
}

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

export const SESSION_INVALID_EVENT = "reportmate:session-invalid";

export class ApiError extends ServiceError {
  declare readonly status: number;

  constructor(
    status: number,
    message: string,
    code: ServiceErrorCode = fallbackCode(status),
    field?: string,
  ) {
    super({ code, message, field, status });
    this.name = "ApiError";
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export class ApiValidationError extends ApiError {
  readonly elementId: string | null;

  constructor(body: ValidationError) {
    super(422, body.message, "validation_error");
    this.name = "ApiValidationError";
    this.elementId = body.elementId;
    Object.setPrototypeOf(this, ApiValidationError.prototype);
  }
}

export class ApiAuthorizationError extends ApiError {
  constructor(message = "You are not authorized to perform this action.") {
    super(403, message, "forbidden");
    this.name = "ApiAuthorizationError";
    Object.setPrototypeOf(this, ApiAuthorizationError.prototype);
  }
}

export interface RequestOptions {
  baseUrl?: string;
}

export const BASE_URL = frontendConfig.apiBaseUrl;

function fallbackCode(status: number): ServiceErrorCode {
  if (status === 400 || status === 422) return "validation_error";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return "internal_error";
}

function readErrorCode(value: unknown, status: number): ServiceErrorCode {
  return typeof value === "string" &&
    SERVICE_ERROR_CODES.has(value as ServiceErrorCode)
    ? (value as ServiceErrorCode)
    : fallbackCode(status);
}

function notifyInvalidSession(code: ServiceErrorCode): void {
  if (
    (code === "unauthenticated" ||
      code === "session_expired" ||
      code === "inactive_account") &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(new CustomEvent(SESSION_INVALID_EVENT));
  }
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function throwResponseError(response: Response): Promise<never> {
  const text = await response.text().catch(() => "");
  const parsed = parseBody(text);
  const body =
    typeof parsed === "object" && parsed !== null
      ? (parsed as ApiErrorBody)
      : null;
  const code = readErrorCode(body?.code, response.status);
  const message =
    typeof body?.message === "string"
      ? body.message
      : text || `Request failed with status ${response.status}`;
  const field = typeof body?.field === "string" ? body.field : undefined;

  notifyInvalidSession(code);

  if (response.status === 422 && code === "validation_error") {
    throw new ApiValidationError({
      code: "validation_error",
      message,
      elementId:
        body?.elementId === null || typeof body?.elementId === "string"
          ? body.elementId
          : null,
    });
  }
  if (response.status === 403 && code === "forbidden") {
    throw new ApiAuthorizationError(message);
  }
  throw new ApiError(response.status, message, code, field);
}

export async function requestRaw(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<Response> {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (!isFormData && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${options.baseUrl ?? BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: isFormData
        ? (body as FormData)
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    });
  } catch {
    throw new ServiceError({
      code: "network_error",
      message: "Could not reach the server. Please try again.",
    });
  }

  if (!response.ok) await throwResponseError(response);
  return response;
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const response = await requestRaw(method, path, body, options);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
