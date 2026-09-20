import { USER_ROLES } from "../../auth/contracts";
import type {
  CurrentProfile,
  GeneratedJoinCode,
  JoinCode,
  LinkedAdmin,
  WorkerDetail,
  WorkerStatusUpdate,
  WorkerSummary,
} from "../../auth/contracts";
import type {
  GenerateJoinCodeInput,
  ProfileUpdateInput,
  WorkerService,
} from "../contracts";
import { ServiceError } from "../errors";
import { MockDataStore } from "./MockDataStore";
import { MockSessionManager } from "./MockSessionManager";
import type { MockUserRecord } from "./fixtures";

export class MockWorkerService implements WorkerService {
  constructor(
    private readonly store: MockDataStore,
    private readonly sessions: MockSessionManager,
  ) {}

  async getCurrentProfile(): Promise<CurrentProfile> {
    return this.toCurrentProfile(this.sessions.requireCurrentUser());
  }

  async updateCurrentProfile(input: ProfileUpdateInput): Promise<CurrentProfile> {
    const current = this.sessions.requireCurrentUser();
    const personalEmail = input.personalEmail.trim().toLowerCase();
    if (this.store.isEmailInUse(personalEmail, current.id)) {
      throw new ServiceError({
        code: "conflict",
        message: "That personal email address is already in use.",
        field: "personalEmail",
        status: 409,
      });
    }
    const updated = this.store.updateUser(current.id, {
      fullName: input.fullName.trim(),
      phone: input.phone.trim(),
      personalEmail,
    });
    if (!updated) throw this.notFound("Profile not found.");
    return this.toCurrentProfile(updated);
  }

  async listWorkers(): Promise<WorkerSummary[]> {
    const admin = this.requireAdmin();
    return this.store.listWorkersForAdmin(admin.id).map((worker) => ({
      id: worker.id,
      fullName: worker.fullName,
      companyEmail: worker.companyEmail,
      phone: worker.phone,
      isActive: worker.isActive,
    }));
  }

  async updateWorkerStatus(
    workerId: string,
    input: WorkerStatusUpdate,
  ): Promise<WorkerDetail> {
    const admin = this.requireAdmin();
    const worker = this.store.findUserById(workerId);
    if (
      !worker ||
      worker.role !== USER_ROLES.worker ||
      worker.managerId !== admin.id
    ) {
      throw this.notFound("Worker not found.");
    }
    const updated = this.store.updateUser(worker.id, {
      isActive: input.isActive,
    });
    if (!updated) throw this.notFound("Worker not found.");
    return this.toWorkerDetail(updated, admin);
  }

  async generateJoinCode(
    input: GenerateJoinCodeInput = {},
  ): Promise<GeneratedJoinCode> {
    const admin = this.requireAdmin();
    const expiresAt = input.expiresAt
      ? new Date(input.expiresAt)
      : new Date(this.store.clock().getTime() + 7 * 24 * 60 * 60 * 1000);
    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= this.store.clock().getTime()
    ) {
      throw new ServiceError({
        code: "validation_error",
        message: "Join-code expiry must be in the future.",
        field: "expiresAt",
        status: 422,
      });
    }
    const created = this.store.createJoinCode(admin, expiresAt.toISOString());
    return { ...created.record, code: created.rawCode };
  }

  async listJoinCodes(): Promise<JoinCode[]> {
    const admin = this.requireAdmin();
    return this.store.listJoinCodesForAdmin(admin.id);
  }

  async revokeJoinCode(joinCodeId: string): Promise<JoinCode> {
    const admin = this.requireAdmin();
    const revoked = this.store.revokeJoinCode(joinCodeId, admin.id);
    if (!revoked) throw this.notFound("Join code not found.");
    return revoked;
  }

  private requireAdmin(): MockUserRecord {
    const user = this.sessions.requireCurrentUser();
    if (user.role !== USER_ROLES.admin) {
      throw new ServiceError({
        code: "forbidden",
        message: "Admin access is required.",
        status: 403,
      });
    }
    return user;
  }

  private toCurrentProfile(user: MockUserRecord): CurrentProfile {
    return {
      ...this.store.toAuthUser(user),
      linkedAdmin:
        user.role === USER_ROLES.worker && user.managerId
          ? this.toLinkedAdmin(user.managerId)
          : null,
    };
  }

  private toLinkedAdmin(adminId: string): LinkedAdmin {
    const admin = this.store.findUserById(adminId);
    if (!admin) throw new Error(`Mock admin ${adminId} is missing`);
    return {
      id: admin.id,
      fullName: admin.fullName,
      companyEmail: admin.companyEmail,
    };
  }

  private toWorkerDetail(
    worker: MockUserRecord,
    admin: MockUserRecord,
  ): WorkerDetail {
    const company = this.store.findCompanyById(worker.companyId);
    if (!company) throw new Error(`Mock company ${worker.companyId} is missing`);
    return {
      id: worker.id,
      fullName: worker.fullName,
      companyEmail: worker.companyEmail,
      phone: worker.phone,
      isActive: worker.isActive,
      personalEmail: worker.personalEmail,
      companyId: worker.companyId,
      companyName: company.name,
      role: USER_ROLES.worker,
      linkedAdmin: {
        id: admin.id,
        fullName: admin.fullName,
        companyEmail: admin.companyEmail,
      },
    };
  }

  private notFound(message: string): ServiceError {
    return new ServiceError({ code: "not_found", message, status: 404 });
  }
}
