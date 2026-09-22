// AgentAssistPanel — the "draft this report from a rough account" surface.
//
// This is the technician's entry point to the AI agent (Req 4.3): a multiline
// free-text box for a rough account of the visit and one big "Fill with AI"
// button. It owns the in-flight run and its own error/status state, then hands
// the returned draft up to the parent via `onFilled` — the parent
// (ReportEditorPage, task 15.2) is what actually loads the content into the
// editor and highlights the flagged fields.
//
// WHY THE PANEL OWNS THE CALL: keeping `agentFill` in here means the parent
// stays a plain "here's the new draft" consumer — it never sees the in-flight
// or error states, so the manual Save draft / Save and Export flow is entirely
// independent of the agent (graceful degradation, Req 9.5). If the gateway is
// down, this panel shows a fallback message and leaves the form untouched; the
// technician fills the same template by hand (Req 9.1, 9.4).
//
// SECURITY: all agent traffic goes through `api/agent.ts` -> the Go backend.
// The gateway key is never handled client-side (Req 7.4).

import { useState } from "react";
import { agentFill } from "../../api/agent";
import type { AgentFillResponse } from "../../api/agent";
import { ApiError, ApiValidationError } from "../../api/client";
import { colors, fontSize, radius, spacing } from "../../styles/tokens";

// The backend caps the account at 10,000 characters and re-validates it; we
// mirror that bound here so the button disables before a doomed round trip.
const MAX_ACCOUNT_LENGTH = 10_000;

// Show the character-count hint only as the technician approaches the cap, so
// it does not clutter the panel during normal use.
const CHAR_HINT_THRESHOLD = 9_000;

// The exact fallback copy the product spec requires on a 503 (Req 9.1, 9.4).
const UNAVAILABLE_MESSAGE =
  "The AI assistant is unavailable right now — you can fill this report in by hand.";
const GENERIC_ERROR_MESSAGE = "Something went wrong running the assistant.";

interface AgentAssistPanelProps {
  // The draft to run the agent against. The panel posts to
  // /api/reports/{reportId}/agent-fill.
  reportId: string;
  // Called with the run's response on success. The parent loads the returned
  // content into the editor and highlights `flaggedFieldIds`.
  onFilled: (response: AgentFillResponse) => void;
}

export function AgentAssistPanel({ reportId, onFilled }: AgentAssistPanelProps) {
  // The technician's free-text account.
  const [account, setAccount] = useState<string>("");
  // True while a run is in flight — disables the button and shows "Working…".
  const [running, setRunning] = useState<boolean>(false);
  // A user-facing error message, or null when there is nothing to show.
  const [error, setError] = useState<string | null>(null);

  const trimmedLength = account.trim().length;
  const tooLong = account.length > MAX_ACCOUNT_LENGTH;
  // Disabled while running, when there is nothing to send, or when over the cap.
  const disabled = running || trimmedLength === 0 || tooLong;

  const handleFill = async () => {
    if (disabled) return;
    setRunning(true);
    setError(null);
    try {
      const response = await agentFill(reportId, { account });
      onFilled(response);
    } catch (err) {
      // 503 -> the agent is unavailable; leave the form exactly as it was so
      // the technician can retry or fall back to filling by hand (Req 9.1/9.4).
      if (err instanceof ApiError && err.status === 503) {
        setError(UNAVAILABLE_MESSAGE);
      } else if (err instanceof ApiValidationError) {
        // 422 -> the backend named the input problem (e.g. empty/over-length).
        setError(err.message);
      } else {
        setError(GENERIC_ERROR_MESSAGE);
      }
    } finally {
      // Always clear the in-flight state, success or failure.
      setRunning(false);
    }
  };

  return (
    <section
      className="rm-no-print"
      data-testid="agent-panel"
      aria-label="AI assistant"
      style={{
        margin: `0 0 ${spacing.xl}px`,
        padding: spacing.lg,
        borderRadius: radius.lg,
        border: `1px solid ${colors.borderSubtle}`,
        background: colors.surfaceMuted,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
      }}
    >
      <div>
        <strong style={{ fontSize: fontSize.base, color: colors.text }}>
          Draft with AI
        </strong>
        <p
          style={{
            margin: `${spacing.xs}px 0 0`,
            fontSize: fontSize.sm,
            color: colors.textMuted,
          }}
        >
          Describe what happened on the visit and the assistant fills in the
          report. You always review and edit before submitting.
        </p>
      </div>

      <label htmlFor="agent-account-input" style={{ display: "block" }}>
        <span
          style={{
            display: "block",
            marginBottom: spacing.xs,
            fontSize: fontSize.sm,
            color: colors.textMuted,
          }}
        >
          Account of the visit
        </span>
        <textarea
          id="agent-account-input"
          data-testid="agent-account-input"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value);
            // Clear a stale error the moment the technician starts editing —
            // the input that failed may be exactly what just changed.
            setError((prev) => (prev === null ? prev : null));
          }}
          disabled={running}
          rows={5}
          placeholder="Describe the visit…"
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            minHeight: 96,
            fontSize: fontSize.base,
            lineHeight: 1.4,
            padding: `${spacing.sm}px ${spacing.md}px`,
            borderRadius: radius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            resize: "vertical",
          }}
        />
      </label>

      {/* Character-count hint near the cap, and a hard over-limit warning. */}
      {account.length >= CHAR_HINT_THRESHOLD && (
        <p
          data-testid="agent-char-count"
          style={{
            margin: 0,
            fontSize: fontSize.xs,
            color: tooLong ? colors.dangerText : colors.textMuted,
          }}
        >
          {account.length.toLocaleString()} / {MAX_ACCOUNT_LENGTH.toLocaleString()} characters
          {tooLong ? " — too long to send." : ""}
        </p>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing.md,
        }}
      >
        <button
          type="button"
          data-testid="agent-fill-button"
          onClick={() => void handleFill()}
          disabled={disabled}
          style={{
            minHeight: 44,
            padding: `${spacing.sm}px ${spacing.xl}px`,
            fontSize: fontSize.base,
            fontWeight: 600,
            borderRadius: radius.md,
            background: disabled ? colors.textMuted : colors.primary,
            color: colors.onPrimary,
            border: `1px solid ${disabled ? colors.textMuted : colors.primaryHover}`,
            cursor: disabled ? "default" : "pointer",
          }}
        >
          {running ? "Working…" : "Fill with AI"}
        </button>

        {running && (
          <span
            role="status"
            data-testid="agent-status"
            style={{ fontSize: fontSize.sm, color: colors.textMuted }}
          >
            Working…
          </span>
        )}
      </div>

      {error !== null && (
        <p
          role="alert"
          data-testid="agent-error"
          style={{
            margin: 0,
            fontSize: fontSize.sm,
            color: colors.dangerText,
          }}
        >
          {error}
        </p>
      )}
    </section>
  );
}

export default AgentAssistPanel;
