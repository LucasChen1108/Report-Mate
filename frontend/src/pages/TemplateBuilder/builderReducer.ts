// Pure schema-mutation reducer for the Template Builder.
//
// All edits to the working TemplateSchema flow through `builderReducer`, a pure
// function that never mutates its input and always returns a new schema
// (structural sharing is fine; no in-place mutation of arrays/objects from the
// input). Keeping mutations here — rather than in the dnd-kit handlers — makes
// the reorder/move/add invariants (design Correctness Properties 5–16) directly
// testable.
//
// The backend `Validate` (backend/internal/templates) is the authoritative
// source of truth for schema validity. This reducer keeps the working schema in
// a shape that stays valid where cheaply possible (e.g. new select/checklist
// fields get one default option, and the last option can't be removed), but it
// does not itself enforce label non-emptiness — empty-label rejection with user
// messaging is a UI concern handled by the editor components. The reducer stays
// pure and total: it never throws and never mutates input.

import type {
  Field,
  FieldType,
  OptionFieldType,
  Section,
  TemplateSchema,
} from "../../api/types";
import { hasOptions } from "../../api/types";

// The discriminated union of every schema mutation the builder can perform.
// Mirrors the "Schema mutation reducer (frontend)" section of design.md exactly.
export type BuilderAction =
  | { kind: "addSection"; label: string }
  | { kind: "renameSection"; sectionId: string; label: string }
  | { kind: "reorderSections"; fromIndex: number; toIndex: number }
  | { kind: "removeSection"; sectionId: string }
  | { kind: "addField"; sectionId: string; type: FieldType; atIndex: number }
  | { kind: "moveField"; fieldId: string; toSectionId: string; toIndex: number }
  | { kind: "reorderField"; sectionId: string; fromIndex: number; toIndex: number }
  | { kind: "removeField"; fieldId: string }
  | { kind: "renameField"; fieldId: string; label: string }
  | { kind: "setRequired"; fieldId: string; required: boolean }
  | { kind: "addOption"; fieldId: string; value: string }
  | { kind: "editOption"; fieldId: string; index: number; value: string }
  | { kind: "removeOption"; fieldId: string; index: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPTION_TYPES: readonly OptionFieldType[] = ["select", "checklist"];

function isOptionType(type: FieldType): type is OptionFieldType {
  return OPTION_TYPES.includes(type as OptionFieldType);
}

// Human-readable default label for a freshly added field (Req 2.5). Always
// non-empty. The dispatcher can edit it afterwards.
const DEFAULT_FIELD_LABELS: Record<FieldType, string> = {
  text: "Untitled text field",
  number: "Untitled number field",
  select: "Untitled select field",
  checklist: "Untitled checklist field",
  photo: "Untitled photo field",
  signature: "Untitled signature field",
};

function defaultLabelFor(type: FieldType): string {
  return DEFAULT_FIELD_LABELS[type];
}

// Collect every field id currently present anywhere in the template.
function collectFieldIds(schema: TemplateSchema): Set<string> {
  const ids = new Set<string>();
  for (const section of schema.sections) {
    for (const field of section.fields) {
      ids.add(field.id);
    }
  }
  return ids;
}

// Collision-checked, deterministic id generator (no crypto/uuid dependency, so
// the reducer is fully testable). Given the set of ids already used within the
// template plus a prefix, it returns the first `${prefix}${n}` not already
// taken. This guarantees uniqueness within the whole template (Req 2.3 /
// Property 7) without relying on randomness.
function nextUniqueId(existing: Set<string>, prefix: string): string {
  let n = 1;
  let candidate = `${prefix}${n}`;
  while (existing.has(candidate)) {
    n += 1;
    candidate = `${prefix}${n}`;
  }
  return candidate;
}

// Clamp an index into the inclusive range [0, max].
function clampIndex(index: number, max: number): number {
  if (Number.isNaN(index)) return 0;
  if (index < 0) return 0;
  if (index > max) return max;
  return Math.trunc(index);
}

// Insert `item` into a new copy of `list` at `index` (clamped to the end).
function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  const at = clampIndex(index, list.length);
  const next = list.slice();
  next.splice(at, 0, item);
  return next;
}

