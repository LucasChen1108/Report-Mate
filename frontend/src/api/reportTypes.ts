// reportTypes.ts — the shared report/dashboard type contract.
//
// FROZEN (task 11.3 / shell). Four agents code against these shapes in
// parallel — the report editor, the dashboard, the attachments work, and auth.
// Adding to this file after the fact desynchronizes whoever already compiled
// against it, so it is closed: treat a needed change as a conversation, not an
// edit.
//
// It sits beside ./types (the TemplateSchema contract the builder and renderer
// share) and imports from it rather than restating field shapes, so there is
// exactly one definition of a schema in the frontend.
//
// -----------------------------------------------------------------------------
// WHY `ReportTableRow.cells` IS `Record<string, string>`
//
// The dashboard's report table shows one column per template field, across the
// six field types. The obvious shape would be `Record<string, unknown>` with
// the table switching on FieldType to render each cell — a checklist as a joined
// list, a signature as a "signed" marker, a photo as a thumbnail marker, and so
// on.
//
// We deliberately do NOT do that. The BACKEND flattens every stored value to a
// DISPLAY STRING before it leaves the server:
//
//   checklist  -> "Gloves, Hard hat"   (selected options, comma-joined)
//   signature  -> "Signed"             (or "" when unsigned)
//   photo      -> a marker, e.g. "2 photos"
//   select     -> the chosen option
//   text       -> the text
//   number     -> the formatted number
//
// The table component therefore needs ZERO knowledge of field types: it prints
// `row.cells[column.fieldId]` and stops. The payoff is drift resistance — when
// a new field type is added, or a type's display convention changes, the
// formatting rule changes in ONE place (the backend) instead of in a frontend
// switch statement that someone forgets to update. `ReportTableColumn.type` is
// still carried for alignment/width hints, never for deciding how to format.
// -----------------------------------------------------------------------------

import type { TemplateSchema, FieldType } from "./types";

// The filled-in values of a report, keyed by the field id from the template
// schema. `unknown` because the shape varies by field type (string, number,
// string[], an attachment reference); the editor narrows using the schema
// snapshot it holds alongside.
export interface ReportContentValueMap {
  [fieldId: string]: unknown;
}

// One row of the Parts Used table. Quantity is a string, not a number, because
// it is an in-progress form value — "" and "3" are both legal mid-edit states.
export interface PartRow {
  id: string;
  part: string;
  partNumber: string;
  quantity: string;
}

// The full body of a report: field values, the parts table, and how it was
// filled in.
export interface ReportContent {
  values: ReportContentValueMap;
  parts: PartRow[];
  filledBy: "manual" | "agent" | "mixed";
}

// A persisted service report. `schemaSnapshot` + `templateRevision` pin the
// report to the template as it was AT FILL TIME, so editing a template later
// never retroactively changes a submitted report.
export interface ReportRecord {
  id: string;
  templateId: string;
  templateRevision: number;
  schemaSnapshot: TemplateSchema;
  jobId: string | null;
  technicianId: string | null;
  title: string;
  customerName: string;
  content: ReportContent;
  status: "draft" | "submitted" | "exported";
  filledBy: "manual" | "agent" | "mixed";
  submittedAt: string | null;
  exportedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// The response to a save-and-export action: the persisted report plus the URL
// the generated document can be fetched from.
export interface SaveAndExportResponse {
  report: ReportRecord;
  exportUrl: string;
}

// A page of reports plus the total matching the filter — the body of
// GET /api/reports. NOT a bare array: the server pages this endpoint and
// returns the count alongside, so a caller can page without a second request.
//
// It lives here rather than beside its client wrapper in api/reports.ts
// because this file is the wire contract and every other response shape is
// already in it. api/reports.ts re-exports it, so an existing
// `import type { ListReportsResult } from "./reports"` keeps working.
export interface ListReportsResult {
  reports: ReportRecord[];
  total: number;
  limit: number;
  offset: number;
}

// One card/row on the dashboard: a template and the counts of reports filed
// against it.
export interface DashboardTemplateRollup {
  templateId: string;
  name: string;
  isSeed: boolean;
  revision: number;
  reportCount: number;
  draftCount: number;
  submittedCount: number;
  exportedCount: number;
  lastReportAt: string | null;
}

// One column of the per-template report table. `type` is a presentation hint
// (alignment, width) only — see the note at the top of this file.
export interface ReportTableColumn {
  fieldId: string;
  label: string;
  type: FieldType;
  sectionLabel: string;
}

// One report as a table row. `cells` is keyed by fieldId and already flattened
// to display strings by the backend; a fieldId missing from `cells` means the
// report has no value for that field.
export interface ReportTableRow {
  reportId: string;
  createdAt: string;
  status: string;
  templateRevision: number;
  customerName: string;
  cells: Record<string, string>;
  // True when this report was filled against an OLDER template revision than
  // the template's current one, so some columns may not apply to it. The table
  // flags these rather than hiding them.
  staleRevision: boolean;
}

// The full per-template report table: its columns, a page of rows, and the
// paging window that produced them.
export interface ReportTableView {
  template: { id: string; name: string; revision: number };
  columns: ReportTableColumn[];
  rows: ReportTableRow[];
  total: number;
  limit: number;
  offset: number;
}
