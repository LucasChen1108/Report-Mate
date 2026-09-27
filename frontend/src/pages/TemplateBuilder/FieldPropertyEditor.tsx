// FieldPropertyEditor — edits a single field's label, required flag, and (for
// select/checklist) its option list (Req 4.1–4.7).
//
// SCOPE (task 10.4):
//   - Label (Req 4.1/4.2): a controlled text input. On commit (blur or Enter),
//     a non-empty trimmed value dispatches renameField{fieldId, label:trimmed};
//     an empty/whitespace-only value is REJECTED — no dispatch, the input
//     reverts to the current field.label, and a "Label is required" message is
//     shown.
//   - Required (Req 4.3): a checkbox dispatching setRequired{fieldId, required}.
//   - Options (Req 4.4–4.7): for select/checklist (via hasOptions) render
//     <OptionListEditor>; other types render no option editor.
//
// dnd note: this editor sits inside a sortable FieldCard. pointer-down and
// key-down are stopped from propagating on interactive controls so the dnd
// sensors don't hijack typing/taps and start a drag.

import { useEffect, useState } from "react";
import type { Field } from "../../api/types";
import { hasOptions } from "../../api/types";
import type { BuilderAction } from "./builderReducer";
import { OptionListEditor } from "./OptionListEditor";

interface FieldPropertyEditorProps {
  field: Field;
  dispatch: (action: BuilderAction) => void;
}

// Keep dnd sensors from hijacking pointer/keyboard interaction with controls.
function stopDnd(e: React.PointerEvent | React.KeyboardEvent): void {
  e.stopPropagation();
}

export function FieldPropertyEditor({
  field,
  dispatch,
}: FieldPropertyEditorProps) {
  // Local draft for the label so typing is smooth; committed on blur/Enter.
  const [draftLabel, setDraftLabel] = useState(field.label);
  // Shown when an empty/whitespace-only label commit is rejected (Req 4.2).
  const [labelError, setLabelError] = useState(false);

  // Re-sync the draft if the field label changes from elsewhere.
  useEffect(() => {
    setDraftLabel(field.label);
  }, [field.label]);

  const commitLabel = () => {
    const trimmed = draftLabel.trim();
    if (trimmed === "") {
      // Reject: retain the previous label, revert the input, show the message.
      setDraftLabel(field.label);
      setLabelError(true);
      return;
    }
    setLabelError(false);
    if (trimmed !== field.label) {
      dispatch({ kind: "renameField", fieldId: field.id, label: trimmed });
    }
  };

  return (
    <div
      data-testid={`field-property-editor-${field.id}`}
      style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          // On a narrow screen the Required / Allow multiple toggles wrap to the
          // next line instead of pushing the row off the right edge.
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <input
          type="text"
          value={draftLabel}
          aria-label="Field label"
          data-testid={`field-label-input-${field.id}`}
          aria-invalid={labelError}
          onChange={(e) => {
            setDraftLabel(e.target.value);
            if (labelError) setLabelError(false);
          }}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            stopDnd(e);
            if (e.key === "Enter") {
              e.preventDefault();
              commitLabel();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraftLabel(field.label);
              setLabelError(false);
            }
          }}
          onPointerDown={stopDnd}
          style={{
            // Grow to fill but allow shrinking below content width (minWidth:0)
            // with a floor so it stays usable; box-sizing keeps padding inside.
            flex: "1 1 140px",
            minWidth: 0,
            boxSizing: "border-box",
            minHeight: 44,
            fontSize: 16,
            padding: "8px 10px",
            border: labelError ? "1px solid #a00" : "1px solid #333",
            borderRadius: 8,
          }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 14,
            minHeight: 44,
            flexShrink: 0,
          }}
          onPointerDown={stopDnd}
        >
          <input
            type="checkbox"
            checked={field.required}
            data-testid={`field-required-${field.id}`}
            aria-label={`${field.label} required`}
            onKeyDown={stopDnd}
            onChange={(e) =>
              dispatch({
                kind: "setRequired",
                fieldId: field.id,
                required: e.target.checked,
              })
            }
            style={{ width: 20, height: 20 }}
          />
          Required
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 14,
            minHeight: 44,
            flexShrink: 0,
          }}
          onPointerDown={stopDnd}
        >
          <input
            type="checkbox"
            checked={field.allowMultiple ?? false}
            data-testid={`field-allow-multiple-${field.id}`}
            aria-label={`${field.label} allow multiple values`}
            onKeyDown={stopDnd}
            onChange={(e) =>
              dispatch({
                kind: "setAllowMultiple",
                fieldId: field.id,
                allowMultiple: e.target.checked,
              })
            }
            style={{ width: 20, height: 20 }}
          />
          Allow multiple
        </label>
      </div>

      {labelError && (
        <p
          role="alert"
          data-testid={`field-label-error-${field.id}`}
          style={{ margin: 0, color: "#a00", fontSize: 13 }}
        >
          Label is required
        </p>
      )}

      {hasOptions(field) && (
        <OptionListEditor field={field} dispatch={dispatch} />
      )}
    </div>
  );
}

export default FieldPropertyEditor;
