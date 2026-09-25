export const USER_ROLES = {
  admin: "dispatcher_admin",
  worker: "technician",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
export type UserRoleLabel = "Admin" | "Worker";

export const USER_ROLE_LABELS = {
  [USER_ROLES.admin]: "Admin",
  [USER_ROLES.worker]: "Worker",
} as const satisfies Readonly<Record<UserRole, UserRoleLabel>>;

export function getUserRoleLabel(role: UserRole): UserRoleLabel {
  return USER_ROLE_LABELS[role];
}

export interface AuthUser {
  id: string;
  fullName: string;
  companyId: string;
  companyName: string;
  phone: string;
  personalEmail: string;
  companyEmail: string;
  role: UserRole;
  isActive: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

interface RegistrationInputBase {
  fullName: string;
  company: string;
  phone: string;
  personalEmail: string;
  companyEmail: string;
  password: string;
}

export interface AdminRegistrationInput extends RegistrationInputBase {
  role: typeof USER_ROLES.admin;
  companyAdminCode: string;
  joinCode?: never;
}

export interface WorkerRegistrationInput extends RegistrationInputBase {
  role: typeof USER_ROLES.worker;
  joinCode: string;
  companyAdminCode?: never;
}

export type RegistrationInput =
  | AdminRegistrationInput
  | WorkerRegistrationInput;

export interface LinkedAdmin {
  id: string;
  fullName: string;
  companyEmail: string;
}

export interface CurrentProfile extends AuthUser {
  linkedAdmin: LinkedAdmin | null;
}

export interface WorkerSummary {
  id: string;
  fullName: string;
  companyEmail: string;
  phone: string;
  isActive: boolean;
}

export interface WorkerDetail extends WorkerSummary {
  personalEmail: string;
  companyId: string;
  companyName: string;
  role: typeof USER_ROLES.worker;
  linkedAdmin: LinkedAdmin;
}

export type JoinCodeStatus = "active" | "expired" | "revoked" | "used";

export interface JoinCode {
  id: string;
  companyId: string;
  companyName: string;
  createdByAdminId: string;
  createdAt: string;
  expiresAt: string;
  status: JoinCodeStatus;
}

export interface GeneratedJoinCode extends JoinCode {
  code: string;
}

export interface WorkerStatusUpdate {
  isActive: boolean;
}

export type ServiceErrorCode =
  | "invalid_credentials"
  | "inactive_account"
  | "session_expired"
  | "invalid_code"
  | "expired_code"
  | "revoked_code"
  | "used_code"
  | "company_mismatch"
  | "conflict"
  | "validation_error"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "network_error"
  | "internal_error";

export interface ServiceErrorShape {
  code: ServiceErrorCode;
  message: string;
  field?: string;
  status?: number;
}
