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
//
// -----------------------------------------------------------------------------
// WIRE SHAPE vs UI SHAPE — why there are two, and only one conversion
//
// api/reportTypes.ts types a stored value as `unknown`: on the wire a value's
// shape depends on its field's type, and the wire contract has no field in hand
// to discriminate on. This module types the same value as the precise
// `FieldValue` union, because the UI ALWAYS has the field beside the value (it
// renders one control per schema field) and the controls need exact types.
//
// Both are correct for their side. Loosening this module to `unknown` to match
// the wire would push a cast into every control; tightening the wire type would
// claim a guarantee the server does not make (an old report, a hand-edited row,
// or an agent-written value can be any JSON at all).
//
// So the narrowing happens ONCE, here, at the API boundary:
//
//   contentFromWire(schema, wire)  wire -> UI   (defensive: anything unexpected
//                                                becomes that type's empty value)
//   contentToWire(content)         UI   -> wire (widening; cannot fail)
//
// Every value the controls see has been through contentFromWire, so they can
// trust their types. Nothing else in the renderer casts a wire value.
// -----------------------------------------------------------------------------

import type { Field, TemplateSchema } from "../../api/types";
import type {
  PartRow,
  ReportContent as WireReportContent,
} from "../../api/reportTypes";

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
//
// PartRow is NOT declared here. It is part of the frozen wire contract
// (api/reportTypes.ts) and used to be restated in this file with identical
// fields — two copies of a wire type that would drift the first time either
// side changed. The contract version is re-exported so every existing
// `import type { PartRow } from "./reportContent"` keeps working.
//
// Its fields, for readers who land here first: `id` (stable key for React /
// row edits), `part`, `partNumber`, and `quantity` — a STRING, for the same
// reason NumberValue is (an empty or mid-typed quantity must round-trip).
export type { PartRow } from "../../api/reportTypes";

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

// --- The API boundary: wire <-> UI ------------------------------------------
// The ONE place a wire value is narrowed to a FieldValue. See the note at the
// top of this file for why the two shapes stay separate.

/** Narrow one wire value to the FieldValue shape its field's type calls for.
 *
 * Defensive by design: a value of an unexpected shape becomes that type's EMPTY
 * value rather than throwing. A stored report is data we did not write — it may
 * predate a field's type changing, or come from the agent path — and a single
 * odd value must not blank the whole form with an error screen. */
export function fieldValueFromWire(field: Field, raw: unknown): FieldValue {
  switch (field.type) {
    case "text":
    case "select":
      return typeof raw === "string" ? raw : "";
    case "number":
      // Numbers are stored as strings (see NumberValue), but a JSON number is
      // an entirely plausible thing to receive — accept and stringify it.
      if (typeof raw === "string") return raw;
      return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : "";
    case "checklist":
      return Array.isArray(raw)
        ? (raw.filter((o): o is string => typeof o === "string") as ChecklistValue)
        : ([] as ChecklistValue);
    case "photo": {
      if (typeof raw !== "object" || raw === null) {
        return { dataUrl: null, caption: "" } as PhotoValue;
      }
      const photo = raw as Record<string, unknown>;
      return {
        dataUrl: typeof photo.dataUrl === "string" ? photo.dataUrl : null,
        caption: typeof photo.caption === "string" ? photo.caption : "",
        fileName:
          typeof photo.fileName === "string" ? photo.fileName : undefined,
      } as PhotoValue;
    }
    case "signature":
      // "" is stored by some paths for "unsigned"; normalize it to null so the
      // pad's empty state and the required-check agree on one representation.
      return typeof raw === "string" && raw.length > 0
        ? (raw as SignatureValue)
        : (null as SignatureValue);
    default: {
      // Exhaustiveness guard — a new field type must be handled above.
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

/** Narrow one wire Parts Used row. Rows arrive from the server with ids, but a
 * row missing one still has to render, so a fresh id is minted rather than
 * letting React key on undefined. */
function partRowFromWire(raw: unknown): PartRow {
  const row = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id: typeof row.id === "string" && row.id ? row.id : newPartRowId(),
    part: str(row.part),
    partNumber: str(row.partNumber),
    quantity:
      typeof row.quantity === "number" ? String(row.quantity) : str(row.quantity),
  };
}

/** Convert a stored (wire) ReportContent into the editor's content model,
 * driven by the SCHEMA rather than by the stored keys:
 *
 *   - every field in the schema gets an entry, correctly shaped, even if the
 *     stored content predates that field;
 *   - a stored value whose field no longer exists is DROPPED, so a removed
 *     field cannot linger invisibly in the payload we save back.
 *
 * Which is exactly the behaviour the schema snapshot is for: the report renders
 * against the schema it was filled against, and nothing else. */
export function contentFromWire(
  schema: TemplateSchema,
  wire: Partial<WireReportContent> | null | undefined,
): ReportContent {
  const values: Record<string, FieldValue> = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      values[field.id] = fieldValueFromWire(field, wire?.values?.[field.id]);
    }
  }
  return {
    values,
    parts: Array.isArray(wire?.parts) ? wire.parts.map(partRowFromWire) : [],
    filledBy:
      wire?.filledBy === "agent" || wire?.filledBy === "mixed"
        ? wire.filledBy
        : "manual",
  };
}

/** Widen the editor's content back to the wire shape for a save. Structurally a
 * no-op (every FieldValue is a legal `unknown`), written out explicitly so the
 * conversion is symmetrical and there is one named function to change if the
 * wire shape ever diverges. */
export function contentToWire(content: ReportContent): WireReportContent {
  return {
    values: { ...content.values },
    parts: content.parts.map((row) => ({ ...row })),
    filledBy: content.filledBy,
  };
}

// --- Required-field checking ------------------------------------------------
// A UX-level check only. The BACKEND is the source of truth (it re-checks on
// save-and-export and answers 422 with the offending elementId); this exists so
// the common case is caught without a round trip, and so the technician is
// taken straight to the blank field instead of reading an error at the bottom
// of a three-page form.

/** Is this value "not filled in", for its field's type? */
export function isFieldValueEmpty(
  field: Field,
  value: FieldValue | undefined,
): boolean {
  if (value === undefined || value === null) return true;
  switch (field.type) {
    case "text":
    case "number":
    case "select":
      // Whitespace-only is empty: a space typed into a required box is not an
      // answer.
      return typeof value !== "string" || value.trim().length === 0;
    case "checklist":
      return !Array.isArray(value) || value.length === 0;
    case "photo":
      // A caption alone is not a photo.
      return (
        typeof value !== "object" ||
        (value as PhotoValue).dataUrl === null ||
        (value as PhotoValue).dataUrl === undefined
      );
    case "signature":
      return typeof value !== "string" || value.length === 0;
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

/** One required field left blank, with enough context to point at it. */
export interface MissingRequiredField {
  fieldId: string;
  label: string;
  sectionId: string;
  sectionLabel: string;
}

/** Every required field left blank, in DOCUMENT ORDER — so the first element is
 * the one nearest the top of the page, which is the one to scroll to. */
export function findMissingRequiredFields(
  schema: TemplateSchema,
  content: ReportContent,
): MissingRequiredField[] {
  const missing: MissingRequiredField[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (!field.required) continue;
      if (isFieldValueEmpty(field, content.values[field.id])) {
        missing.push({
          fieldId: field.id,
          label: field.label,
          sectionId: section.id,
          sectionLabel: section.label,
        });
      }
    }
  }
  return missing;
}
