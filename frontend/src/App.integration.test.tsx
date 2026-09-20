import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { ROUTES } from "./config/routes";
import type { ServiceBundle } from "./services/contracts";
import { createMockServiceBundle } from "./services/createServices";
import { MOCK_FIXTURES } from "./services/mock/fixtures";
import { MemoryStorage } from "./services/mock/MockSessionManager";

describe("Stage A mock integration", () => {
  let services: ServiceBundle;

  beforeEach(() => {
    services = createMockServiceBundle({
      storage: new MemoryStorage(),
      clock: () => new Date("2026-09-20T00:00:00.000Z"),
    });
  });

  function renderApp(path: string = ROUTES.login) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <App services={services} />
      </MemoryRouter>,
    );
  }

  async function fillCommonRegistration(
    user: ReturnType<typeof userEvent.setup>,
    emailPrefix: string,
  ) {
    await user.type(screen.getByLabelText("Full name"), "New Account User");
    await user.type(screen.getByLabelText("Company"), "Acme Facilities");
    await user.type(screen.getByLabelText("Phone number"), "+65 8777 1234");
    await user.type(
      screen.getByLabelText("Personal email"),
      `${emailPrefix}.personal@example.test`,
    );
    await user.type(
      screen.getByLabelText("Company email"),
      `${emailPrefix}@acme.example.test`,
    );
    await user.type(screen.getByLabelText("Password"), "StrongPassword1");
    await user.type(screen.getByLabelText("Confirm password"), "StrongPassword1");
  }

  it("registers a Worker and lands in the authenticated Worker experience", async () => {
    const user = userEvent.setup();
    renderApp(ROUTES.register);
    await screen.findByRole("heading", { name: "Create account" });
    await fillCommonRegistration(user, "new.worker");
    await user.type(
      screen.getByLabelText("Join code"),
      MOCK_FIXTURES.codes.validJoin,
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByTestId("fixture-switcher")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "Application" });
    expect(within(navigation).getByRole("link", { name: "My Profile" }))
      .toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Templates" }))
      .not.toBeInTheDocument();
  });

  it("registers an Admin and lands on backend-free template management", async () => {
    const user = userEvent.setup();
    renderApp(ROUTES.register);
    await screen.findByRole("heading", { name: "Create account" });
    await user.click(screen.getByRole("radio", { name: /Admin/ }));
    await fillCommonRegistration(user, "new.admin");
    await user.type(
      screen.getByLabelText("Company admin code"),
      MOCK_FIXTURES.codes.acmeAdmin,
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Templates" }))
      .toBeInTheDocument();
    expect(await screen.findByText("Service Visit")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "Application" });
    expect(within(navigation).getByRole("link", { name: "Workers" }))
      .toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "My Profile" }))
      .not.toBeInTheDocument();
  });

  it("supports mock template list, open, update, create, and session restoration after Admin login", async () => {
    const user = userEvent.setup();
    const firstRender = renderApp();
    await user.type(
      await screen.findByLabelText("Email"),
      MOCK_FIXTURES.users.acmeAdmin.email,
    );
    await user.type(
      screen.getByLabelText("Password"),
      MOCK_FIXTURES.users.acmeAdmin.password,
    );
    await user.click(screen.getByRole("button", { name: "Login" }));

    const serviceVisitItem = (await screen.findByText("Service Visit")).closest("li");
    expect(serviceVisitItem).not.toBeNull();
    await user.click(within(serviceVisitItem!).getByRole("button", { name: "Open" }));
    const nameInput = await screen.findByLabelText("Template name");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Service Visit");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("save-status-saved")).toHaveTextContent("Saved");

    await user.click(screen.getByRole("link", { name: "Templates" }));
    expect(await screen.findByText("Updated Service Visit")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New template" }));
    const newNameInput = await screen.findByLabelText("Template name");
    await user.type(newNameInput, "New Demo Template");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("save-status-saved")).toHaveTextContent("Saved");
    await user.click(screen.getByRole("link", { name: "Templates" }));
    expect(await screen.findByText("New Demo Template")).toBeInTheDocument();

    firstRender.unmount();
    renderApp(ROUTES.workers);
    expect(await screen.findByRole("heading", { name: "Workers" }))
      .toBeInTheDocument();
  });
});
