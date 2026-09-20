import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./contracts";
import {
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
  validateLoginForm,
  validateRegistrationForm,
} from "./formValidation";
import type { RegistrationFormValues } from "./formValidation";

const validRegistration: RegistrationFormValues = {
  fullName: "Taylor Technician",
  company: "Acme Facilities",
  phone: "+65 8000 2001",
  personalEmail: "taylor@example.test",
  companyEmail: "taylor@acme.example.test",
  password: "StrongPassword1",
  passwordConfirmation: "StrongPassword1",
  role: USER_ROLES.worker,
  joinCode: "JOIN-ACME-VALID",
  companyAdminCode: "",
};

describe("auth form validation", () => {
  it("normalizes email casing and surrounding whitespace", () => {
    expect(normalizeEmail("  PERSON@Example.TEST ")).toBe(
      "person@example.test",
    );
  });

  it("requires a valid login email and a password", () => {
    expect(validateLoginForm({ email: "not-an-email", password: "" }))
      .toEqual({
        email: "Enter a valid email address.",
        password: "Enter your password.",
      });
  });

  it("accepts a complete valid Worker registration", () => {
    expect(validateRegistrationForm(validRegistration)).toEqual({});
  });

  it("validates every common required field", () => {
    expect(validateRegistrationForm({
      ...validRegistration,
      fullName: " ",
      company: "",
      phone: "",
      personalEmail: "",
      companyEmail: "",
      password: "",
      passwordConfirmation: "",
    })).toMatchObject({
      fullName: expect.any(String),
      company: expect.any(String),
      phone: expect.any(String),
      personalEmail: expect.any(String),
      companyEmail: expect.any(String),
      password: expect.any(String),
      passwordConfirmation: expect.any(String),
    });
  });

  it.each([
    ["bad personal email", { personalEmail: "invalid" }, "personalEmail"],
    ["bad company email", { companyEmail: "invalid" }, "companyEmail"],
    ["too few phone digits", { phone: "123" }, "phone"],
    ["invalid phone characters", { phone: "+65 call-now" }, "phone"],
  ])("rejects %s", (_label, update, field) => {
    expect(validateRegistrationForm({
      ...validRegistration,
      ...update,
    })).toHaveProperty(field);
  });

  it.each([
    ["a short password", "Aa1short"],
    ["a password without lowercase", "UPPERCASEONLY1"],
    ["a password without uppercase", "lowercaseonly1"],
    ["a password without a number", "NoNumbersHere"],
  ])("rejects %s", (_label, password) => {
    expect(validateRegistrationForm({
      ...validRegistration,
      password,
      passwordConfirmation: password,
    })).toHaveProperty("password");
  });

  it("uses the documented minimum password length", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  it("requires matching password confirmation", () => {
    expect(validateRegistrationForm({
      ...validRegistration,
      passwordConfirmation: "DifferentPassword1",
    })).toHaveProperty("passwordConfirmation", "Passwords do not match.");
  });

  it("requires only the code for the selected role", () => {
    expect(validateRegistrationForm({
      ...validRegistration,
      joinCode: "",
      companyAdminCode: "unused",
    })).toHaveProperty("joinCode");

    const adminErrors = validateRegistrationForm({
      ...validRegistration,
      role: USER_ROLES.admin,
      joinCode: "unused",
      companyAdminCode: "",
    });
    expect(adminErrors).toHaveProperty("companyAdminCode");
    expect(adminErrors).not.toHaveProperty("joinCode");
  });
});
