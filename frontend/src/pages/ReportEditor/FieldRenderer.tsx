// FieldRenderer — maps one schema Field to its editable control.
//
// This is the single dispatch point from the shared TemplateSchema contract to
// the fill controls. It reads the field's current value out of the report
// content map (keyed by field id) and hands each control a typed value + an
// onChange that writes back a single field's value.
//
// The switch is exhaustive over the six field types; hasOptions() narrows the
// select/checklist branches to OptionField so `field.options` is available.

import { hasOptions } from "../../api/types";
import type { Field } from "../../api/types";
import { ChecklistFieldControl } from "./controls/ChecklistFieldControl";
import { NumberFieldControl } from "./controls/NumberFieldControl";
import { PhotoFieldControl } from "./controls/PhotoFieldControl";
import { SelectFieldControl } from "./controls/SelectFieldControl";
import { SignatureFieldControl } from "./controls/SignatureFieldControl";
import { TextFieldControl } from "./controls/TextFieldControl";
import type {
  ChecklistValue,
  FieldValue,
  PhotoValue,
  SignatureValue,
} from "./reportContent";

interface FieldRendererProps {
  field: Field;
  /** Current value for this field (from ReportContent.values[field.id]). */
  value: FieldValue;
  /** Write back the new value for this field. */
  onChange: (fieldId: string, next: FieldValue) => void;
}

export function FieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const set = (next: FieldValue) => onChange(field.id, next);

  switch (field.type) {
    case "text":
      return (
        <TextFieldControl
          id={field.id}
          label={field.label}
          required={field.required}
          value={(value as string) ?? ""}
          onChange={set}
        />
      );
    case "number":
      return (
        <NumberFieldControl
          id={field.id}
          label={field.label}
          required={field.required}
          value={(value as string) ?? ""}
          onChange={set}
        />
      );
    case "select":
      // hasOptions narrows to OptionField so options is present.
      return hasOptions(field) ? (
        <SelectFieldControl
          id={field.id}
          label={field.label}
          required={field.required}
          options={field.options}
          value={(value as string) ?? ""}
          onChange={set}
        />
      ) : null;
    case "checklist":
      return hasOptions(field) ? (
        <ChecklistFieldControl
          id={field.id}
          label={field.label}
          required={field.required}
          options={field.options}
          value={(value as ChecklistValue) ?? []}
          onChange={set}
        />
      ) : null;
    case "photo":
      return (
        <PhotoFieldControl
          id={field.id}
          label={field.label}
          required={field.required}
          value={(value as PhotoValue) ?? { dataUrl: null, caption: "" }}
          onChange={set}
        />
      );
    case "signature":
      return (
        <SignatureFieldControl
          id={field.id}
          label={field.label}
          required={field.required}
          value={(value as SignatureValue) ?? null}
          onChange={set}
        />
      );
    default: {
      // Exhaustiveness guard — a new field type must be handled above.
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}
