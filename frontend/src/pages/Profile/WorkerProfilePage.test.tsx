import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { CurrentProfile } from "../../auth/contracts";
import { ROUTES } from "../../config/routes";
import type { ServiceBundle } from "../../services/contracts";
import { createMockServiceBundle } from "../../services/createServices";
import { ServiceError } from "../../services/errors";
import { MOCK_FIXTURES } from "../../services/mock/fixtures";
import { MemoryStorage } from "../../services/mock/MockSessionManager";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("WorkerProfilePage", () => {
  let services: ServiceBundle;

  beforeEach(async () => {
    services = createMockServiceBundle({
      storage: new MemoryStorage(),
      clock: () => new Date("2026-09-20T00:00:00.000Z"),
    });
    await services.auth.login({
      email: MOCK_FIXTURES.users.acmeActiveWorker.email,
      password: MOCK_FIXTURES.users.acmeActiveWorker.password,
    });
  });

  function renderProfile() {
    return render(
      <MemoryRouter initialEntries={[ROUTES.profile]}>
        <App services={services} />
      </MemoryRouter>,
    );
  }

  it("loads editable contact fields and renders account linkage as read-only values", async () => {
    renderProfile();

    expect(await screen.findByRole("heading", { name: "My Profile" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Taylor Technician");
    expect(screen.getByLabelText("Phone number")).toHaveValue("+65 8000 2001");
    expect(screen.getByLabelText("Personal email")).toHaveValue("taylor@example.test");
    expect(screen.getByText("Acme Facilities")).toBeInTheDocument();
    expect(screen.getByText("worker@acme.example.test")).toBeInTheDocument();
    expect(screen.getByText("Worker (technician)")).toBeInTheDocument();
    expect(screen.getByText(/Avery Admin/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Company" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Company email" }))
      .not.toBeInTheDocument();
  });

  it("validates, focuses the first invalid field, and saves normalized contact details", async () => {
    const user = userEvent.setup();
    renderProfile();
    const fullName = await screen.findByLabelText("Full name");

    await user.clear(fullName);
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(fullName).toHaveFocus();
    expect(screen.getByText("Enter your full name.")).toHaveAttribute(
      "id",
      "profile-full-name-error",
    );

    await user.type(fullName, "Updated Worker");
    const phone = screen.getByLabelText("Phone number");
    await user.clear(phone);
    await user.type(phone, "+65 8999 0000");
    const email = screen.getByLabelText("Personal email");
    await user.clear(email);
    await user.type(email, "  UPDATED.Worker@Example.TEST  ");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("Profile updated successfully."))
      .toHaveAttribute("role", "status");
    expect(fullName).toHaveValue("Updated Worker");
    expect(email).toHaveValue("updated.worker@example.test");
    await expect(services.workers.getCurrentProfile()).resolves.toMatchObject({
      fullName: "Updated Worker",
      phone: "+65 8999 0000",
      personalEmail: "updated.worker@example.test",
    });
  });

  it("announces service field errors and blocks duplicate pending saves", async () => {
    const current = await services.workers.getCurrentProfile();
    const pending = deferred<CurrentProfile>();
    const update = vi.spyOn(services.workers, "updateCurrentProfile")
      .mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderProfile();

    await screen.findByLabelText("Full name");
    const saveButton = screen.getByRole("button", { name: "Save profile" });
    await user.click(saveButton);
    expect(saveButton).toBeDisabled();
    fireEvent.submit(saveButton.closest("form")!);
    expect(update).toHaveBeenCalledOnce();

    await act(async () => pending.resolve(current));
    expect(await screen.findByText("Profile updated successfully."))
      .toBeInTheDocument();

    update.mockRejectedValueOnce(new ServiceError({
      code: "conflict",
      message: "That personal email address is already in use.",
      field: "personalEmail",
      status: 409,
    }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That personal email address is already in use.");
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText("Personal email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("clears the session and returns to Login when profile loading expires", async () => {
    vi.spyOn(services.workers, "getCurrentProfile").mockRejectedValueOnce(
      new ServiceError({
        code: "session_expired",
        message: "Session expired.",
        status: 401,
      }),
    );
    renderProfile();

    expect(await screen.findByRole("heading", { name: "Login" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Profile" }))
      .not.toBeInTheDocument();
  });
});
