import type { AuthUser, JoinCode, JoinCodeStatus } from "../../auth/contracts";
import type { TemplateRecord, TemplateWriteInput } from "../contracts";
import {
  createMockSeedData,
  type MockAuthorizationCodeRecord,
  type MockCompanyRecord,
  type MockSeedData,
  type MockSessionRecord,
  type MockUserRecord,
} from "./fixtures";

export type MockClock = () => Date;
export type MockIdGenerator = (kind: "user" | "session" | "join-code" | "template") => string;
export type MockCodeGenerator = () => string;

export interface MockDataStoreOptions {
  seedData?: MockSeedData;
  clock?: MockClock;
  idGenerator?: MockIdGenerator;
  codeGenerator?: MockCodeGenerator;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MockDataStore {
  readonly clock: MockClock;
  readonly idGenerator: MockIdGenerator;
  readonly codeGenerator: MockCodeGenerator;

  private readonly companies: MockCompanyRecord[];
  private readonly users: MockUserRecord[];
  private readonly codes: MockAuthorizationCodeRecord[];
  private readonly sessions: MockSessionRecord[];
  private readonly templates: TemplateRecord[];

  constructor(options: MockDataStoreOptions = {}) {
    const seed = clone(options.seedData ?? createMockSeedData());
    this.companies = seed.companies;
    this.users = seed.users;
    this.codes = seed.codes;
    this.sessions = seed.sessions;
    this.templates = seed.templates;
    this.clock = options.clock ?? (() => new Date());
    let sequence = 0;
    this.idGenerator =
      options.idGenerator ??
      ((kind) => {
        sequence += 1;
        return `mock-${kind}-${sequence}`;
      });
    this.codeGenerator =
      options.codeGenerator ??
      (() => `DEMO-JOIN-${this.idGenerator("join-code").toUpperCase()}`);
  }

  nowIso(): string {
    return this.clock().toISOString();
  }

  findCompanyById(id: string): MockCompanyRecord | undefined {
    const company = this.companies.find((candidate) => candidate.id === id);
    return company ? clone(company) : undefined;
  }

  findCompanyByName(name: string): MockCompanyRecord | undefined {
    const normalized = name.trim().toLowerCase();
    const company = this.companies.find(
      (candidate) => candidate.name.toLowerCase() === normalized,
    );
    return company ? clone(company) : undefined;
  }

  findUserById(id: string): MockUserRecord | undefined {
    const user = this.users.find((candidate) => candidate.id === id);
    return user ? clone(user) : undefined;
  }

  findUserByEmail(email: string): MockUserRecord | undefined {
    const normalized = email.trim().toLowerCase();
    const user = this.users.find(
      (candidate) =>
        candidate.companyEmail.toLowerCase() === normalized ||
        candidate.personalEmail.toLowerCase() === normalized,
    );
    return user ? clone(user) : undefined;
  }

  isEmailInUse(email: string, exceptUserId?: string): boolean {
    const normalized = email.trim().toLowerCase();
    return this.users.some(
      (user) =>
        user.id !== exceptUserId &&
        (user.companyEmail.toLowerCase() === normalized ||
          user.personalEmail.toLowerCase() === normalized),
    );
  }

  addUser(user: Omit<MockUserRecord, "id">): MockUserRecord {
    const record: MockUserRecord = {
      ...clone(user),
      id: this.idGenerator("user"),
    };
    this.users.push(record);
    return clone(record);
  }

  updateUser(
    id: string,
    update: Partial<Pick<MockUserRecord, "fullName" | "phone" | "personalEmail" | "isActive">>,
  ): MockUserRecord | undefined {
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user) return undefined;
    Object.assign(user, clone(update));
    return clone(user);
  }

  listWorkersForAdmin(adminId: string): MockUserRecord[] {
    return this.users
      .filter((user) => user.managerId === adminId)
      .map((user) => clone(user));
  }

  findCode(rawCode: string, kind: MockAuthorizationCodeRecord["kind"]): MockAuthorizationCodeRecord | undefined {
    const normalized = rawCode.trim().toUpperCase();
    const code = this.codes.find(
      (candidate) =>
        candidate.kind === kind && candidate.rawCode.toUpperCase() === normalized,
    );
    return code ? clone(code) : undefined;
  }

  findCodeById(id: string): MockAuthorizationCodeRecord | undefined {
    const code = this.codes.find((candidate) => candidate.id === id);
    return code ? clone(code) : undefined;
  }

