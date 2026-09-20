// TextFieldControl — editable control for a `text` field.
//
// Multi-line textarea: field notes in real service reports run long (arrival
// notes, work performed), so a growing textarea beats a single-line input. Wired
// to a string value; emits the raw string on every change.

import { colors, fontSize, radius, spacing } from "../../../styles/tokens";

interface TextFieldControlProps {
  id: string;
  label: string;
  required: boolean;
  value: string;
  onChange: (next: string) => void;
}

export function TextFieldControl({
  id,
  label,
  required,
  value,
  onChange,
}: TextFieldControlProps) {
  return (
    <label htmlFor={id} style={{ display: "block" }}>
      <FieldLabel label={label} required={required} />
      <textarea
        id={id}
        data-testid={`text-${id}`}
        value={value}
        required={required}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        style={{
          display: "block",
          width: "100%",
          minHeight: 88,
          resize: "vertical",
          fontSize: fontSize.base,
          lineHeight: 1.5,
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

// Shared label row used by every control (label + a "Required" hint). Kept here
// and re-exported so the controls all render labels identically.
export function FieldLabel({
  label,
  required,
}: {
  label: string;
  required: boolean;
}) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: spacing.sm,
        marginBottom: spacing.xs,
        fontSize: fontSize.sm,
        fontWeight: 600,
        color: colors.text,
      }}
    >
      {label}
      {required && (
        <span
          aria-hidden="true"
          style={{ color: colors.dangerText, fontWeight: 700 }}
          title="Required"
        >
          *
        </span>
      )}
      {required && (
        <span
          style={{
            fontSize: fontSize.xs,
            fontWeight: 400,
            color: colors.textMuted,
          }}
        >
          (required)
        </span>
      )}
    </span>
  );
}
