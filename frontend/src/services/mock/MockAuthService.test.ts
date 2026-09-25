import { describe, expect, it } from "vitest";
import { USER_ROLES } from "../../auth/contracts";
import type { RegistrationInput } from "../../auth/contracts";
import { createMockServiceBundle } from "../createServices";
import {
  MemoryStorage,
  MOCK_SESSION_STORAGE_KEY,
} from "./MockSessionManager";
import { MOCK_FIXTURES } from "./fixtures";

const clock = () => new Date("2026-09-20T00:00:00.000Z");

function createHarness() {
  const storage = new MemoryStorage();
  return {
    storage,
    services: createMockServiceBundle({ storage, clock }),
  };
}

function workerRegistration(
  joinCode: string,
  suffix = "new-worker",
  company = MOCK_FIXTURES.companies.acme.name,
): RegistrationInput {
  return {
    role: USER_ROLES.worker,
    fullName: "New Worker",
    company,
    phone: "+65 8111 2222",
    personalEmail: `${suffix}.personal@example.test`,
    companyEmail: `${suffix}@acme.example.test`,
    password: "new-worker-password",
    joinCode,
  };
}

function adminRegistration(
  companyAdminCode: string,
  suffix = "new-admin",
): RegistrationInput {
  return {
    role: USER_ROLES.admin,
    fullName: "New Admin",
    company: MOCK_FIXTURES.companies.acme.name,
    phone: "+65 8222 3333",
    personalEmail: `${suffix}.personal@example.test`,
    companyEmail: `${suffix}@acme.example.test`,
    password: "new-admin-password",
    companyAdminCode,
  };
}

describe("MockAuthService", () => {
  it("logs in both account roles using normalized email", async () => {
    const { services } = createHarness();
    const admin = await services.auth.login({
      email: `  ${MOCK_FIXTURES.users.acmeAdmin.email.toUpperCase()}  `,
      password: MOCK_FIXTURES.users.acmeAdmin.password,
    });
    expect(admin.role).toBe(USER_ROLES.admin);

    const worker = await services.auth.login({
      email: MOCK_FIXTURES.users.acmeActiveWorker.email,
      password: MOCK_FIXTURES.users.acmeActiveWorker.password,
    });
    expect(worker.role).toBe(USER_ROLES.worker);
    await expect(services.auth.getCurrentUser()).resolves.toMatchObject({
      id: worker.id,
    });
  });

  it("returns a generic credential error and rejects inactive accounts", async () => {
    const { services } = createHarness();
    await expect(
      services.auth.login({ email: "missing@example.test", password: "wrong" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      services.auth.login({
        email: MOCK_FIXTURES.users.acmeInactiveWorker.email,
        password: MOCK_FIXTURES.users.acmeInactiveWorker.password,
      }),
    ).rejects.toMatchObject({ code: "inactive_account" });
  });

  it("restores and clears sessions and reports seeded expiry", async () => {
    const { services, storage } = createHarness();
    await expect(services.auth.getCurrentUser()).resolves.toBeNull();
    await services.auth.login({
      email: MOCK_FIXTURES.users.acmeAdmin.email,
      password: MOCK_FIXTURES.users.acmeAdmin.password,
    });
    await expect(services.auth.getCurrentUser()).resolves.toMatchObject({
      id: MOCK_FIXTURES.users.acmeAdmin.id,
    });
    await services.auth.logout();
    await expect(services.auth.getCurrentUser()).resolves.toBeNull();

    storage.setItem(
      MOCK_SESSION_STORAGE_KEY,
      MOCK_FIXTURES.sessions.expired,
    );
    await expect(services.auth.getCurrentUser()).rejects.toMatchObject({
      code: "session_expired",
    });
    expect(storage.getItem(MOCK_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("restores a seeded demo user after recreating the service bundle", async () => {
    const storage = new MemoryStorage();
    const firstBundle = createMockServiceBundle({ storage, clock });
    await firstBundle.auth.login({
      email: MOCK_FIXTURES.users.acmeAdmin.email,
      password: MOCK_FIXTURES.users.acmeAdmin.password,
    });

    const refreshedBundle = createMockServiceBundle({ storage, clock });
    await expect(refreshedBundle.auth.getCurrentUser()).resolves.toMatchObject({
      id: MOCK_FIXTURES.users.acmeAdmin.id,
    });
  });

  it("registers workers and admins from the code-derived role and company", async () => {
    const workerHarness = createHarness();
    const worker = await workerHarness.services.auth.register(
      workerRegistration(MOCK_FIXTURES.codes.validJoin),
    );
    expect(worker).toMatchObject({
      role: USER_ROLES.worker,
      companyId: MOCK_FIXTURES.companies.acme.id,
      companyName: MOCK_FIXTURES.companies.acme.name,
    });
    await expect(
      workerHarness.services.workers.getCurrentProfile(),
    ).resolves.toMatchObject({
      linkedAdmin: { id: MOCK_FIXTURES.users.acmeAdmin.id },
    });

    const adminHarness = createHarness();
    const admin = await adminHarness.services.auth.register(
      adminRegistration(MOCK_FIXTURES.codes.acmeAdmin),
    );
    expect(admin).toMatchObject({
      role: USER_ROLES.admin,
      companyId: MOCK_FIXTURES.companies.acme.id,
    });
  });

  it.each([
    ["unknown", "NOT-A-CODE", "invalid_code"],
    ["expired", MOCK_FIXTURES.codes.expiredJoin, "expired_code"],
    ["revoked", MOCK_FIXTURES.codes.revokedJoin, "revoked_code"],
    ["used", MOCK_FIXTURES.codes.usedJoin, "used_code"],
  ])("rejects a %s join code", async (_label, code, expectedCode) => {
    const { services } = createHarness();
    await expect(
      services.auth.register(workerRegistration(code)),
    ).rejects.toMatchObject({ code: expectedCode });
  });

  it("rejects invalid admin codes, company mismatches, and duplicate emails", async () => {
    const invalidHarness = createHarness();
    await expect(
      invalidHarness.services.auth.register(adminRegistration("BAD-ADMIN-CODE")),
    ).rejects.toMatchObject({ code: "invalid_code" });

    const mismatchHarness = createHarness();
    await expect(
      mismatchHarness.services.auth.register(
        workerRegistration(MOCK_FIXTURES.codes.otherCompanyJoin),
      ),
    ).rejects.toMatchObject({ code: "company_mismatch" });

    const duplicateHarness = createHarness();
    const duplicate = workerRegistration(MOCK_FIXTURES.codes.validJoin);
    duplicate.personalEmail = MOCK_FIXTURES.users.acmeActiveWorker.email;
    await expect(
      duplicateHarness.services.auth.register(duplicate),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("allows only one near-simultaneous redemption of a single-use code", async () => {
    const { services } = createHarness();
    const results = await Promise.allSettled([
      services.auth.register(
        workerRegistration(MOCK_FIXTURES.codes.validJoin, "concurrent-one"),
      ),
      services.auth.register(
        workerRegistration(MOCK_FIXTURES.codes.validJoin, "concurrent-two"),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "used_code" });
  });
});
