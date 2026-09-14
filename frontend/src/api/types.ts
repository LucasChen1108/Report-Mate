// Shared Template Schema contract type.
//
// This is the single definition the Template Builder and Report Renderer both
// reference (Req 1.10). The backend Go struct in
// backend/internal/templates/schema.go mirrors this shape; the backend
// `Validate` function is the authoritative source of truth for the rules.

// The Field_Type union — all six supported types.
export type FieldType =
  | "text"
  | "number"
  | "select"
  | "checklist"
  | "photo"
  | "signature";

// Types that carry an options list.
export type OptionFieldType = "select" | "checklist";

// A field without options: text, number, photo, signature.
export interface BasicField {
  id: string;
  type: Exclude<FieldType, OptionFieldType>;
  label: string;
  required: boolean;
  // When true, the field may hold more than one value at fill time (e.g.
  // multiple photos). Authored in the builder; honored by the Report Renderer.
  // Optional; absent is treated as false.
  allowMultiple?: boolean;
}

// A field with an options list: select, checklist.
export interface OptionField {
  id: string;
  type: OptionFieldType;
  label: string;
  required: boolean;
  allowMultiple?: boolean; // see BasicField.allowMultiple
  options: string[]; // 1..50, unique within the field
}

export type Field = BasicField | OptionField;

export interface Section {
  id: string;
  label: string;
  fields: Field[]; // 0..100
}

export interface TemplateSchema {
  version: 1;
  sections: Section[]; // 1..50
}

// Narrowing helper the builder and renderer share.
export function hasOptions(field: Field): field is OptionField {
  return field.type === "select" || field.type === "checklist";
}
