import { endpointBuilders, API_ENDPOINTS } from "../config/endpoints";
import { frontendConfig } from "../config/env";
import type {
  TemplateRecord,
  TemplateSummary,
  TemplateWriteInput,
} from "../services/contracts";

export type { TemplateRecord, TemplateSummary } from "../services/contracts";

export interface ValidationError {
  code: "validation_error";
  message: string;
  elementId: string | null;
}

export class ApiValidationError extends Error {
  readonly code = "validation_error" as const;
  readonly elementId: string | null;

  constructor(body: ValidationError) {
    super(body.message);
    this.name = "ApiValidationError";
    this.elementId = body.elementId;
    Object.setPrototypeOf(this, ApiValidationError.prototype);
  }
}

export class ApiAuthorizationError extends Error {
  constructor(message = "You are not authorized to perform this action.") {
    super(message);
    this.name = "ApiAuthorizationError";
    Object.setPrototypeOf(this, ApiAuthorizationError.prototype);
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

const BASE_URL = frontendConfig.apiBaseUrl;

function isValidationErrorBody(value: unknown): value is ValidationError {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    body.code === "validation_error" &&
    typeof body.message === "string" &&
    (body.elementId === null || typeof body.elementId === "string")
  );
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.ok) {
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  if (response.status === 422) {
    const parsed = await response.json().catch(() => null);
    if (isValidationErrorBody(parsed)) throw new ApiValidationError(parsed);
    throw new ApiValidationError({
      code: "validation_error",
      message: "The template failed validation.",
      elementId: null,
    });
  }

  if (response.status === 403) {
    const parsed = (await response.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    const message =
      parsed && typeof parsed.message === "string" ? parsed.message : undefined;
    throw new ApiAuthorizationError(message);
  }

  const detail = await response.text().catch(() => "");
  throw new ApiError(
    response.status,
    detail || `Request failed with status ${response.status}`,
  );
}

export function listTemplates(): Promise<TemplateSummary[]> {
  return request<TemplateSummary[]>("GET", API_ENDPOINTS.templates);
}

export function getTemplate(id: string): Promise<TemplateRecord> {
  return request<TemplateRecord>("GET", endpointBuilders.template(id));
}

export function createTemplate(input: TemplateWriteInput): Promise<TemplateRecord> {
  return request<TemplateRecord>("POST", API_ENDPOINTS.templates, input);
}

export function updateTemplate(
  id: string,
  input: TemplateWriteInput,
): Promise<TemplateRecord> {
  return request<TemplateRecord>("PUT", endpointBuilders.template(id), input);
}
