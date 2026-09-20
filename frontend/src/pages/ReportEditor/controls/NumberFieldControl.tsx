// NumberFieldControl — editable control for a `number` field.
//
// Value is stored as a string (see reportContent.ts) so a partially-typed or
// empty entry round-trips without being coerced to 0/NaN. inputMode="decimal"
// brings up the numeric keypad on mobile (field-conditions goal).

import { colors, fontSize, radius, spacing } from "../../../styles/tokens";
import { FieldLabel } from "./TextFieldControl";

interface NumberFieldControlProps {
  id: string;
  label: string;
  required: boolean;
  value: string;
  onChange: (next: string) => void;
}

export function NumberFieldControl({
  id,
  label,
  required,
  value,
  onChange,
}: NumberFieldControlProps) {
  return (
    <label htmlFor={id} style={{ display: "block" }}>
      <FieldLabel label={label} required={required} />
      <input
        id={id}
        data-testid={`number-${id}`}
        type="number"
        inputMode="decimal"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        style={{
          display: "block",
          width: "100%",
          minHeight: 44,
          fontSize: fontSize.base,
          padding: `${spacing.sm}px ${spacing.md}px`,
          borderRadius: radius.md,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          color: colors.text,
        }}
      />
    </label>
  );
}
