import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import {
  normalizeEmail,
  validateLoginForm,
} from "../../auth/formValidation";
import type {
  LoginField,
  LoginFieldErrors,
} from "../../auth/formValidation";
import { ROUTES } from "../../config/routes";
import { getPostLoginRoute } from "../../routing/authNavigation";
import { isServiceError } from "../../services/errors";
import "./authForms.css";

const LOGIN_FIELD_ORDER: LoginField[] = ["email", "password"];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const serviceErrorRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (serviceError) serviceErrorRef.current?.focus();
  }, [serviceError]);

  const clearError = (field: LoginField) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setServiceError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;

    const errors = validateLoginForm({ email, password });
    setFieldErrors(errors);
    setServiceError(null);
    const firstInvalidField = LOGIN_FIELD_ORDER.find((field) => errors[field]);
    if (firstInvalidField) {
      focusNamedControl(formRef.current, firstInvalidField);
      return;
    }

    pendingRef.current = true;
    setIsSubmitting(true);
    try {
      const user = await login({
        email: normalizeEmail(email),
        password,
      });
      navigate(getPostLoginRoute(location.state, user.role), { replace: true });
    } catch (error) {
      setServiceError(getLoginErrorMessage(error));
    } finally {
      pendingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <main className="rm-page auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-card__header">
          <p className="auth-card__eyebrow">Welcome back</p>
          <h1 id="login-title">Login</h1>
          <p>Sign in with your account email and password.</p>
        </div>

        <form
          ref={formRef}
          className="auth-form"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={isSubmitting}
        >
          {serviceError && (
            <div
              ref={serviceErrorRef}
              className="auth-form__alert"
              role="alert"
              tabIndex={-1}
            >
              {serviceError}
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                clearError("email");
              }}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
            />
            {fieldErrors.email && (
              <p id="login-email-error" className="auth-field__error">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearError("password");
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={
                fieldErrors.password ? "login-password-error" : undefined
              }
            />
            {fieldErrors.password && (
              <p id="login-password-error" className="auth-field__error">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <button
            className="auth-form__submit rm-touch"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Signing in…" : "Login"}
          </button>
          <p className="auth-form__status" role="status" aria-live="polite">
            {isSubmitting ? "Signing in. Please wait." : ""}
          </p>
        </form>

        <p className="auth-card__alternate">
          Need an account? <Link to={ROUTES.register}>Create account</Link>
        </p>
      </section>
    </main>
  );
}

function focusNamedControl(
  form: HTMLFormElement | null,
  field: LoginField,
): void {
  const control = form?.elements.namedItem(field);
  if (control instanceof HTMLElement) control.focus();
}

function getLoginErrorMessage(error: unknown): string {
  if (!isServiceError(error)) {
    return "We could not sign you in. Please try again.";
  }

  if (error.code === "invalid_credentials") {
    return "Email or password is incorrect.";
  }
  if (error.code === "inactive_account") {
    return "This account is inactive. Contact your administrator.";
  }
  if (error.code === "rate_limited") {
    return "Too many sign-in attempts. Wait a moment and try again.";
  }
  if (error.code === "network_error") {
    return "We could not reach the service. Check your connection and try again.";
  }
  return "We could not sign you in. Please try again.";
}
