import { USER_ROLES } from "../../auth/contracts";
import type {
  AuthUser,
  LoginInput,
  RegistrationInput,
} from "../../auth/contracts";
import type { AuthService } from "../contracts";
import { ServiceError } from "../errors";
import { MockDataStore } from "./MockDataStore";
import { MockSessionManager } from "./MockSessionManager";
import type { MockAuthorizationCodeRecord } from "./fixtures";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export class MockAuthService implements AuthService {
  constructor(
    private readonly store: MockDataStore,
    private readonly sessions: MockSessionManager,
  ) {}

  async login(input: LoginInput): Promise<AuthUser> {
    const user = this.store.findUserByEmail(normalizeEmail(input.email));
    if (!user || user.password !== input.password) {
      throw new ServiceError({
        code: "invalid_credentials",
        message: "Email or password is incorrect.",
        status: 401,
      });
    }
    if (!user.isActive) {
      throw new ServiceError({
        code: "inactive_account",
        message: "This account is inactive. Contact your administrator.",
        status: 403,
      });
    }

    this.sessions.start(user.id);
    return this.store.toAuthUser(user);
  }

  async register(input: RegistrationInput): Promise<AuthUser> {
    const personalEmail = normalizeEmail(input.personalEmail);
    const companyEmail = normalizeEmail(input.companyEmail);
    if (
      this.store.isEmailInUse(personalEmail) ||
      this.store.isEmailInUse(companyEmail)
    ) {
      throw new ServiceError({
        code: "conflict",
        message: "An account already uses one of these email addresses.",
        field: "email",
        status: 409,
      });
    }

    const kind =
      input.role === USER_ROLES.admin ? "company_admin" : "worker_join";
    const rawCode =
      input.role === USER_ROLES.admin
        ? input.companyAdminCode
        : input.joinCode;
    const code = this.store.findCode(rawCode, kind);
    if (!code) {
      throw new ServiceError({
        code: "invalid_code",
        message: "The supplied authorization code is invalid.",
        field: kind === "company_admin" ? "companyAdminCode" : "joinCode",
        status: 422,
      });
    }
    this.assertRedeemable(code);

    const company = this.store.findCompanyById(code.companyId);
    if (
      !company ||
      company.name.trim().toLowerCase() !== input.company.trim().toLowerCase()
    ) {
      throw new ServiceError({
        code: "company_mismatch",
        message: "The authorization code does not belong to that company.",
        field: "company",
        status: 422,
      });
    }

    const role =
      code.kind === "company_admin" ? USER_ROLES.admin : USER_ROLES.worker;
    const managerId = role === USER_ROLES.worker ? code.createdByAdminId : null;
    if (role === USER_ROLES.worker && !managerId) {
      throw new ServiceError({
        code: "invalid_code",
        message: "The supplied join code is invalid.",
        field: "joinCode",
        status: 422,
      });
    }

    // Redemption and account creation happen synchronously before this async
    // method yields, so two callers cannot both consume a single-use code.
    this.store.markCodeUsed(code.id);
    const user = this.store.addUser({
      fullName: input.fullName.trim(),
      companyId: company.id,
      phone: input.phone.trim(),
      personalEmail,
      companyEmail,
      password: input.password,
      role,
      isActive: true,
      managerId,
    });
    this.sessions.start(user.id);
    return this.store.toAuthUser(user);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const user = this.sessions.currentUser();
    return user ? this.store.toAuthUser(user) : null;
  }

  async logout(): Promise<void> {
    this.sessions.clear();
  }

  private assertRedeemable(code: MockAuthorizationCodeRecord): void {
    const status = this.store.getCodeStatus(code);
    if (status === "active") return;

    const messages = {
      expired: "The authorization code has expired.",
      revoked: "The authorization code has been revoked.",
      used: "The authorization code has already been used.",
    } as const;
    throw new ServiceError({
      code: `${status}_code`,
      message: messages[status],
      field: code.kind === "company_admin" ? "companyAdminCode" : "joinCode",
      status: 422,
    });
  }
}
