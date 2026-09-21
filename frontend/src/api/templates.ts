// Typed API client for report templates.
//
// This module is the ONLY path from the frontend to the backend for template
// operations (Req 5.7). All fetch calls go through the shared `request` helper
// in ./client — no component should call `fetch` directly.
//
// The helper and the typed error classes used to live in this file; they moved
// to ./client when the reports/dashboard/attachments clients needed the same
// ones. This module's exported surface is unchanged: it re-exports those error
// types so importers see no difference.
//
// The client is typed against the shared `TemplateSchema` contract in
// ./types, so the builder, this client, and the backend all reference one
// schema shape.

import { request } from "./client";
// The error contract lives in ./client now (it is shared by every api/* module).
// Re-exported here so existing importers — the builder catches all three by
// name from this module — keep working unchanged.
export {
  ApiValidationError,
  ApiAuthorizationError,
  ApiError,
} from "./client";
export type { ValidationError } from "./client";

import type { TemplateSchema } from "./types";

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

// GET /api/templates — list seed and custom templates (Req 5.4, 7.3).
export function listTemplates(): Promise<TemplateSummary[]> {
  return request<TemplateSummary[]>("GET", "/api/templates");
}

// GET /api/templates/{id} — load one template into the editor (Req 5.2).
export function getTemplate(id: string): Promise<TemplateRecord> {
  return request<TemplateRecord>(
    "GET",
    `/api/templates/${encodeURIComponent(id)}`,
  );
}

// POST /api/templates — create a new template (Req 5.1).
export function createTemplate(input: {
  name: string;
  schema: TemplateSchema;
}): Promise<TemplateRecord> {
  return request<TemplateRecord>("POST", "/api/templates", input);
}

// PUT /api/templates/{id} — update an existing template (Req 5.3).
export function updateTemplate(
  id: string,
  input: { name: string; schema: TemplateSchema },
): Promise<TemplateRecord> {
  return request<TemplateRecord>(
    "PUT",
    `/api/templates/${encodeURIComponent(id)}`,
    input,
  );
}
