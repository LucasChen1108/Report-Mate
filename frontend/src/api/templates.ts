// Typed API client for report templates.
//
// This module is the ONLY path from the frontend to the backend for template
// operations (Req 5.7). All fetch calls are centralized in the internal
// `request` helper below — no component should call `fetch` directly.
//
// The client is typed against the shared `TemplateSchema` contract in
// ./types, so the builder, this client, and the backend all reference one
// schema shape.

import type { TemplateSchema } from "./types";
import { endpointBuilders, API_ENDPOINTS } from "../config/endpoints";
import { frontendConfig } from "../config/env";

// A lightweight summary returned by the list endpoint (Req 5.4, 7.3).
export interface TemplateSummary {
  id: string;
  name: string;
  isSeed: boolean;
  updatedAt: string;
}

// A full template record returned by get/create/update (Req 5.1, 5.2, 5.3).
export interface TemplateRecord {
  id: string;
  name: string;
  schema: TemplateSchema;
  isSeed: boolean;
  createdAt: string;
  updatedAt: string;
}

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

// Configurable base URL. Runtime configuration owns both the development
// default and environment override; endpoint paths remain centralized below.
const BASE_URL = frontendConfig.apiBaseUrl;

// Type guard for a well-formed ValidationError body.
function isValidationErrorBody(value: unknown): value is ValidationError {
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
// JSON content type, serializes the body, and maps the response to either a
// parsed value or a typed rejection.
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

// GET /api/templates — list seed and custom templates (Req 5.4, 7.3).
export function listTemplates(): Promise<TemplateSummary[]> {
  return request<TemplateSummary[]>("GET", API_ENDPOINTS.templates);
}

// GET /api/templates/{id} — load one template into the editor (Req 5.2).
export function getTemplate(id: string): Promise<TemplateRecord> {
  return request<TemplateRecord>("GET", endpointBuilders.template(id));
}

// POST /api/templates — create a new template (Req 5.1).
export function createTemplate(input: {
  name: string;
  schema: TemplateSchema;
}): Promise<TemplateRecord> {
  return request<TemplateRecord>("POST", API_ENDPOINTS.templates, input);
}

// PUT /api/templates/{id} — update an existing template (Req 5.3).
export function updateTemplate(
  id: string,
  input: { name: string; schema: TemplateSchema },
): Promise<TemplateRecord> {
  return request<TemplateRecord>("PUT", endpointBuilders.template(id), input);
}
