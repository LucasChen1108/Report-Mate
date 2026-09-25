import type { UserRole } from "./contracts";
import { USER_ROLES } from "./contracts";

export const PASSWORD_MIN_LENGTH = 12;

export interface LoginFormValues {
  email: string;
  password: string;
}

export type LoginField = keyof LoginFormValues;
export type LoginFieldErrors = Partial<Record<LoginField, string>>;

export interface RegistrationFormValues {
  fullName: string;
  company: string;
  phone: string;
  personalEmail: string;
  companyEmail: string;
  password: string;
  passwordConfirmation: string;
  role: UserRole;
  joinCode: string;
  companyAdminCode: string;
}

export type RegistrationField = Exclude<
  keyof RegistrationFormValues,
  "role"
>;
export type RegistrationFieldErrors = Partial<
  Record<RegistrationField, string>
>;

export interface ProfileFormValues {
  fullName: string;
  phone: string;
  personalEmail: string;
}

export type ProfileField = keyof ProfileFormValues;
export type ProfileFieldErrors = Partial<Record<ProfileField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARACTERS_PATTERN = /^\+?[0-9 ()-]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateLoginForm(
  values: LoginFormValues,
): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const email = normalizeEmail(values.email);

  if (!email) {
    errors.email = "Enter your email address.";
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.password) {
    errors.password = "Enter your password.";
  }

  return errors;
}

export function validateRegistrationForm(
  values: RegistrationFormValues,
): RegistrationFieldErrors {
  const errors: RegistrationFieldErrors = {};

  if (!values.fullName.trim()) {
    errors.fullName = "Enter your full name.";
  }
  if (!values.company.trim()) {
    errors.company = "Enter your company name.";
  }

  errors.phone = getPhoneError(values.phone);
  errors.personalEmail = getEmailError(
    values.personalEmail,
    "personal email address",
  );
  errors.companyEmail = getEmailError(
    values.companyEmail,
    "company email address",
  );

  if (!values.password) {
    errors.password = "Create a password.";
  } else if (values.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (!/[a-z]/.test(values.password)) {
    errors.password = "Include at least one lowercase letter.";
  } else if (!/[A-Z]/.test(values.password)) {
    errors.password = "Include at least one uppercase letter.";
  } else if (!/\d/.test(values.password)) {
    errors.password = "Include at least one number.";
  }

  if (!values.passwordConfirmation) {
    errors.passwordConfirmation = "Confirm your password.";
  } else if (values.passwordConfirmation !== values.password) {
    errors.passwordConfirmation = "Passwords do not match.";
  }

  if (
    values.role === USER_ROLES.worker &&
    !values.joinCode.trim()
  ) {
    errors.joinCode = "Enter the join code from your administrator.";
  }
  if (
    values.role === USER_ROLES.admin &&
    !values.companyAdminCode.trim()
  ) {
    errors.companyAdminCode = "Enter your company admin code.";
  }

  return errors;
}

export function validateProfileForm(
  values: ProfileFormValues,
): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  if (!values.fullName.trim()) {
    errors.fullName = "Enter your full name.";
  }
  errors.phone = getPhoneError(values.phone);
  errors.personalEmail = getEmailError(
    values.personalEmail,
    "personal email address",
  );
  return errors;
}

function getPhoneError(value: string): string | undefined {
  const phone = value.trim();
  const digitCount = phone.replace(/\D/g, "").length;
  if (!phone) return "Enter your phone number.";
  if (
    !PHONE_CHARACTERS_PATTERN.test(phone) ||
    digitCount < 7 ||
    digitCount > 15
  ) {
    return "Enter a valid phone number with 7 to 15 digits.";
  }
  return undefined;
}

function getEmailError(
  value: string,
  label: string,
): string | undefined {
  const email = normalizeEmail(value);
  if (!email) return `Enter your ${label}.`;
  if (!EMAIL_PATTERN.test(email)) return `Enter a valid ${label}.`;
  return undefined;
}
