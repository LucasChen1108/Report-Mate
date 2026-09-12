// AddSectionForm — the add-section control for the Template Builder (Req 3.1,
// 3.2, 3.3).
//
// SCOPE (task 10.3): a controlled inline form (NOT window.prompt, so it is
// testable and mobile-friendly). It requests a Section label of 1–100 characters
// and, on confirm:
//   - trims the label; if empty/whitespace-only it REJECTS, showing a
//     "Section label is required" message and NOT calling onAdd (Req 3.3),
//   - otherwise calls onAdd(label), which the parent maps to dispatch
//     addSection{label} — the reducer appends the section last (Req 3.1).
//
// The 100-char max is enforced via maxLength plus a validation message as a
// backstop. Styling is minimal with large tap targets (>=44px); full styling is
// task 12.1.

import { useState } from "react";

const MAX_SECTION_LABEL = 100;

interface AddSectionFormProps {
  // Called with a valid, trimmed, 1–100 char label. The parent dispatches
  // addSection{label}.
  onAdd: (label: string) => void;
}

const controlStyle: React.CSSProperties = {
  minHeight: 44,
  fontSize: 16,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #333",
};

export function AddSectionForm({ onAdd }: AddSectionFormProps) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();

    // Reject empty / whitespace-only labels (Req 3.3).
    if (trimmed.length === 0) {
      setError("Section label is required");
      return;
    }

    // Backstop the 100-char max (also enforced by maxLength on the input).
    if (trimmed.length > MAX_SECTION_LABEL) {
      setError(`Section label must be ${MAX_SECTION_LABEL} characters or fewer`);
      return;
    }

    onAdd(trimmed);
    setLabel("");
    setError(null);
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="add-section-form"
      aria-label="Add section"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "flex-start",
        marginTop: 16,
      }}
    >
      <label style={{ flex: 1, minWidth: 200 }}>
        <span style={{ display: "block", marginBottom: 4 }}>New section label</span>
        <input
          type="text"
          value={label}
          maxLength={MAX_SECTION_LABEL}
          onChange={(e) => {
            setLabel(e.target.value);
            if (error) setError(null);
          }}
          placeholder="e.g. Visit Information"
          data-testid="add-section-input"
          aria-invalid={error !== null}
          aria-describedby={error ? "add-section-error" : undefined}
          style={{ ...controlStyle, width: "100%" }}
        />
      </label>
      <button
        type="submit"
        data-testid="add-section-button"
        style={{
          ...controlStyle,
          minWidth: 44,
          alignSelf: "flex-end",
          cursor: "pointer",
          background: "#1a5fb4",
          color: "#fff",
          border: "1px solid #14477f",
        }}
      >
        Add section
      </button>
      {error && (
        <p
          id="add-section-error"
          role="alert"
          data-testid="add-section-error"
          style={{ flexBasis: "100%", margin: 0, color: "#c0392b" }}
        >
          {error}
        </p>
      )}
    </form>
  );
}

export default AddSectionForm;
