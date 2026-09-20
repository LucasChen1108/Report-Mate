import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { USER_ROLES } from "../../auth/contracts";
import type { RegistrationInput, UserRole } from "../../auth/contracts";
import {
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
  validateRegistrationForm,
} from "../../auth/formValidation";
import type {
  RegistrationField,
  RegistrationFieldErrors,
  RegistrationFormValues,
} from "../../auth/formValidation";
import { ROUTES } from "../../config/routes";
import { isServiceError } from "../../services/errors";
import "./authForms.css";

const INITIAL_VALUES: RegistrationFormValues = {
  fullName: "",
  company: "",
  phone: "",
  personalEmail: "",
  companyEmail: "",
  password: "",
  passwordConfirmation: "",
  role: USER_ROLES.worker,
  joinCode: "",
  companyAdminCode: "",
};

const REGISTRATION_FIELD_ORDER: RegistrationField[] = [
  "fullName",
  "company",
  "phone",
  "personalEmail",
  "companyEmail",
  "password",
  "passwordConfirmation",
  "joinCode",
  "companyAdminCode",
];

export function RegistrationPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<RegistrationFormValues>(INITIAL_VALUES);
  const [fieldErrors, setFieldErrors] = useState<RegistrationFieldErrors>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const serviceErrorRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (serviceError) serviceErrorRef.current?.focus();
  }, [serviceError]);

  const updateField = (field: RegistrationField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setServiceError(null);
  };

  const selectRole = (role: UserRole) => {
    setValues((current) => ({
      ...current,
      role,
      joinCode: role === USER_ROLES.worker ? current.joinCode : "",
      companyAdminCode:
        role === USER_ROLES.admin ? current.companyAdminCode : "",
    }));
    setFieldErrors((current) => ({
      ...current,
      joinCode: undefined,
      companyAdminCode: undefined,
    }));
    setServiceError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;

    const errors = validateRegistrationForm(values);
    setFieldErrors(errors);
    setServiceError(null);
    const firstInvalidField = REGISTRATION_FIELD_ORDER.find(
      (field) => errors[field],
    );
    if (firstInvalidField) {
      focusNamedControl(formRef.current, firstInvalidField);
      return;
    }

    const commonInput = {
      fullName: values.fullName.trim(),
      company: values.company.trim(),
      phone: values.phone.trim(),
      personalEmail: normalizeEmail(values.personalEmail),
      companyEmail: normalizeEmail(values.companyEmail),
      password: values.password,
    };
    const input: RegistrationInput = values.role === USER_ROLES.admin
      ? {
          ...commonInput,
          role: USER_ROLES.admin,
          companyAdminCode: values.companyAdminCode.trim(),
        }
      : {
          ...commonInput,
          role: USER_ROLES.worker,
          joinCode: values.joinCode.trim(),
        };

    pendingRef.current = true;
    setIsSubmitting(true);
    try {
      const user = await register(input);
      navigate(
        user.role === USER_ROLES.admin
          ? ROUTES.templates
          : ROUTES.generateReport,
        { replace: true },
      );
    } catch (error) {
      const displayError = getRegistrationError(error);
      setServiceError(displayError.message);
      if (displayError.field) {
        setFieldErrors((current) => ({
          ...current,
          [displayError.field!]: displayError.message,
        }));
      }
    } finally {
      pendingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <main className="rm-page auth-page">
      <section className="auth-card" aria-labelledby="registration-title">
        <div className="auth-card__header">
          <p className="auth-card__eyebrow">Get started</p>
          <h1 id="registration-title">Create account</h1>
          <p>Your authorization code determines your company and access.</p>
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

          <fieldset
            className="auth-role"
            aria-describedby="account-type-help"
          >
            <legend>Account type</legend>
            <p id="account-type-help">
              Choose Worker unless your company provided an admin code.
            </p>
            <div className="auth-role__options">
              <label>
                <input
                  type="radio"
                  name="role"
                  value={USER_ROLES.worker}
                  checked={values.role === USER_ROLES.worker}
                  onChange={() => selectRole(USER_ROLES.worker)}
                />
                <span>
                  <strong>Worker</strong>
                  <small>Complete reports and manage your profile</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="role"
                  value={USER_ROLES.admin}
                  checked={values.role === USER_ROLES.admin}
                  onChange={() => selectRole(USER_ROLES.admin)}
                />
                <span>
                  <strong>Admin</strong>
                  <small>Manage templates and linked workers</small>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="auth-form__grid">
            <RegistrationFieldControl
              id="registration-full-name"
              name="fullName"
              label="Full name"
              autoComplete="name"
              value={values.fullName}
              error={fieldErrors.fullName}
              onChange={(value) => updateField("fullName", value)}
            />
            <RegistrationFieldControl
              id="registration-company"
              name="company"
              label="Company"
              autoComplete="organization"
              value={values.company}
              error={fieldErrors.company}
              onChange={(value) => updateField("company", value)}
            />
            <RegistrationFieldControl
              id="registration-phone"
              name="phone"
              label="Phone number"
              type="tel"
              autoComplete="tel"
              value={values.phone}
              error={fieldErrors.phone}
              onChange={(value) => updateField("phone", value)}
            />
            <RegistrationFieldControl
              id="registration-personal-email"
              name="personalEmail"
              label="Personal email"
              type="email"
              autoComplete="section-personal email"
              value={values.personalEmail}
              error={fieldErrors.personalEmail}
              onChange={(value) => updateField("personalEmail", value)}
            />
            <RegistrationFieldControl
              id="registration-company-email"
              name="companyEmail"
              label="Company email"
              type="email"
              autoComplete="section-company email"
              value={values.companyEmail}
              error={fieldErrors.companyEmail}
              onChange={(value) => updateField("companyEmail", value)}
            />
            <RegistrationFieldControl
              id="registration-password"
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              value={values.password}
              error={fieldErrors.password}
              help={`Use at least ${PASSWORD_MIN_LENGTH} characters with uppercase, lowercase, and a number.`}
              onChange={(value) => updateField("password", value)}
            />
            <RegistrationFieldControl
              id="registration-password-confirmation"
              name="passwordConfirmation"
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={values.passwordConfirmation}
              error={fieldErrors.passwordConfirmation}
              onChange={(value) => updateField("passwordConfirmation", value)}
            />
          </div>

          {values.role === USER_ROLES.worker ? (
            <RegistrationFieldControl
              id="registration-join-code"
              name="joinCode"
              label="Join code"
              autoComplete="off"
              value={values.joinCode}
              error={fieldErrors.joinCode}
              help="Ask the administrator who invited you for this code."
              onChange={(value) => updateField("joinCode", value)}
            />
          ) : (
            <RegistrationFieldControl
              id="registration-company-admin-code"
              name="companyAdminCode"
              label="Company admin code"
              autoComplete="off"
              value={values.companyAdminCode}
              error={fieldErrors.companyAdminCode}
              help="Use the admin authorization code supplied by your company."
              onChange={(value) => updateField("companyAdminCode", value)}
            />
          )}

          <button
            className="auth-form__submit rm-touch"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating account…" : "Create account"}
          </button>
          <p className="auth-form__status" role="status" aria-live="polite">
            {isSubmitting ? "Creating your account. Please wait." : ""}
          </p>
        </form>

        <p className="auth-card__alternate">
          Already have an account? <Link to={ROUTES.login}>Login</Link>
        </p>
      </section>
    </main>
  );
}

