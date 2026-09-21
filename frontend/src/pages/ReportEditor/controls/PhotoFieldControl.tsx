// PhotoFieldControl — editable control for a `photo` field.
//
// Handoff decision 1: a photo carries an OPTIONAL caption at fill time — not a
// separate field. So this control is an image upload plus a caption text box
// bundled together, writing a single PhotoValue.
//
// STORAGE: the chosen image becomes an inline base64 data URL held in the
// report's content JSON. That keeps the export self-contained (the image embeds
// straight into the printed document, no blob store to stand up) and is the
// accepted tradeoff for this stage.
//
// It is only safe because the image is DOWNSCALED FIRST — see imageDownscale.ts
// for the full reasoning. A raw phone photo is 2–5 MB, base64 adds a third
// again, and the server caps a report body at 32 MB, so three untouched photos
// fail the save on the most thoroughly documented reports. Every file picked
// here goes through the canvas pipeline before it is written to the value.
//
// The write itself is async now (decode + re-encode), so the control carries a
// "processing" state and an error line; the underlying PhotoValue shape
// ({dataUrl, caption, fileName}) is unchanged.

import { useRef, useState } from "react";
import { colors, fontSize, radius, spacing } from "../../../styles/tokens";
import type { PhotoValue } from "../reportContent";
import { downscaleImageToDataUrl } from "../imageDownscale";
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
  // True while the picked file is being decoded and re-encoded. Large photos
  // take a moment on a phone, and a control that looks inert is a control the
  // technician taps again.
  const [processing, setProcessing] = useState(false);
  // Set when an image could not be processed, shown beneath the upload row.
  // A photo that silently fails to attach is the failure mode to avoid.
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      const dataUrl = await downscaleImageToDataUrl(file);
      onChange({ ...value, dataUrl, fileName: file.name });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not attach that image. Try another photo.",
      );
      // Clear the input so picking the SAME file again re-fires onChange.
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setProcessing(false);
    }
  };

  const clearImage = () => {
    onChange({ ...value, dataUrl: null, fileName: undefined });
    setError(null);
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
          disabled={processing}
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
          }}
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

      {processing && (
        <p
          role="status"
          data-testid={`photo-${id}-processing`}
          style={{
            margin: `${spacing.xs}px 0 0`,
            fontSize: fontSize.sm,
            color: colors.textMuted,
          }}
        >
          Processing photo…
        </p>
      )}

      {error && (
        <p
          role="alert"
          data-testid={`photo-${id}-error`}
          style={{
            margin: `${spacing.xs}px 0 0`,
            fontSize: fontSize.sm,
            color: colors.dangerText,
          }}
        >
          {error}
        </p>
      )}

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
