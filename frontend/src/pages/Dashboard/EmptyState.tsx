// EmptyState — the "there is deliberately nothing here" panel.
//
// Shared by both dashboard screens because an empty screen is the one state
// this app cannot afford to render as a blank area: a technician who files a
// report and lands on white space concludes the app lost it. Every empty case
// therefore gets a heading that says WHAT is empty, a line that says WHY, and —
// where one exists — the action that fills it.
//
// Purely presentational: no fetching, no routing decisions, no knowledge of
// which screen mounted it.

import { Link } from "react-router-dom";
import {
  colors,
  fontSize,
  radius,
  spacing,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "../../styles/tokens";

export interface EmptyStateAction {
  label: string;
  /** A router path. Mutually exclusive with `onClick`. */
  to?: string;
  onClick?: () => void;
}

export interface EmptyStateProps {
  title: string;
  /** One or two sentences explaining why it is empty and what to do. */
  message: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** Set for error-ish empties (failed load) so the panel reads as a problem. */
  tone?: "neutral" | "error";
}

export function EmptyState({
  title,
  message,
  primaryAction,
  secondaryAction,
  tone = "neutral",
}: EmptyStateProps) {
  const isError = tone === "error";

  return (
    <div
      data-testid="empty-state"
      // role=status, not role=alert: an empty list is information, and an alert
      // interrupts a screen-reader user mid-sentence for something that is not
      // urgent. The error tone is announced by the message itself.
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: spacing.md,
        padding: spacing.xl,
        background: colors.surface,
        border: `1px solid ${isError ? colors.dangerText : colors.borderSubtle}`,
        borderRadius: radius.lg,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: fontSize.lg,
          color: isError ? colors.dangerText : colors.text,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: fontSize.base,
          lineHeight: 1.5,
          color: colors.textMuted,
          maxWidth: "60ch",
        }}
      >
        {message}
      </p>

      {(primaryAction || secondaryAction) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm }}>
          {primaryAction && (
            <ActionControl action={primaryAction} style={primaryButtonStyle} />
          )}
          {secondaryAction && (
            <ActionControl action={secondaryAction} style={secondaryButtonStyle} />
          )}
        </div>
      )}
    </div>
  );
}

// A link and a button look identical here but must stay semantically distinct:
// `to` navigates (middle-click, copy-link, browser back all work), `onClick`
// runs something (a retry). Rendering a retry as an <a> would break all three.
function ActionControl({
  action,
  style,
}: {
  action: EmptyStateAction;
  style: React.CSSProperties;
}) {
  const linkStyle: React.CSSProperties = {
    ...style,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
  };

  if (action.to) {
    return (
      <Link to={action.to} style={linkStyle}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} style={style}>
      {action.label}
    </button>
  );
}

export default EmptyState;
