// ConfirmDialog — an accessible, large-tap-target confirmation modal.
//
// SCOPE (task 10.3): used to confirm a destructive section delete when the
// section contains one or more fields (Req 3.8). It is a controlled component:
// the parent decides when it is open and supplies onConfirm / onCancel. Only
// after the dispatcher taps Confirm does the parent dispatch removeSection
// (Req 3.9).
//
// Accessibility: renders as role="dialog" with aria-modal, a labelled title and
// message, focuses the confirm button on open, and closes on Escape. Confirm and
// Cancel are large (>=44px) tap targets (Req 8.2). Full styling polish is task
// 12.1.

import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  // Whether the dialog is shown. When false, nothing is rendered.
  open: boolean;
  // Short dialog title, e.g. "Delete section".
  title: string;
  // Body message describing the consequence of confirming.
  message: string;
  // Label for the destructive confirm action (default "Delete").
  confirmLabel?: string;
  // Label for the cancel action (default "Cancel").
  cancelLabel?: string;
  // Called when the dispatcher confirms the destructive action.
  onConfirm: () => void;
  // Called when the dispatcher cancels (Cancel button, Escape, or backdrop).
  onCancel: () => void;
}

const titleId = "confirm-dialog-title";
const messageId = "confirm-dialog-message";

const tapTarget: React.CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  padding: "10px 16px",
  fontSize: 16,
  borderRadius: 8,
  cursor: "pointer",
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Move focus to the confirm button when the dialog opens and wire Escape to
  // cancel. Effect body is a no-op while closed.
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const backdropStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 1000,
  };

  const dialogStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 12,
    border: "2px solid #333",
    padding: 20,
    maxWidth: 400,
    width: "100%",
  };

  return (
    <div
      style={backdropStyle}
      data-testid="confirm-dialog-backdrop"
      // A tap on the backdrop (outside the dialog) cancels.
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        data-testid="confirm-dialog"
        style={dialogStyle}
        // Keep clicks inside the dialog from bubbling to the backdrop handler.
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} style={{ margin: "0 0 8px", fontSize: 18 }}>
          {title}
        </h2>
        <p id={messageId} style={{ margin: "0 0 20px", fontSize: 15 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            type="button"
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            style={{
              ...tapTarget,
              border: "1px solid #333",
              background: "#fff",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            style={{
              ...tapTarget,
              border: "1px solid #a00",
              background: "#c0392b",
              color: "#fff",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
