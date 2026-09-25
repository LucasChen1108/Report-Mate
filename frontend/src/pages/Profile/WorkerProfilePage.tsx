import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../../auth/AuthProvider";
import {
  getUserRoleLabel,
  type CurrentProfile,
} from "../../auth/contracts";
import {
  normalizeEmail,
  validateProfileForm,
  type ProfileField,
  type ProfileFieldErrors,
  type ProfileFormValues,
} from "../../auth/formValidation";
import { isServiceError } from "../../services/errors";
import { useServices } from "../../services/ServiceProvider";
import "../roleManagement.css";

const PROFILE_FIELD_ORDER: ProfileField[] = [
  "fullName",
  "phone",
  "personalEmail",
];

const EMPTY_FORM: ProfileFormValues = {
  fullName: "",
  phone: "",
  personalEmail: "",
};

export function WorkerProfilePage() {
  const { workers: workerService } = useServices();
  const { handleSessionError, updateUserIdentity } = useAuth();
  const [profile, setProfile] = useState<CurrentProfile | null>(null);
  const [values, setValues] = useState<ProfileFormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const savePendingRef = useRef(false);

  useEffect(() => {
    if (serviceError) alertRef.current?.focus();
  }, [serviceError]);

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const loadedProfile = await workerService.getCurrentProfile();
      if (!loadedProfile) {
        setProfile(null);
        setValues(EMPTY_FORM);
        return;
      }
      setProfile(loadedProfile);
      setValues({
        fullName: loadedProfile.fullName,
        phone: loadedProfile.phone,
        personalEmail: loadedProfile.personalEmail,
      });
    } catch (error) {
      if (!(await handleSessionError(error))) {
        setLoadError(getProfileLoadErrorMessage(error));
      }
    } finally {
      setIsLoading(false);
    }
  }, [handleSessionError, workerService]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const setField = (field: ProfileField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setServiceError(null);
    setSuccessMessage(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savePendingRef.current || !profile) return;

    const errors = validateProfileForm(values);
    setFieldErrors(errors);
    setServiceError(null);
    setSuccessMessage(null);
    const firstInvalidField = PROFILE_FIELD_ORDER.find((field) => errors[field]);
    if (firstInvalidField) {
      focusNamedControl(formRef.current, firstInvalidField);
      return;
    }

    savePendingRef.current = true;
    setIsSaving(true);
    try {
      const updated = await workerService.updateCurrentProfile({
        fullName: values.fullName.trim(),
        phone: values.phone.trim(),
        personalEmail: normalizeEmail(values.personalEmail),
      });
      setProfile(updated);
      setValues({
        fullName: updated.fullName,
        phone: updated.phone,
        personalEmail: updated.personalEmail,
      });
      updateUserIdentity(updated);
      setSuccessMessage("Profile updated successfully.");
    } catch (error) {
      if (await handleSessionError(error)) return;
      if (isServiceError(error) && isProfileField(error.field)) {
        setFieldErrors((current) => ({
          ...current,
          [error.field as ProfileField]: error.message,
        }));
      }
      setServiceError(getProfileSaveErrorMessage(error));
    } finally {
      savePendingRef.current = false;
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <main className="rm-page role-page" aria-busy="true">
        <p role="status">Loading your profile…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="rm-page role-page">
        <h1>My Profile</h1>
        <div className="role-alert" role="alert">{loadError}</div>
        <button className="role-button role-button--secondary" type="button" onClick={() => void loadProfile()}>
          Retry
        </button>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="rm-page role-page">
        <h1>My Profile</h1>
        <p>No profile is available for this account.</p>
      </main>
    );
  }

  return (
    <main className="rm-page role-page">
      <header className="role-page__header">
        <p className="role-page__eyebrow">Worker account</p>
        <h1>My Profile</h1>
        <p>Update your contact details. Company and account linkage are managed by your administrator.</p>
      </header>

      <section className="role-card" aria-labelledby="profile-details-title">
        <h2 id="profile-details-title">Account details</h2>
        <dl className="role-detail-grid">
          <div><dt>Company</dt><dd>{profile.companyName}</dd></div>
          <div><dt>Company email</dt><dd>{profile.companyEmail}</dd></div>
          <div>
            <dt>Role</dt>
            <dd>{getUserRoleLabel(profile.role)} ({profile.role})</dd>
          </div>
          <div>
            <dt>Linked Admin</dt>
            <dd>
              {profile.linkedAdmin
                ? `${profile.linkedAdmin.fullName} (${profile.linkedAdmin.companyEmail})`
                : "No linked administrator"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="role-card" aria-labelledby="profile-contact-title">
        <h2 id="profile-contact-title">Contact details</h2>
        <form ref={formRef} className="role-form" onSubmit={handleSubmit} noValidate aria-busy={isSaving}>
          {serviceError && (
            <div ref={alertRef} className="role-alert" role="alert" tabIndex={-1}>
              {serviceError}
            </div>
          )}

          <div className="role-field">
            <label htmlFor="profile-full-name">Full name</label>
            <input
              id="profile-full-name"
              name="fullName"
              autoComplete="name"
              value={values.fullName}
              onChange={(event) => setField("fullName", event.target.value)}
              aria-invalid={Boolean(fieldErrors.fullName)}
              aria-describedby={fieldErrors.fullName ? "profile-full-name-error" : undefined}
            />
            {fieldErrors.fullName && <p id="profile-full-name-error" className="role-field__error">{fieldErrors.fullName}</p>}
          </div>

          <div className="role-field">
            <label htmlFor="profile-phone">Phone number</label>
            <input
              id="profile-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              value={values.phone}
              onChange={(event) => setField("phone", event.target.value)}
              aria-invalid={Boolean(fieldErrors.phone)}
              aria-describedby={fieldErrors.phone ? "profile-phone-error" : undefined}
            />
            {fieldErrors.phone && <p id="profile-phone-error" className="role-field__error">{fieldErrors.phone}</p>}
          </div>

          <div className="role-field">
            <label htmlFor="profile-personal-email">Personal email</label>
            <input
              id="profile-personal-email"
              name="personalEmail"
              type="email"
              autoComplete="email"
              value={values.personalEmail}
              onChange={(event) => setField("personalEmail", event.target.value)}
              aria-invalid={Boolean(fieldErrors.personalEmail)}
              aria-describedby={fieldErrors.personalEmail ? "profile-personal-email-error" : undefined}
            />
            {fieldErrors.personalEmail && <p id="profile-personal-email-error" className="role-field__error">{fieldErrors.personalEmail}</p>}
          </div>

          <button className="role-button role-button--primary" type="submit" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save profile"}
          </button>
          <p className="role-status" role="status" aria-live="polite">
            {isSaving ? "Saving your profile. Please wait." : successMessage ?? ""}
          </p>
        </form>
      </section>
    </main>
  );
}

function focusNamedControl(form: HTMLFormElement | null, field: ProfileField): void {
  const control = form?.elements.namedItem(field);
  if (control instanceof HTMLElement) control.focus();
}

function isProfileField(field: string | undefined): field is ProfileField {
  return field === "fullName" || field === "phone" || field === "personalEmail";
}

function getProfileLoadErrorMessage(error: unknown): string {
  if (isServiceError(error) && error.code === "network_error") {
    return "We could not reach the service. Check your connection and try again.";
  }
  return "We could not load your profile. Please try again.";
}

function getProfileSaveErrorMessage(error: unknown): string {
  if (isServiceError(error)) {
    if (error.code === "conflict") return error.message;
    if (error.code === "network_error") {
      return "We could not reach the service. Check your connection and try again.";
    }
    if (error.code === "validation_error") return error.message;
  }
  return "We could not update your profile. Please try again.";
}
