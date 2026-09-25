import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "../../App";
import { USER_ROLES } from "../../auth/contracts";
import type { AuthUser, ServiceErrorCode } from "../../auth/contracts";
import { ROUTES } from "../../config/routes";
import type { AuthService, ServiceBundle } from "../../services/contracts";
import { createMockServiceBundle } from "../../services/createServices";
import { ServiceError } from "../../services/errors";
import { MemoryStorage } from "../../services/mock/MockSessionManager";

const adminUser: AuthUser = {
  id: "admin-new",
  fullName: "Avery Admin",
  companyId: "company-acme",
  companyName: "Acme Facilities",
  phone: "+65 8000 5001",
  personalEmail: "avery.new@example.test",
  companyEmail: "avery.new@acme.example.test",
  role: USER_ROLES.admin,
  isActive: true,
};

const workerUser: AuthUser = {
  ...adminUser,
  id: "worker-new",
  fullName: "Taylor Technician",
  companyEmail: "taylor.new@acme.example.test",
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

async function renderRegistration(auth = makeAuthService()) {
  const base = createMockServiceBundle({ storage: new MemoryStorage() });
  const services: ServiceBundle = { ...base, auth };
  render(
    <MemoryRouter initialEntries={[ROUTES.register]}>
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

async function fillRegistration(
  user: ReturnType<typeof userEvent.setup>,
  role: "Worker" | "Admin" = "Worker",
) {
  if (role === "Admin") {
    await user.click(screen.getByRole("radio", { name: /Admin/ }));
  }
  await user.type(screen.getByLabelText("Full name"), "  New Person  ");
  await user.type(screen.getByLabelText("Company"), "  Acme Facilities  ");
  await user.type(screen.getByLabelText("Phone number"), "  +65 8000 5001  ");
  await user.type(
    screen.getByLabelText("Personal email"),
    "  PERSON@EXAMPLE.TEST  ",
  );
  await user.type(
    screen.getByLabelText("Company email"),
    "  PERSON@ACME.EXAMPLE.TEST  ",
  );
  await user.type(screen.getByLabelText("Password"), "StrongPassword1");
  await user.type(
    screen.getByLabelText("Confirm password"),
    "StrongPassword1",
  );
  await user.type(
    screen.getByLabelText(
      role === "Admin" ? "Company admin code" : "Join code",
    ),
    role === "Admin" ? "  ADMIN-ACME-VALID  " : "  JOIN-ACME-VALID  ",
  );
}

describe("RegistrationPage", () => {
  it("defaults to Worker and shows only the join code", async () => {
    await renderRegistration();

    expect(screen.getByRole("radio", { name: /Worker/ })).toBeChecked();
    expect(screen.getByLabelText("Join code")).toBeInTheDocument();
    expect(screen.queryByLabelText("Company admin code"))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Login" }))
      .toHaveAttribute("href", ROUTES.login);
  });

  it("clears each hidden code when switching roles", async () => {
    const user = userEvent.setup();
    await renderRegistration();

    await user.type(screen.getByLabelText("Join code"), "WORKER-CODE");
    await user.click(screen.getByRole("radio", { name: /Admin/ }));
    await user.type(screen.getByLabelText("Company admin code"), "ADMIN-CODE");
    await user.click(screen.getByRole("radio", { name: /Worker/ }));
    expect(screen.getByLabelText("Join code")).toHaveValue("");

    await user.click(screen.getByRole("radio", { name: /Admin/ }));
    expect(screen.getByLabelText("Company admin code")).toHaveValue("");
  });

  it("focuses the first invalid field and exposes field relationships", async () => {
    const user = userEvent.setup();
    await renderRegistration();

    await user.click(screen.getByRole("button", { name: "Create account" }));

    const fullName = screen.getByLabelText("Full name");
    expect(fullName).toHaveFocus();
    expect(fullName).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter your full name.")).toBeInTheDocument();
    expect(screen.getByText("Enter the join code from your administrator."))
      .toBeInTheDocument();
  });

  it("submits a normalized Worker payload without Admin-only or form-only fields", async () => {
    const user = userEvent.setup();
    const register = vi.fn().mockResolvedValue(workerUser);
    const auth = await renderRegistration(makeAuthService({ register }));
    await fillRegistration(user);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByTestId("location"))
        .toHaveTextContent(ROUTES.generateReport);
    });
    expect(auth.register).toHaveBeenCalledWith({
      fullName: "New Person",
      company: "Acme Facilities",
      phone: "+65 8000 5001",
      personalEmail: "person@example.test",
      companyEmail: "person@acme.example.test",
      password: "StrongPassword1",
      role: USER_ROLES.worker,
      joinCode: "JOIN-ACME-VALID",
    });
    const submitted = vi.mocked(auth.register).mock.calls[0][0];
    expect(submitted).not.toHaveProperty("companyAdminCode");
    expect(submitted).not.toHaveProperty("passwordConfirmation");
  });

  it("submits only the Admin code and redirects from the returned Admin", async () => {
    const user = userEvent.setup();
    const register = vi.fn().mockResolvedValue(adminUser);
    const auth = await renderRegistration(makeAuthService({ register }));
    await fillRegistration(user, "Admin");

    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(ROUTES.templates);
    });
    expect(auth.register).toHaveBeenCalledWith(expect.objectContaining({
      role: USER_ROLES.admin,
      companyAdminCode: "ADMIN-ACME-VALID",
    }));
    expect(vi.mocked(auth.register).mock.calls[0][0])
      .not.toHaveProperty("joinCode");
  });

  it.each<[
    label: string,
    code: ServiceErrorCode,
    expected: RegExp,
  ]>([
    ["invalid", "invalid_code", /code is invalid/i],
    ["expired", "expired_code", /code has expired/i],
    ["revoked", "revoked_code", /code was revoked/i],
    ["used", "used_code", /already been used/i],
    ["company-mismatched", "company_mismatch", /does not match that company/i],
  ])("announces an actionable %s-code failure", async (_label, code, expected) => {
    const user = userEvent.setup();
    const field = code === "company_mismatch" ? "company" : "joinCode";
    await renderRegistration(makeAuthService({
      register: vi.fn().mockRejectedValue(new ServiceError({
        code,
        message: "Unsafe adapter detail",
        field,
        status: 422,
      })),
    }));
    await fillRegistration(user);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(expected);
    expect(alert).not.toHaveTextContent("Unsafe adapter detail");
    expect(alert).toHaveFocus();
  });

  it("disables repeated submission while registration is pending", async () => {
    const user = userEvent.setup();
    let resolveRegistration!: (user: AuthUser) => void;
    const register = vi.fn().mockReturnValue(new Promise<AuthUser>((resolve) => {
      resolveRegistration = resolve;
    }));
    await renderRegistration(makeAuthService({ register }));
    await fillRegistration(user);

    const submit = screen.getByRole("button", { name: "Create account" });
    await user.dblClick(submit);

    expect(register).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Creating account…" }))
      .toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Creating your account. Please wait.",
    );

    await act(async () => resolveRegistration(workerUser));
  });
});
