import { beforeEach, describe, expect, it } from "vitest";
import type { ServiceBundle } from "../contracts";
import { createMockServiceBundle } from "../createServices";
import { MemoryStorage } from "./MockSessionManager";
import { MOCK_FIXTURES } from "./fixtures";

describe("MockWorkerService", () => {
  let services: ServiceBundle;

  beforeEach(() => {
    services = createMockServiceBundle({
      storage: new MemoryStorage(),
      clock: () => new Date("2026-09-20T00:00:00.000Z"),
      codeGenerator: () => "DEMO-GENERATED-CODE",
    });
  });

  async function loginAcmeAdmin() {
    await services.auth.login({
      email: MOCK_FIXTURES.users.acmeAdmin.email,
      password: MOCK_FIXTURES.users.acmeAdmin.password,
    });
  }

  it("returns only workers directly linked to the signed-in admin", async () => {
    await loginAcmeAdmin();
    const workers = await services.workers.listWorkers();
    expect(workers.map((worker) => worker.id)).toEqual([
      MOCK_FIXTURES.users.acmeActiveWorker.id,
      MOCK_FIXTURES.users.acmeInactiveWorker.id,
    ]);
    expect(workers).not.toContainEqual(
      expect.objectContaining({ id: MOCK_FIXTURES.users.globexWorker.id }),
    );
  });

  it("updates owned workers but conceals workers owned by another admin", async () => {
    await loginAcmeAdmin();
    await expect(
      services.workers.updateWorkerStatus(
        MOCK_FIXTURES.users.acmeInactiveWorker.id,
        { isActive: true },
      ),
    ).resolves.toMatchObject({ isActive: true });
    await expect(
      services.workers.updateWorkerStatus(MOCK_FIXTURES.users.globexWorker.id, {
        isActive: false,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("generates, lists, and revokes only the admin's join codes", async () => {
    await loginAcmeAdmin();
    const generated = await services.workers.generateJoinCode();
    expect(generated).toMatchObject({
      code: "DEMO-GENERATED-CODE",
      companyId: MOCK_FIXTURES.companies.acme.id,
      status: "active",
    });

    const listed = await services.workers.listJoinCodes();
    expect(listed).toContainEqual(
      expect.objectContaining({ id: generated.id }),
    );
    expect(listed.every((code) => !("code" in code))).toBe(true);

    await expect(
      services.workers.revokeJoinCode(generated.id),
    ).resolves.toMatchObject({ status: "revoked" });
    await expect(
      services.workers.revokeJoinCode("code-join-globex"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("loads and updates a worker profile with read-only linkage intact", async () => {
    await services.auth.login({
      email: MOCK_FIXTURES.users.acmeActiveWorker.email,
      password: MOCK_FIXTURES.users.acmeActiveWorker.password,
    });
    await expect(services.workers.getCurrentProfile()).resolves.toMatchObject({
      linkedAdmin: { id: MOCK_FIXTURES.users.acmeAdmin.id },
    });
    await expect(
      services.workers.updateCurrentProfile({
        fullName: "Updated Worker",
        phone: "+65 8999 0000",
        personalEmail: "updated.worker@example.test",
      }),
    ).resolves.toMatchObject({
      fullName: "Updated Worker",
      companyId: MOCK_FIXTURES.companies.acme.id,
      linkedAdmin: { id: MOCK_FIXTURES.users.acmeAdmin.id },
    });
    await expect(services.workers.listWorkers()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
