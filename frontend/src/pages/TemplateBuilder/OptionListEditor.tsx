// OptionListEditor — edits the option list of a select/checklist field
// (Req 4.4–4.7). Rendered only for OptionField by FieldPropertyEditor.
//
// SCOPE (task 10.4):
//   - Each option is a controlled text input; committing (blur or Enter)
//     dispatches editOption{fieldId, index, value} (Req 4.5).
//   - "Add option" dispatches addOption{fieldId, value} with a sensible default
//     value (Req 4.4).
//   - Each option has a remove control dispatching removeOption{fieldId, index}
//     (Req 4.6). When the field has exactly ONE option, removal is blocked: the
//     remove control is disabled and a "At least one option is required" message
//     is shown (Req 4.7). The reducer also refuses to drop the last option, but
//     the UI communicates the block per Req 4.7.
//
// dnd note: this editor lives inside a sortable FieldCard. To keep typing and
// taps from starting a drag, pointer-down and key-down are stopped from
// propagating on the interactive controls.

import { useEffect, useState } from "react";
import type { OptionField } from "../../api/types";
import type { BuilderAction } from "./builderReducer";

interface OptionListEditorProps {
  field: OptionField;
  dispatch: (action: BuilderAction) => void;
}

const tapTarget: React.CSSProperties = {
  minWidth: 44,
  minHeight: 44,
};

// Keep dnd sensors from hijacking pointer/keyboard interaction with controls.
function stopDnd(
  e: React.PointerEvent | React.KeyboardEvent,
): void {
  e.stopPropagation();
}

// One editable option row. Holds a local draft so typing is smooth; commits on
// blur or Enter, and reverts to the committed value on Escape.
function OptionRow({
  field,
  index,
  dispatch,
  canRemove,
}: {
  field: OptionField;
  index: number;
  dispatch: (action: BuilderAction) => void;
  canRemove: boolean;
}) {
  const committed = field.options[index];
  const [draft, setDraft] = useState(committed);

  // Keep the local draft in sync when the underlying option changes externally
  // (e.g. reorder/add elsewhere).
  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  const commit = () => {
    if (draft !== committed) {
      dispatch({ kind: "editOption", fieldId: field.id, index, value: draft });
    }
  };

  return (
    <div
      data-testid={`option-row-${field.id}-${index}`}
      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
    >
      <input
        type="text"
        value={draft}
        aria-label={`Option ${index + 1}`}
        data-testid={`option-input-${field.id}-${index}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          stopDnd(e);
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(committed);
          }
        }}
        onPointerDown={stopDnd}
        style={{
          flex: 1,
          minHeight: 44,
          fontSize: 16,
          padding: "8px 10px",
          border: "1px solid #333",
          borderRadius: 8,
        }}
      />
      <button
        type="button"
        aria-label={`Remove option ${index + 1}`}
        data-testid={`option-remove-${field.id}-${index}`}
        disabled={!canRemove}
        onPointerDown={stopDnd}
        onClick={() =>
          dispatch({ kind: "removeOption", fieldId: field.id, index })
        }
        style={{
          ...tapTarget,
          border: "1px solid #a00",
          borderRadius: 8,
          background: canRemove ? "#fff" : "#eee",
          color: canRemove ? "#a00" : "#999",
          cursor: canRemove ? "pointer" : "not-allowed",
        }}
      >
        ✕
      </button>
    </div>
  );
}

export function OptionListEditor({ field, dispatch }: OptionListEditorProps) {
  // With a single option, removal is blocked (Req 4.7).
  const canRemove = field.options.length > 1;

  const handleAdd = () => {
    dispatch({ kind: "addOption", fieldId: field.id, value: "New option" });
  };

  return (
    <div
      data-testid={`option-list-editor-${field.id}`}
      style={{ marginTop: 8 }}
    >
      <span style={{ fontSize: 13, color: "#555" }}>Options</span>
      <div style={{ marginTop: 6 }}>
        {field.options.map((_, index) => (
          <OptionRow
            key={index}
            field={field}
            index={index}
            dispatch={dispatch}
            canRemove={canRemove}
          />
        ))}
      </div>

      {!canRemove && (
        <p
          role="status"
          data-testid={`option-min-message-${field.id}`}
          style={{ margin: "0 0 8px", color: "#a00", fontSize: 13 }}
        >
          At least one option is required
        </p>
      )}

      <button
        type="button"
        data-testid={`option-add-${field.id}`}
        onPointerDown={stopDnd}
        onClick={handleAdd}
        style={{
          minHeight: 44,
          padding: "8px 14px",
          fontSize: 15,
          border: "1px solid #333",
          borderRadius: 8,
          background: "#fff",
          cursor: "pointer",
        }}
      >
        + Add option
      </button>
    </div>
  );
}

export default OptionListEditor;