interface RegistrationFieldControlProps {
  id: string;
  name: RegistrationField;
  label: string;
  value: string;
  error?: string;
  help?: string;
  type?: "text" | "email" | "tel" | "password";
  autoComplete: string;
  onChange: (value: string) => void;
}

function RegistrationFieldControl({
  id,
  name,
  label,
  value,
  error,
  help,
  type = "text",
  autoComplete,
  onChange,
}: RegistrationFieldControlProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
      {help && (
        <p id={helpId} className="auth-field__help">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="auth-field__error">
          {error}
        </p>
      )}
    </div>
  );
}

function focusNamedControl(
  form: HTMLFormElement | null,
  field: RegistrationField,
): void {
  const control = form?.elements.namedItem(field);
  if (control instanceof HTMLElement) control.focus();
}

interface RegistrationDisplayError {
  message: string;
  field?: RegistrationField;
}

function getRegistrationError(error: unknown): RegistrationDisplayError {
  if (!isServiceError(error)) {
    return { message: "We could not create your account. Please try again." };
  }

  const field = toRegistrationField(error.field);
  switch (error.code) {
    case "invalid_code":
      return {
        message: "That authorization code is invalid. Check it and try again.",
        field,
      };
    case "expired_code":
      return {
        message: "That authorization code has expired. Ask for a new code.",
        field,
      };
    case "revoked_code":
      return {
        message: "That authorization code was revoked. Ask for a new code.",
        field,
      };
    case "used_code":
      return {
        message: "That authorization code has already been used. Ask for a new code.",
        field,
      };
    case "company_mismatch":
      return {
        message: "The authorization code does not match that company.",
        field: "company",
      };
    case "conflict":
      return {
        message: "An account already uses one of these email addresses.",
      };
    case "rate_limited":
      return {
        message: "Too many registration attempts. Wait a moment and try again.",
      };
    case "network_error":
      return {
        message: "We could not reach the service. Check your connection and try again.",
      };
    case "validation_error":
      return { message: error.message, field };
    default:
      return { message: "We could not create your account. Please try again." };
  }
}

function toRegistrationField(field: string | undefined): RegistrationField | undefined {
  if (!field || !REGISTRATION_FIELD_ORDER.includes(field as RegistrationField)) {
    return undefined;
  }
  return field as RegistrationField;
}