  getCodeStatus(code: MockAuthorizationCodeRecord): JoinCodeStatus {
    if (code.status !== "active") return code.status;
    return new Date(code.expiresAt).getTime() <= this.clock().getTime()
      ? "expired"
      : "active";
  }

  markCodeUsed(id: string): void {
    const code = this.codes.find((candidate) => candidate.id === id);
    if (code) code.status = "used";
  }

  listJoinCodesForAdmin(adminId: string): JoinCode[] {
    return this.codes
      .filter(
        (code) =>
          code.kind === "worker_join" && code.createdByAdminId === adminId,
      )
      .map((code) => this.toJoinCode(code));
  }

  createJoinCode(
    admin: MockUserRecord,
    expiresAt: string,
  ): { record: JoinCode; rawCode: string } {
    const rawCode = this.codeGenerator();
    const code: MockAuthorizationCodeRecord = {
      id: this.idGenerator("join-code"),
      rawCode,
      kind: "worker_join",
      companyId: admin.companyId,
      createdByAdminId: admin.id,
      createdAt: this.nowIso(),
      expiresAt,
      status: "active",
    };
    this.codes.push(code);
    return { record: this.toJoinCode(code), rawCode };
  }

  revokeJoinCode(id: string, adminId: string): JoinCode | undefined {
    const code = this.codes.find(
      (candidate) =>
        candidate.id === id &&
        candidate.kind === "worker_join" &&
        candidate.createdByAdminId === adminId,
    );
    if (!code) return undefined;
    if (this.getCodeStatus(code) === "active") code.status = "revoked";
    return this.toJoinCode(code);
  }

  createSession(userId: string): MockSessionRecord {
    const expiresAt = new Date(this.clock().getTime() + 8 * 60 * 60 * 1000);
    const session: MockSessionRecord = {
      token: this.idGenerator("session"),
      userId,
      expiresAt: expiresAt.toISOString(),
    };
    this.sessions.push(session);
    return clone(session);
  }

  findSession(token: string): MockSessionRecord | undefined {
    const session = this.sessions.find((candidate) => candidate.token === token);
    return session ? clone(session) : undefined;
  }

  deleteSession(token: string): void {
    const index = this.sessions.findIndex((candidate) => candidate.token === token);
    if (index >= 0) this.sessions.splice(index, 1);
  }

  listTemplates(): TemplateRecord[] {
    return this.templates.map((template) => clone(template));
  }

  findTemplate(id: string): TemplateRecord | undefined {
    const template = this.templates.find((candidate) => candidate.id === id);
    return template ? clone(template) : undefined;
  }

  createTemplate(input: TemplateWriteInput): TemplateRecord {
    const now = this.nowIso();
    const record: TemplateRecord = {
      id: this.idGenerator("template"),
      name: input.name,
      schema: clone(input.schema),
      isSeed: false,
      createdAt: now,
      updatedAt: now,
    };
    this.templates.push(record);
    return clone(record);
  }

  updateTemplate(id: string, input: TemplateWriteInput): TemplateRecord | undefined {
    const template = this.templates.find((candidate) => candidate.id === id);
    if (!template) return undefined;
    template.name = input.name;
    template.schema = clone(input.schema);
    template.updatedAt = this.nowIso();
    return clone(template);
  }

  toAuthUser(user: MockUserRecord): AuthUser {
    const company = this.findCompanyById(user.companyId);
    if (!company) throw new Error(`Mock company ${user.companyId} is missing`);
    return {
      id: user.id,
      fullName: user.fullName,
      companyId: user.companyId,
      companyName: company.name,
      phone: user.phone,
      personalEmail: user.personalEmail,
      companyEmail: user.companyEmail,
      role: user.role,
      isActive: user.isActive,
    };
  }

  private toJoinCode(code: MockAuthorizationCodeRecord): JoinCode {
    const company = this.findCompanyById(code.companyId);
    if (!company || !code.createdByAdminId) {
      throw new Error(`Mock join code ${code.id} is incomplete`);
    }
    return {
      id: code.id,
      companyId: code.companyId,
      companyName: company.name,
      createdByAdminId: code.createdByAdminId,
      createdAt: code.createdAt,
      expiresAt: code.expiresAt,
      status: this.getCodeStatus(code),
    };
  }
}
