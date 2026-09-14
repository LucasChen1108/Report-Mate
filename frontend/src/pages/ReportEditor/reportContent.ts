// reportContent.ts — the fill-time content model for the Report Renderer.
//
// The Template Builder owns the STRUCTURE (a TemplateSchema of sections/fields,
// see src/api/types.ts). This module owns the DATA a technician fills into that
// structure: a value per field, keyed by field id, plus the two render-time
// concerns the handoff (docs/report-renderer-handoff.md) kept OUT of the schema:
//
//   1. Photo captions   — a photo value carries an optional caption alongside
//                          the image, not a second field.
//   2. Parts Used        — a separate structural table (part / part number /
//                          quantity), NOT a template field type.
//
// Report content is always keyed to the active template's field ids so the
// manual fill path and (later) the agent-assisted path share one structure —
// exactly what backend/internal/reports/doc.go describes.

import type { Field, TemplateSchema } from "../../api/types";

// --- Per-field value shapes -------------------------------------------------
// Each of the six field types stores a value shaped for its control. The union
// is discriminated by the owning field's `type`, but values are stored in a map
// keyed by field id (see ReportContent below), so a value is always looked up
// with its field in hand — no discriminant is stored on the value itself.

/** `text` — free text (single or multi-line). */
export type TextValue = string;

/** `number` — kept as a string so a partially-typed / empty entry round-trips
 * without being coerced to 0 or NaN. Parsed to a number only at use/export. */
export type NumberValue = string;

/** `select` — the single chosen option, or "" when nothing is chosen. */
export type SelectValue = string;

/** `checklist` — the set of chosen options (subset of the field's options). */
export type ChecklistValue = string[];

/** `photo` — an uploaded image (as a data URL for the no-backend stage) plus an
 * OPTIONAL caption offered at fill time (handoff decision 1). `null` image =
 * nothing uploaded yet. */
export interface PhotoValue {
  /** Data URL of the uploaded image, or null when none is uploaded. */
  dataUrl: string | null;
  /** Optional caption shown beneath the photo. */
  caption: string;
  /** Original filename, for display/accessibility. */
  fileName?: string;
}

/** `signature` — the captured signature as a PNG data URL, or null when unsigned. */
export type SignatureValue = string | null;

/** The value stored for any single field. Which member is valid depends on the
 * owning field's `type`; helpers below build/read the right shape per field. */
export type FieldValue =
  | TextValue
  | NumberValue
  | SelectValue
  | ChecklistValue
  | PhotoValue
  | SignatureValue;

// --- Parts Used (handoff decision 2) ----------------------------------------
// A separate structural section, not a template field. One row per part used.

export interface PartRow {
  /** Stable id for React keys / row edits. */
  id: string;
  part: string;
  partNumber: string;
  /** Quantity kept as a string for the same reason as NumberValue. */
  quantity: string;
}

// --- The full report content ------------------------------------------------

/** How a report was filled — mirrors service_reports.filled_by in the data
 * model. Manual is the only path at this stage; the agent path fills the same
 * structure later. */
export type FilledBy = "manual" | "agent" | "mixed";

export interface ReportContent {
  /** Values keyed by field id. Every field in the active schema has an entry. */
  values: Record<string, FieldValue>;
  /** The Parts Used table (separate from the template schema). */
  parts: PartRow[];
  filledBy: FilledBy;
}

// --- Empty-content construction ---------------------------------------------

/** The empty/default value for a field, shaped for its type. */
export function emptyValueForField(field: Field): FieldValue {
  switch (field.type) {
    case "text":
      return "";
    case "number":
      return "";
    case "select":
      return "";
    case "checklist":
      return [] as ChecklistValue;
    case "photo":
      return { dataUrl: null, caption: "" } as PhotoValue;
    case "signature":
      return null as SignatureValue;
    default: {
      // Exhaustiveness guard — a new field type must be handled above.
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

/** Build a fully-empty ReportContent for a schema: one entry per field id, an
 * empty Parts Used table, and filledBy "manual". This is the starting point for
 * a brand-new manual fill. */
export function emptyContentForSchema(schema: TemplateSchema): ReportContent {
  const values: Record<string, FieldValue> = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      values[field.id] = emptyValueForField(field);
    }
  }
  return { values, parts: [], filledBy: "manual" };
}

/** A fresh, unique-ish id for a new Parts Used row. crypto.randomUUID is
 * available in every browser Vite targets; a timestamp+random fallback keeps
 * tests/node happy if it is ever absent. */
export function newPartRowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `part_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** An empty Parts Used row. */
export function emptyPartRow(): PartRow {
  return { id: newPartRowId(), part: "", partNumber: "", quantity: "" };
}
