// LoginPage — the credentials form at /login, and the app's only way in.
//
// It renders the form, hands the credentials to useAuth().login(), and on
// success sends the user where they were heading. It owns NO session state:
// the token and the user live in AuthContext, which is also what the nav and
// the route guard read. This page is a form and a redirect, nothing more.
//
// REDIRECT TARGET: react-router puts the attempted location in
// `location.state.from` when a guard bounces someone here. Honour it when it
// is there, fall back to /dashboard when it is not. That is what makes a
// deep link survive an expired session instead of dumping the user on the
// landing screen with no idea why.
//
// STYLING follows pages/Login/README.md and the house rules: mobile-first,
// inline styles over src/styles/tokens.ts, >=44px tap targets, >=16px inputs
// (so mobile Safari does not zoom on focus), high contrast for outdoor use.

import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../api/client";
import {
  colors,
  controlStyle,
  fontSize,
  primaryButtonStyle,
  radius,
  spacing,
} from "../../styles/tokens";

// Where a user lands when nothing sent them here in particular.
const DEFAULT_DESTINATION = "/dashboard";

// The message for a rejected credential pair.
//
// ONE MESSAGE, not two. The backend answers a wrong password and an unknown
// email identically on purpose, so there is nothing here to distinguish even
// if we wanted to — and phrasing it as "email or password" keeps the UI from
// implying a distinction the API refuses to make.
const INVALID_CREDENTIALS_MESSAGE =
  "That email and password do not match an account.";

// Shape of the location state react-router carries when a guard redirects.
// components/RequireAuth puts the WHOLE attempted location in `from`, so the
// query string and hash are there to be restored alongside the path.
interface LocationState {
  from?: { pathname?: string; search?: string; hash?: string };
}

// Rebuild the attempted URL from the location a guard stashed.
//
// The search matters as much as the path here: the dashboard keeps its
// filters and its ?highlight= in the query string, so restoring only the
// pathname would turn a shared "the drafts from last week" link into a bare,
// unfiltered page — a deep link that technically survived login and lost the
// thing it was linking to.
function destinationFrom(state: LocationState | null): string {
  const from = state?.from;
  if (!from?.pathname) {
    return DEFAULT_DESTINATION;
  }
  return `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`;
}

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const destination = destinationFrom(location.state as LocationState | null);

  // Already signed in? Nothing to do here. `replace` keeps /login out of the
  // history so the back button does not bounce between the two.
  if (!loading && user) {
    return <Navigate to={destination} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(destination, { replace: true });
    } catch (caught) {
      setError(messageFor(caught));
      // Clear only the password. Retyping an email you got right is the kind
      // of small insult that makes a form feel hostile on a phone.
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        padding: spacing.lg,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 420,
          background: colors.surface,
          border: `1px solid ${colors.borderSubtle}`,
          borderRadius: radius.lg,
          padding: spacing.xl,
          marginTop: spacing.xl,
        }}
      >
        <h1
          style={{
            margin: 0,
            marginBottom: spacing.sm,
            fontSize: fontSize.xl,
            color: colors.text,
          }}
        >
          Sign in
        </h1>
        <p
          style={{
            margin: 0,
            marginBottom: spacing.xl,
            fontSize: fontSize.base,
            lineHeight: 1.5,
            color: colors.textMuted,
          }}
        >
          Report Mate — field service reporting.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          {/* role="alert" so a screen reader announces the failure without the
              user having to go looking for it. Rendered above the fields
              because on a phone the submit button is often under the keyboard. */}
          {error !== null && (
            <p
              role="alert"
              data-testid="login-error"
              style={{
                margin: 0,
                marginBottom: spacing.lg,
                padding: spacing.md,
                borderRadius: radius.md,
                border: `1px solid ${colors.dangerText}`,
                background: colors.surface,
                color: colors.dangerText,
                fontSize: fontSize.base,
                lineHeight: 1.5,
              }}
            >
              {error}
            </p>
          )}

          <Field label="Email" htmlFor="login-email">
            <input
              id="login-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              // The browser's own autofill and keyboard hints do more for
              // one-handed entry in the field than any styling here.
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={submitting}
              style={{ ...controlStyle, width: "100%" }}
            />
          </Field>

          <Field label="Password" htmlFor="login-password">
            <input
              id="login-password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={submitting}
              style={{ ...controlStyle, width: "100%" }}
            />
          </Field>

          <button
            type="submit"
            disabled={submitting}
            style={{
              ...primaryButtonStyle,
              width: "100%",
              marginTop: spacing.sm,
              opacity: submitting ? 0.7 : 1,
              cursor: submitting ? "progress" : "pointer",
            }}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

// A labelled field. The <label> is a real one bound by htmlFor, not a
// placeholder: placeholders vanish on focus, which is exactly when someone
// squinting at a phone in the sun needs to know what they are typing into.
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: spacing.lg }}>
      <label
        htmlFor={htmlFor}
        style={{
          display: "block",
          marginBottom: spacing.xs,
          fontSize: fontSize.base,
          fontWeight: 600,
          color: colors.text,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// Map a rejection from the auth client to something worth showing a user.
//
// 401 is the expected failure and gets the credentials message. Everything
// else — the API down, a 500, a network error — is NOT the user's fault, and
// telling them their password is wrong when the server is unreachable sends
// them off resetting a password that was fine.
function messageFor(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 401) {
    return INVALID_CREDENTIALS_MESSAGE;
  }
  if (caught instanceof ApiError) {
    return "Sign-in failed. Please try again in a moment.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

export default LoginPage;
