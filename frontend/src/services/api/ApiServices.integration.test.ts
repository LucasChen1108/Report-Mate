import { afterEach, describe, expect, it, vi } from "vitest";
import { USER_ROLES, type AuthUser } from "../../auth/contracts";
import { ApiAuthService } from "./ApiAuthService";
import { ApiTemplateService } from "./ApiTemplateService";
import { ApiWorkerService } from "./ApiWorkerService";

const admin: AuthUser = {
  id: "admin-1",
  fullName: "Admin User",
  companyId: "company-1",
  companyName: "Example Services",
  phone: "+65 6123 4567",
  personalEmail: "admin@example.test",
  companyEmail: "admin@example-services.test",
  role: USER_ROLES.admin,
  isActive: true,
};

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === undefined ? "" : JSON.stringify(body)),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API adapter journeys", () => {
  it("uses the backend's direct auth-user responses for login, restore, and logout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, admin))
      .mockResolvedValueOnce(jsonResponse(200, admin))
      .mockResolvedValueOnce(jsonResponse(204));
    vi.stubGlobal("fetch", fetchMock);
    const auth = new ApiAuthService("");

    await expect(auth.login({ email: admin.companyEmail, password: "Password123" }))
      .resolves.toEqual(admin);
    await expect(auth.getCurrentUser()).resolves.toEqual(admin);
    await expect(auth.logout()).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/auth/login",
      "/auth/me",
      "/auth/logout",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).credentials).toBe("include");
    }
  });

  it("matches profile and Admin Worker-management response contracts", async () => {
    const profile = { ...admin, linkedAdmin: null };
    const worker = {
      id: "worker-1",
      fullName: "Worker User",
      companyEmail: "worker@example-services.test",
      phone: "+65 6987 6543",
      isActive: true,
    };
    const generatedCode = {
      id: "code-1",
      companyId: admin.companyId,
      companyName: admin.companyName,
      createdByAdminId: admin.id,
      createdAt: "2026-09-25T00:00:00Z",
      expiresAt: "2026-10-02T00:00:00Z",
      status: "active",
      code: "WORKER-ONE-TIME",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, profile))
      .mockResolvedValueOnce(jsonResponse(200, [worker]))
      .mockResolvedValueOnce(jsonResponse(201, generatedCode));
    vi.stubGlobal("fetch", fetchMock);
    const workers = new ApiWorkerService("");

    await expect(workers.getCurrentProfile()).resolves.toEqual(profile);
    await expect(workers.listWorkers()).resolves.toEqual([worker]);
    await expect(workers.generateJoinCode()).resolves.toEqual(generatedCode);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/me",
      "/api/admin/workers",
      "/api/admin/join-codes",
    ]);
  });

  it("keeps template reads and writes on the same cookie transport", async () => {
    const summary = {
      id: "template-1",
      name: "Inspection",
      isSeed: false,
      updatedAt: "2026-09-25T00:00:00Z",
    };
    const record = {
      ...summary,
      createdAt: summary.updatedAt,
      schema: { version: 1 as const, sections: [] },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, [summary]))
      .mockResolvedValueOnce(jsonResponse(201, record));
    vi.stubGlobal("fetch", fetchMock);
    const templates = new ApiTemplateService();

    await expect(templates.list()).resolves.toEqual([summary]);
    await expect(templates.create({ name: record.name, schema: record.schema }))
      .resolves.toEqual(record);

    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).credentials).toBe("include");
      expect(new Headers((init as RequestInit).headers).has("Authorization")).toBe(false);
    }
  });
});
