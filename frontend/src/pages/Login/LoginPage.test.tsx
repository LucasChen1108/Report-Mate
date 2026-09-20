import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "../../App";
import { USER_ROLES } from "../../auth/contracts";
import type { AuthUser } from "../../auth/contracts";
import { ROUTES } from "../../config/routes";
import type { AuthService, ServiceBundle } from "../../services/contracts";
import { createMockServiceBundle } from "../../services/createServices";
import { ServiceError } from "../../services/errors";
import { MemoryStorage } from "../../services/mock/MockSessionManager";

const adminUser: AuthUser = {
  id: "admin-1",
  fullName: "Avery Admin",
  companyId: "company-acme",
  companyName: "Acme Facilities",
  phone: "+65 8000 1001",
  personalEmail: "avery@example.test",
  companyEmail: "admin@acme.example.test",
  role: USER_ROLES.admin,
  isActive: true,
};

const workerUser: AuthUser = {
  ...adminUser,
  id: "worker-1",
  fullName: "Taylor Technician",
  companyEmail: "worker@acme.example.test",
  role: USER_ROLES.worker,
};

function makeAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    login: vi.fn().mockResolvedValue(workerUser),
    register: vi.fn().mockResolvedValue(workerUser),
    getCurrentUser: vi.fn().mockResolvedValue(null),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function renderLogin(auth = makeAuthService()) {
  const base = createMockServiceBundle({ storage: new MemoryStorage() });
  const services: ServiceBundle = { ...base, auth };
  render(
    <MemoryRouter initialEntries={[ROUTES.login]}>
      <LocationProbe />
      <App services={services} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(auth.getCurrentUser).toHaveBeenCalledOnce());
  return auth;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe("LoginPage", () => {
  it("renders labeled controls and a registration link", async () => {
    await renderLogin();

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByRole("link", { name: "Create account" }))
      .toHaveAttribute("href", ROUTES.register);
  });

  it("focuses the first invalid field and announces validation errors", async () => {
    const user = userEvent.setup();
    await renderLogin();

    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("normalizes email and redirects an Admin from the returned user", async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(adminUser);
    const auth = await renderLogin(makeAuthService({ login }));

    await user.type(screen.getByLabelText("Email"), "  ADMIN@ACME.EXAMPLE.TEST ");
    await user.type(screen.getByLabelText("Password"), "demo-admin-password");
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(ROUTES.templates);
    });
    expect(auth.login).toHaveBeenCalledWith({
      email: "admin@acme.example.test",
      password: "demo-admin-password",
    });
  });

  it("redirects a Worker from the returned user", async () => {
    const user = userEvent.setup();
    await renderLogin(makeAuthService({
      login: vi.fn().mockResolvedValue(workerUser),
    }));

    await user.type(screen.getByLabelText("Email"), workerUser.companyEmail);
    await user.type(screen.getByLabelText("Password"), "worker-password");
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(screen.getByTestId("location"))
        .toHaveTextContent(ROUTES.generateReport);
    });
  });

  it("uses a generic invalid-credentials error and moves focus to it", async () => {
    const user = userEvent.setup();
    await renderLogin(makeAuthService({
      login: vi.fn().mockRejectedValue(new ServiceError({
        code: "invalid_credentials",
        message: "There is no account for that email.",
        status: 401,
      })),
    }));

    await user.type(screen.getByLabelText("Email"), "missing@example.test");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Login" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email or password is incorrect.");
    expect(alert).not.toHaveTextContent("no account");
    expect(alert).toHaveFocus();
  });

  it("disables repeated submission while login is pending", async () => {
    const user = userEvent.setup();
    let resolveLogin!: (user: AuthUser) => void;
    const login = vi.fn().mockReturnValue(new Promise<AuthUser>((resolve) => {
      resolveLogin = resolve;
    }));
    await renderLogin(makeAuthService({ login }));

    await user.type(screen.getByLabelText("Email"), workerUser.companyEmail);
    await user.type(screen.getByLabelText("Password"), "worker-password");
    const submit = screen.getByRole("button", { name: "Login" });
    await user.dblClick(submit);

    expect(login).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Signing in…" }))
      .toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Signing in. Please wait.",
    );

    await act(async () => resolveLogin(workerUser));
  });
});
