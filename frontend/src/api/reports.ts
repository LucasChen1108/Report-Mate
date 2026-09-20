// Typed API client for service reports.
//
// This module is the ONLY path from the frontend to the backend for report
// operations — the same rule api/templates.ts follows (src/api/README.md). No
// component calls `fetch` directly; each endpoint gets one thin wrapper here so
// the base URL, the auth header, and the 422/403 error mapping stay in
// ./client and nowhere else.
//
// The request/response shapes come from ./reportTypes, which is FROZEN — four
// agents compiled against it in parallel. This file adds no types of its own
// beyond the request bodies, which are inputs the backend accepts rather than
// part of the shared contract.
//
// NOTE ON `content`: the wire `ReportContent` types each field value as
// `unknown` on purpose. The editor's precise FieldValue union lives in
// pages/ReportEditor/reportContent.ts and is converted at the API boundary
// (contentFromWire / contentToWire) — see the header of that module for why the
// two are deliberately not merged.

import { request } from "./client";
// The error contract lives in ./client and is shared by every api/* module.
// Re-exported here, exactly as api/templates.ts does, so a page importing the
// report client catches the same three classes by name from one module.
export {
  ApiValidationError,
  ApiAuthorizationError,
  ApiError,
} from "./client";
export type { ValidationError } from "./client";

import type {
  ListReportsResult,
  ReportContent,
  ReportRecord,
  SaveAndExportResponse,
} from "./reportTypes";

// ListReportsResult moved to ./reportTypes, where every other wire shape is
// declared. Re-exported so importing it from the client module — the natural
// place to look for the return type of listReports — still works.
export type { ListReportsResult } from "./reportTypes";

// Body of POST /api/reports. The server snapshots the template's current schema
// and revision onto the new draft, so only the template id is required; the
// optional fields pre-fill a report raised from a job.
export interface CreateReportInput {
  templateId: string;
  jobId?: string;
  customerName?: string;
}

// Body of PUT /api/reports/{id} and POST /api/reports/{id}/save-and-export.
// The two endpoints take the same body and differ only in what the server does
// with it: the PUT is a plain draft save with NO required-field check, the POST
// validates, marks the report exported, and returns an export URL.
export interface SaveReportInput {
  content: ReportContent;
  customerName?: string;
  title?: string;
}

// POST /api/reports — create the draft. The editor calls this up front, before
// the technician types anything, so every later save is a plain PUT and the
// page never branches on create-vs-update.
export function createReport(input: CreateReportInput): Promise<ReportRecord> {
  return request<ReportRecord>("POST", "/api/reports", input);
}

// GET /api/reports/{id} — load a saved report. Its `schemaSnapshot` (not the
// template's current schema) is what the editor renders, so reopening an old
// report shows the form as it was at fill time.
export function getReport(id: string): Promise<ReportRecord> {
  return request<ReportRecord>("GET", `/api/reports/${encodeURIComponent(id)}`);
}

// PUT /api/reports/{id} — draft save. Deliberately does NOT enforce required
// fields: a technician mid-job must be able to park a half-filled report.
export function saveReport(
  id: string,
  input: SaveReportInput,
): Promise<ReportRecord> {
  return request<ReportRecord>(
    "PUT",
    `/api/reports/${encodeURIComponent(id)}`,
    input,
  );
}

// POST /api/reports/{id}/save-and-export — persist, validate, and mark the
// report exported. A required field left empty comes back as a 422 carrying the
// offending `elementId`, which the editor highlights.
export function saveAndExportReport(
  id: string,
  input: SaveReportInput,
): Promise<SaveAndExportResponse> {
  return request<SaveAndExportResponse>(
    "POST",
    `/api/reports/${encodeURIComponent(id)}/save-and-export`,
    input,
  );
}

// The filters GET /api/reports accepts. Names match the server's query
// parameters exactly (handler.go: parseListFilter), because a filter the server
// does not recognize is silently dropped and returns confidently wrong results.
export interface ListReportsFilter {
  templateId?: string;
  status?: "draft" | "submitted" | "exported";
  technicianId?: string;
  /**
   * created_at window, both bounds YYYY-MM-DD and INCLUSIVE of the named day
   * — `to=2026-09-21` includes reports filed on the 21st. The server parses
   * these with the same code as the dashboard's table endpoint
   * (backend/internal/httpx/dayparam.go), so the two agree; an RFC 3339
   * instant is rejected with a 400 by both.
   */
  from?: string;
  to?: string;
  /** Free text over the title and customer name. */
  q?: string;
  /** 1..100, default 25 server-side. */
  limit?: number;
  offset?: number;
}

// GET /api/reports — a filtered, paged list. The dashboard has its own richer
// table endpoint (ReportTableView); this is the plain collection, used for
// "my recent reports"-style lists.
//
// A technician is scoped to their own reports by the server whatever this asks
// for, so `technicianId` is only meaningful for a dispatcher.
export function listReports(
  filter?: ListReportsFilter,
): Promise<ListReportsResult> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter ?? {})) {
    // Skip empty values rather than sending `?status=`, which the server reads
    // as a present-but-blank filter.
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<ListReportsResult>("GET", `/api/reports${suffix}`);
}

// The URL the generated standalone HTML document is served from. Returned by
// save-and-export as `exportUrl`; this helper exists so a caller that only has
// an id does not hand-assemble the path. Not a `request` wrapper — the response
// is a document, not JSON, and is meant to be opened, not parsed.
export function reportExportPath(id: string): string {
  return `/api/reports/${encodeURIComponent(id)}/export`;
}
