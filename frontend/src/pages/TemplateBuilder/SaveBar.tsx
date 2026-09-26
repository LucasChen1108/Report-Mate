// SaveBar — the template name input + save action + status/error surface for
// the Template Builder (Req 5.1, 5.3, 5.5, 5.6).
//
// SCOPE (task 11.1): this component is presentational. It renders:
//   - the template NAME input (moved out of the page header),
//   - a SAVE button,
//   - a status area that surfaces either a brief "saved" indicator or a save
//     error message (including the offending elementId for a 422, Req 5.6).
//
// It does NOT decide create-vs-update or call the API client itself. The parent
// (TemplateBuilderPage) owns the working schema, the templateId (create vs
// update), and the saving/error state, and passes them down. This keeps the
// create-vs-update decision co-located with the state it depends on, and keeps
// all backend calls flowing through api/templates.ts (Req 5.7).
//
// Styling is minimal with large tap targets (>=44px); full styling is task 12.1.

import type { CSSProperties } from "react";

// The status the parent asks SaveBar to surface. `idle` shows nothing, `saved`
// shows a brief confirmation, `error` shows the message (and elementId if any).
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "error"; message: string; elementId?: string | null };

interface SaveBarProps {
  // Current template name (owned by the parent).
  name: string;
  // Called as the user edits the name field.
  onNameChange: (next: string) => void;
  // Called when the user activates Save. The parent runs the create/update
  // orchestration; SaveBar does not call the API directly.
  onSave: () => void;
  // True while a save request is in flight — disables the input and button.
  saving: boolean;
  // What to surface in the status area (saved indicator or error).
  status: SaveStatus;
  // Optional: called when the user activates "Preview report". The parent opens
  // the report editor on the current working draft. Omitted -> no preview button.
  onPreview?: () => void;
}

const controlStyle: CSSProperties = {
  minHeight: 44,
  fontSize: 16,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #333",
};

export function SaveBar({
  name,
  onNameChange,
  onSave,
  saving,
  status,
  onPreview,
}: SaveBarProps) {
  const hasError = status.kind === "error";

  return (
    <section
      data-testid="save-bar"
      aria-label="Save template"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "flex-start",
        marginBottom: 16,
      }}
    >
      <label style={{ flex: 1, minWidth: 200 }}>
        <span style={{ display: "block", marginBottom: 4 }}>Template name</span>
        <input
          type="text"
          value={name}
          disabled={saving}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Untitled template"
          data-testid="template-name-input"
          aria-invalid={hasError}
          aria-describedby={hasError ? "save-bar-status" : undefined}
          style={{ ...controlStyle, width: "100%" }}
        />
      </label>

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        data-testid="save-button"
        style={{
          ...controlStyle,
          minWidth: 44,
          alignSelf: "flex-end",
          cursor: saving ? "default" : "pointer",
          background: saving ? "#6b7683" : "#1a5fb4",
          color: "#fff",
          border: "1px solid #14477f",
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>

      {/* Preview report — opens the report editor on the current working draft,
          so the builder can see how a report from this template renders right
          next to Save (the in-context, intuitive spot). Rendered only when the
          parent wires onPreview. */}
      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          disabled={saving}
          data-testid="preview-report-button"
          style={{
            ...controlStyle,
            minWidth: 44,
            alignSelf: "flex-end",
            cursor: saving ? "default" : "pointer",
            background: "#fff",
            color: "#1a5fb4",
            border: "1px solid #1a5fb4",
          }}
        >
          Preview report
        </button>
      )}

      {status.kind === "saved" && (
        <p
          id="save-bar-status"
          role="status"
          data-testid="save-status-saved"
          style={{ flexBasis: "100%", margin: 0, color: "#1a7f37" }}
        >
          Saved
        </p>
      )}

      {status.kind === "error" && (
        <p
          id="save-bar-status"
          role="alert"
          data-testid="save-status-error"
          style={{ flexBasis: "100%", margin: 0, color: "#c0392b" }}
        >
          {status.message}
          {status.elementId ? (
            <>
              {" "}
              <span data-testid="save-error-element-id">
                (element: {status.elementId})
              </span>
            </>
          ) : null}
        </p>
      )}
    </section>
  );
}

export default SaveBar;
