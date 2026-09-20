import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { ROUTES } from "../../config/routes";
import type { ServiceBundle } from "../../services/contracts";
import { createMockServiceBundle } from "../../services/createServices";
import { ServiceError } from "../../services/errors";
import { createMockSeedData, MOCK_FIXTURES } from "../../services/mock/fixtures";
import { MemoryStorage } from "../../services/mock/MockSessionManager";

describe("WorkerManagementPage", () => {
  let services: ServiceBundle;

  beforeEach(async () => {
    services = createMockServiceBundle({
      storage: new MemoryStorage(),
      clock: () => new Date("2026-09-20T00:00:00.000Z"),
      codeGenerator: () => "DEMO-GENERATED-CODE",
    });
    await services.auth.login({
      email: MOCK_FIXTURES.users.acmeAdmin.email,
      password: MOCK_FIXTURES.users.acmeAdmin.password,
    });
  });

  function renderWorkers() {
    return render(
      <MemoryRouter initialEntries={[ROUTES.workers]}>
        <App services={services} />
      </MemoryRouter>,
    );
  }

  it("renders only directly linked workers and updates their active state", async () => {
    const user = userEvent.setup();
    renderWorkers();

    expect(await screen.findByRole("heading", { name: "Workers" }))
      .toBeInTheDocument();
    expect(screen.getByText("Taylor Technician")).toBeInTheDocument();
    expect(screen.getByText("Indigo Inactive")).toBeInTheDocument();
    expect(screen.queryByText("Morgan Technician")).not.toBeInTheDocument();
    expect(screen.queryByText("worker@globex.example.test"))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Activate Indigo Inactive" }));
    expect(await screen.findByText("Indigo Inactive is now active."))
      .toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Deactivate Indigo Inactive" }))
      .toBeInTheDocument();
  });

  it("generates a transient code, adds metadata, and removes the raw code on revocation", async () => {
    const user = userEvent.setup();
    renderWorkers();
    await screen.findByRole("heading", { name: "Worker join codes" });

    await user.click(screen.getByRole("button", { name: "Generate join code" }));
    expect(await screen.findByText("DEMO-GENERATED-CODE")).toBeInTheDocument();
    const generatedPanel = screen.getByRole("heading", { name: "New join code" }).parentElement!;
    expect(within(generatedPanel).getByText("Acme Facilities")).toBeInTheDocument();
    expect(within(generatedPanel).getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/shown only in this page session/i)).toBeInTheDocument();

    const revokeButtons = screen.getAllByRole("button", { name: /Revoke join code/ });
    await user.click(revokeButtons[0]);
    expect(await screen.findByText("Join code revoked.")).toHaveAttribute("role", "status");
    expect(screen.queryByText("DEMO-GENERATED-CODE")).not.toBeInTheDocument();
    expect(screen.getAllByText("Revoked").length).toBeGreaterThan(0);
  });

  it("renders explicit empty states without manufacturing unscoped data", async () => {
    const seedData = createMockSeedData();
    seedData.users = seedData.users.filter(
      (user) => user.managerId !== MOCK_FIXTURES.users.acmeAdmin.id,
    );
    seedData.codes = seedData.codes.filter(
      (code) => code.createdByAdminId !== MOCK_FIXTURES.users.acmeAdmin.id,
    );
    services = createMockServiceBundle({
      storage: new MemoryStorage(),
      seedData,
      clock: () => new Date("2026-09-20T00:00:00.000Z"),
    });
    await services.auth.login({
      email: MOCK_FIXTURES.users.acmeAdmin.email,
      password: MOCK_FIXTURES.users.acmeAdmin.password,
    });

    renderWorkers();
    expect(await screen.findByText("No workers are linked to your account yet."))
      .toBeInTheDocument();
    expect(screen.getByText("No join codes have been issued."))
      .toBeInTheDocument();
  });

  it("announces and focuses worker action failures", async () => {
    vi.spyOn(services.workers, "updateWorkerStatus").mockRejectedValueOnce(
      new ServiceError({
        code: "network_error",
        message: "Network unavailable.",
      }),
    );
    const user = userEvent.setup();
    renderWorkers();
    await screen.findByText("Taylor Technician");

    await user.click(
      screen.getByRole("button", { name: "Deactivate Taylor Technician" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We could not reach the service");
    expect(alert).toHaveFocus();
  });

  it("clears the session and returns to Login when management loading expires", async () => {
    vi.spyOn(services.workers, "listWorkers").mockRejectedValueOnce(
      new ServiceError({
        code: "session_expired",
        message: "Session expired.",
        status: 401,
      }),
    );
    renderWorkers();

    expect(await screen.findByRole("heading", { name: "Login" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Taylor Technician")).not.toBeInTheDocument();
  });
});