// Move the element at `fromIndex` to `toIndex` in a new copy of `list`.
// A no-op (returns an equivalent copy) when either index is out of bounds.
function moveWithin<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = list.slice();
  if (
    fromIndex < 0 ||
    fromIndex >= next.length ||
    toIndex < 0 ||
    toIndex >= next.length
  ) {
    return next;
  }
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

// Replace the section at `index` with `nextSection`, returning a new sections
// array. Every other section is shared by reference (structural sharing).
function replaceSection(
  sections: readonly Section[],
  index: number,
  nextSection: Section,
): Section[] {
  const next = sections.slice();
  next[index] = nextSection;
  return next;
}

// Locate the section (and its index) containing the given field id.
function findFieldLocation(
  schema: TemplateSchema,
  fieldId: string,
): { sectionIndex: number; fieldIndex: number } | null {
  for (let s = 0; s < schema.sections.length; s += 1) {
    const fields = schema.sections[s].fields;
    for (let f = 0; f < fields.length; f += 1) {
      if (fields[f].id === fieldId) {
        return { sectionIndex: s, fieldIndex: f };
      }
    }
  }
  return null;
}

// Apply a pure transform to whichever field carries `fieldId`, returning a new
// schema. Returns the original schema unchanged when the field doesn't exist.
function mapField(
  schema: TemplateSchema,
  fieldId: string,
  transform: (field: Field) => Field,
): TemplateSchema {
  const location = findFieldLocation(schema, fieldId);
  if (location === null) return schema;

  const { sectionIndex, fieldIndex } = location;
  const section = schema.sections[sectionIndex];
  const nextFields = section.fields.slice();
  nextFields[fieldIndex] = transform(section.fields[fieldIndex]);

  const nextSection: Section = { ...section, fields: nextFields };
  return {
    ...schema,
    sections: replaceSection(schema.sections, sectionIndex, nextSection),
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function builderReducer(
  state: TemplateSchema,
  action: BuilderAction,
): TemplateSchema {
  switch (action.kind) {
    // -- Sections ----------------------------------------------------------
    case "addSection": {
      // Append the new (empty) section as the LAST entry (Req 3.1).
      const existingSectionIds = new Set(state.sections.map((s) => s.id));
      const newSection: Section = {
        id: nextUniqueId(existingSectionIds, "sec_"),
        label: action.label,
        fields: [],
      };
      return { ...state, sections: [...state.sections, newSection] };
    }

    case "renameSection": {
      // Set the label (Req 4.8). Empty-label rejection is a UI concern; the
      // reducer stays total and simply applies the caller-provided value.
      const index = state.sections.findIndex((s) => s.id === action.sectionId);
      if (index === -1) return state;
      const nextSection: Section = {
        ...state.sections[index],
        label: action.label,
      };
      return {
        ...state,
        sections: replaceSection(state.sections, index, nextSection),
      };
    }

    case "reorderSections": {
      // Permutation only — no add/drop (Req 3.4 / Property 10).
      return {
        ...state,
        sections: moveWithin(state.sections, action.fromIndex, action.toIndex),
      };
    }

    case "removeSection": {
      // Delete the section and ALL its fields (Req 3.9 / Property 14).
      const nextSections = state.sections.filter(
        (s) => s.id !== action.sectionId,
      );
      if (nextSections.length === state.sections.length) return state;
      return { ...state, sections: nextSections };
    }

    // -- Fields ------------------------------------------------------------
    case "addField": {
      const index = state.sections.findIndex((s) => s.id === action.sectionId);
      if (index === -1) return state;

      // Template-unique, stable, deterministically generated id (Req 2.3 /
      // Property 7).
      const newField: Field = makeField(
        action.type,
        nextUniqueId(collectFieldIds(state), "fld_"),
      );

      const section = state.sections[index];
      const nextFields = insertAt(section.fields, action.atIndex, newField);
      const nextSection: Section = { ...section, fields: nextFields };
      return {
        ...state,
        sections: replaceSection(state.sections, index, nextSection),
      };
    }

    case "reorderField": {
      // Local permutation within one section (Req 3.5 / Property 11). Every
      // other section is left untouched (shared by reference).
      const index = state.sections.findIndex((s) => s.id === action.sectionId);
      if (index === -1) return state;
      const section = state.sections[index];
      const nextFields = moveWithin(
        section.fields,
        action.fromIndex,
        action.toIndex,
      );
      const nextSection: Section = { ...section, fields: nextFields };
      return {
        ...state,
        sections: replaceSection(state.sections, index, nextSection),
      };
    }

    case "moveField": {
      // Remove from source, insert into target at toIndex, preserving the field
      // object (same id). Req 3.6 / Property 12.
      const location = findFieldLocation(state, action.fieldId);
      if (location === null) return state;
      const targetIndex = state.sections.findIndex(
        (s) => s.id === action.toSectionId,
      );
      if (targetIndex === -1) return state;

      const { sectionIndex, fieldIndex } = location;
      const field = state.sections[sectionIndex].fields[fieldIndex];

      // Same-section move collapses to a reorder so indices stay consistent.
      if (sectionIndex === targetIndex) {
        const section = state.sections[sectionIndex];
        const withoutField = section.fields.slice();
        withoutField.splice(fieldIndex, 1);
        const nextFields = insertAt(withoutField, action.toIndex, field);
        const nextSection: Section = { ...section, fields: nextFields };
        return {
          ...state,
          sections: replaceSection(state.sections, sectionIndex, nextSection),
        };
      }

      // Cross-section move: rebuild both affected sections.
      const nextSections = state.sections.slice();

      const sourceSection = nextSections[sectionIndex];
      const sourceFields = sourceSection.fields.slice();
      sourceFields.splice(fieldIndex, 1);
      nextSections[sectionIndex] = { ...sourceSection, fields: sourceFields };

      const targetSection = nextSections[targetIndex];
      const targetFields = insertAt(targetSection.fields, action.toIndex, field);
      nextSections[targetIndex] = { ...targetSection, fields: targetFields };

      return { ...state, sections: nextSections };
    }

    case "removeField": {
      // Delete exactly that field (Req 3.7 / Property 13).
      const location = findFieldLocation(state, action.fieldId);
      if (location === null) return state;
      const { sectionIndex, fieldIndex } = location;
      const section = state.sections[sectionIndex];
      const nextFields = section.fields.slice();
      nextFields.splice(fieldIndex, 1);
      const nextSection: Section = { ...section, fields: nextFields };
      return {
        ...state,
        sections: replaceSection(state.sections, sectionIndex, nextSection),
      };
    }

    case "renameField": {
      // Set the label (Req 4.1). Empty-label rejection is a UI concern.
      return mapField(state, action.fieldId, (field) => ({
        ...field,
        label: action.label,
      }));
    }

    case "setRequired": {
      // Set the boolean (Req 4.3).
      return mapField(state, action.fieldId, (field) => ({
        ...field,
        required: action.required,
      }));
    }

    // -- Options (select / checklist only) --------------------------------
    case "addOption": {
      // Append to the option list (Req 4.4). Only meaningful for option types.
      return mapField(state, action.fieldId, (field) => {
        if (!hasOptions(field)) return field;
        return { ...field, options: [...field.options, action.value] };
      });
    }

    case "editOption": {
      // Replace options[index] (Req 4.5).
      return mapField(state, action.fieldId, (field) => {
        if (!hasOptions(field)) return field;
        if (action.index < 0 || action.index >= field.options.length) {
          return field;
        }
        const options = field.options.slice();
        options[action.index] = action.value;
        return { ...field, options };
      });
    }

    case "removeOption": {
      // Remove options[index] only when more than one option remains; the last
      // option is kept so the schema stays valid (Req 4.6 / 4.7).
      return mapField(state, action.fieldId, (field) => {
        if (!hasOptions(field)) return field;
        if (field.options.length <= 1) return field;
        if (action.index < 0 || action.index >= field.options.length) {
          return field;
        }
        const options = field.options.slice();
        options.splice(action.index, 1);
        return { ...field, options };
      });
    }

    default: {
      // Exhaustiveness guard: if a new action kind is added without a case,
      // this line fails to type-check.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

// Build a brand-new field of the given type with safe defaults (Req 2.4, 2.5).
// select/checklist start with a single default option so the schema stays
// valid (backend Validate requires 1..50 options); other types carry no
// options list at all.
function makeField(type: FieldType, id: string): Field {
  if (isOptionType(type)) {
    return {
      id,
      type,
      label: defaultLabelFor(type),
      required: false,
      options: ["Option 1"],
    };
  }
  return {
    id,
    type,
    label: defaultLabelFor(type),
    required: false,
  };
}
