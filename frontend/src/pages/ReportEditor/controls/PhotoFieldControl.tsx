// PhotoFieldControl — editable control for a `photo` field.
//
// Handoff decision 1: a photo carries an OPTIONAL caption at fill time — not a
// separate field. So this control is an image upload plus a caption text box
// bundled together, writing a single PhotoValue.
//
// No backend yet: the chosen image is read as a data URL via FileReader and held
// in state, which also makes it directly embeddable in the later PDF export.
// A real upload swaps FileReader for an upload call returning a storage key.

import { useRef } from "react";
import { colors, fontSize, radius, spacing } from "../../../styles/tokens";
import type { PhotoValue } from "../reportContent";
import { FieldLabel } from "./TextFieldControl";

interface PhotoFieldControlProps {
  id: string;
  label: string;
  required: boolean;
  value: PhotoValue;
  onChange: (next: PhotoValue) => void;
}

export function PhotoFieldControl({
  id,
  label,
  required,
  value,
  onChange,
}: PhotoFieldControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        ...value,
        dataUrl: typeof reader.result === "string" ? reader.result : null,
        fileName: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    onChange({ ...value, dataUrl: null, fileName: undefined });
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div data-testid={`photo-${id}`}>
      <FieldLabel label={label} required={required} />

      {value.dataUrl ? (
        <figure style={{ margin: 0 }}>
          <img
            src={value.dataUrl}
            alt={value.caption || label}
            data-testid={`photo-${id}-image`}
            style={{
              display: "block",
              width: "100%",
              maxHeight: 320,
              objectFit: "contain",
              borderRadius: radius.md,
              border: `1px solid ${colors.borderSubtle}`,
              background: colors.surfaceMuted,
            }}
          />
          <figcaption
            style={{ marginTop: spacing.sm, fontSize: fontSize.sm, color: colors.textMuted }}
          >
            {value.caption || "No caption"}
          </figcaption>
        </figure>
      ) : (
        // Empty state: a labelled drop/upload placeholder so the A4 layout shows
        // a photo slot even before an image is attached.
        <div
          data-testid={`photo-${id}-placeholder`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 140,
            padding: spacing.lg,
            borderRadius: radius.md,
            border: `1px dashed ${colors.border}`,
            background: colors.surfaceMuted,
            color: colors.textMuted,
            fontSize: fontSize.sm,
            textAlign: "center",
          }}
        >
          No photo attached
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
        <input
          ref={inputRef}
          id={id}
          data-testid={`photo-${id}-input`}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => handleFile(e.target.files?.[0])}
          style={{ fontSize: fontSize.sm }}
        />
        {value.dataUrl && (
          <button
            type="button"
            data-testid={`photo-${id}-clear`}
            onClick={clearImage}
            style={{
              minHeight: 44,
              padding: `${spacing.xs}px ${spacing.md}px`,
              fontSize: fontSize.sm,
              borderRadius: radius.md,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.text,
              cursor: "pointer",
            }}
          >
            Remove photo
          </button>
        )}
      </div>

      {/* Optional caption offered alongside the upload (handoff decision 1). */}
      <label htmlFor={`${id}-caption`} style={{ display: "block", marginTop: spacing.sm }}>
        <span
          style={{
            display: "block",
            marginBottom: spacing.xs,
            fontSize: fontSize.xs,
            color: colors.textMuted,
          }}
        >
          Caption (optional)
        </span>
        <input
          id={`${id}-caption`}
          data-testid={`photo-${id}-caption`}
          type="text"
          value={value.caption}
          placeholder="Describe the photo…"
          onChange={(e) => onChange({ ...value, caption: e.target.value })}
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
    </div>
  );
}
