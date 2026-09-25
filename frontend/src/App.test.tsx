import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { MemoryRouterProps } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { AuthUser } from "./auth/contracts";
import { ROUTES, routeBuilders } from "./config/routes";
import type { TemplateEditNavigationState } from "./routing/navigationState";
import type {
  AuthService,
  ServiceBundle,
  TemplateRecord,
  TemplateService,
} from "./services/contracts";
import { createMockServiceBundle } from "./services/createServices";
import { MOCK_FIXTURES } from "./services/mock/fixtures";
import { MemoryStorage } from "./services/mock/MockSessionManager";

const templateRecord: TemplateRecord = {
  id: "template-1",
  name: "Inspection Template",
  schema: {
    version: 1,
    sections: [
      {
        id: "section-1",
        label: "Inspection Details",
        fields: [],
      },
    ],
  },
  isSeed: false,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

type InitialEntries = NonNullable<MemoryRouterProps["initialEntries"]>;
type AccountRole = "admin" | "worker" | null;

let services: ServiceBundle;
let templateService: TemplateService;

async function renderApp(
  initialEntries: InitialEntries,
  accountRole: AccountRole = "admin",
) {
  if (accountRole) await loginAs(accountRole);

  const rendered = render(
    <MemoryRouter initialEntries={initialEntries}>
      <App services={services} />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

async function loginAs(role: Exclude<AccountRole, null>) {
  const fixture = role === "admin"
    ? MOCK_FIXTURES.users.acmeAdmin
    : MOCK_FIXTURES.users.acmeActiveWorker;
  await services.auth.login({
    email: fixture.email,
    password: fixture.password,
  });
}

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        Test back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        Test forward
      </button>
    </>
  );
}

beforeEach(() => {
  templateService = {
    get: vi.fn().mockResolvedValue(templateRecord),
    list: vi.fn().mockResolvedValue([
      {
        id: templateRecord.id,
        name: templateRecord.name,
        isSeed: templateRecord.isSeed,
        updatedAt: templateRecord.updatedAt,
      },
    ]),
    create: vi.fn().mockImplementation(async (input) => ({
      ...templateRecord,
      name: input.name,
      schema: input.schema,
    })),
    update: vi.fn().mockImplementation(async (_id, input) => ({
      ...templateRecord,
      name: input.name,
      schema: input.schema,
    })),
  };
  services = {
    ...createMockServiceBundle({ storage: new MemoryStorage() }),
    templates: templateService,
  };
});

describe("application routing", () => {
  it("routes the root to login when signed out", async () => {
    await renderApp([ROUTES.root], null);

    expect(
      await screen.findByRole("heading", { name: "Login" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["admin", "Templates"],
    ["worker", "Report fixture"],
  ] as const)("routes an authenticated %s home", async (role, landmark) => {
    await renderApp([ROUTES.root], role);

    if (role === "admin") {
      expect(
        await screen.findByRole("heading", { name: landmark }),
      ).toBeInTheDocument();
    } else {
      expect(await screen.findByTestId("fixture-switcher"))
        .toBeInTheDocument();
    }
  });

  it("renders a useful page for an unknown route", async () => {
    await renderApp(["/not-a-real-page"], null);

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" }))
      .toHaveAttribute("href", ROUTES.root);
  });

  it.each([
    [ROUTES.login, "Login"],
    [ROUTES.register, "Create account"],
  ])("renders the public authentication page at %s", async (path, heading) => {
    await renderApp([path], null);
    expect(
      await screen.findByRole("heading", { name: heading }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Application" }))
      .not.toBeInTheDocument();
  });

  it("mounts the ordinary Report Editor with its seed fixtures", async () => {
    await renderApp([ROUTES.generateReport]);

    expect(await screen.findByTestId("fixture-switcher")).toBeInTheDocument();
    expect(screen.queryByText(/Previewing:/)).not.toBeInTheDocument();
  });

  it("loads an edit route by URL parameter on direct navigation", async () => {
    await renderApp([routeBuilders.template(templateRecord.id)]);

    expect(await screen.findByDisplayValue(templateRecord.name))
      .toBeInTheDocument();
    expect(templateService.get).toHaveBeenCalledOnce();
    expect(templateService.get).toHaveBeenCalledWith(templateRecord.id);
  });

  it("uses a matching navigation-state record without loading it again", async () => {
    const state: TemplateEditNavigationState = { template: templateRecord };
    await renderApp([{
      pathname: routeBuilders.template(templateRecord.id),
      state,
    }]);

    expect(await screen.findByDisplayValue(templateRecord.name))
      .toBeInTheDocument();
    expect(templateService.get).not.toHaveBeenCalled();
  });

  it("opens a listed template and reuses the record already loaded by the list", async () => {
    const user = userEvent.setup();
    await renderApp([ROUTES.templates]);

    await user.click(await screen.findByRole("button", { name: "Open" }));

    expect(await screen.findByDisplayValue(templateRecord.name))
      .toBeInTheDocument();
    expect(templateService.get).toHaveBeenCalledOnce();
  });

  it("keeps new-template state separate from an edited template", async () => {
    const user = userEvent.setup();
    const state: TemplateEditNavigationState = { template: templateRecord };
    await renderApp([{
      pathname: routeBuilders.template(templateRecord.id),
      state,
    }]);

    const nameInput = await screen.findByLabelText("Template name");
    await user.clear(nameInput);
    await user.type(nameInput, "Unsaved edit");
    await user.click(screen.getByRole("link", { name: "Templates" }));
    await user.click(
      await screen.findByRole("button", { name: "New template" }),
    );

    expect(await screen.findByLabelText("Template name")).toHaveValue("");
  });

  it("previews the live builder draft without changing ordinary report visits", async () => {
    const user = userEvent.setup();
    await renderApp([ROUTES.newTemplate]);

    const nameInput = await screen.findByLabelText("Template name");
    await user.type(nameInput, "Live Draft");
    await user.click(
      screen.getByRole("button", {
        name: "Preview builder template in renderer →",
      }),
    );

    expect(screen.getByText("Previewing:")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Live Draft" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("fixture-switcher")).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Generate Report" }));
    expect(screen.getByTestId("fixture-switcher")).toBeInTheDocument();
  });

  it("supports browser-style back and forward navigation", async () => {
    const user = userEvent.setup();
    await loginAs("admin");
    render(
      <MemoryRouter initialEntries={[ROUTES.templates]}>
        <HistoryControls />
        <App services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Templates" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Generate Report" }));
    expect(screen.getByTestId("fixture-switcher")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Test back" }));
    expect(
      await screen.findByRole("heading", { name: "Templates" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Test forward" }));
    expect(screen.getByTestId("fixture-switcher")).toBeInTheDocument();
  });
});

describe("authentication and role guards", () => {
  const protectedRoutes = [
    ROUTES.generateReport,
    ROUTES.templates,
    ROUTES.newTemplate,
    routeBuilders.template(templateRecord.id),
    ROUTES.workers,
    ROUTES.profile,
  ];

  it.each(protectedRoutes)("redirects signed-out access to %s to login", async (path) => {
    await renderApp([path], null);

    expect(
      await screen.findByRole("heading", { name: "Login" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Application" }))
      .not.toBeInTheDocument();
  });

  it.each([
    ROUTES.templates,
    ROUTES.newTemplate,
    routeBuilders.template(templateRecord.id),
    ROUTES.workers,
  ])("redirects Worker access to %s to Generate Report", async (path) => {
    await renderApp([path], "worker");

    expect(await screen.findByTestId("fixture-switcher")).toBeInTheDocument();
    expect(templateService.get).not.toHaveBeenCalled();
    expect(templateService.list).not.toHaveBeenCalled();
  });

  it("allows a Worker to access the profile route", async () => {
    await renderApp([ROUTES.profile], "worker");

    expect(
      await screen.findByRole("heading", { name: "My Profile" }),
    ).toBeInTheDocument();
  });

  it("redirects an Admin away from the Worker profile", async () => {
    await renderApp([ROUTES.profile], "admin");

    expect(
      await screen.findByRole("heading", { name: "Templates" }),
    ).toBeInTheDocument();
  });

  it("allows an Admin to access Worker management", async () => {
    await renderApp([ROUTES.workers], "admin");

    expect(
      await screen.findByRole("heading", { name: "Workers" }),
    ).toBeInTheDocument();
  });

  it.each([ROUTES.login, ROUTES.register])(
    "redirects an authenticated Admin away from %s",
    async (path) => {
      await renderApp([path], "admin");

      expect(
        await screen.findByRole("heading", { name: "Templates" }),
      ).toBeInTheDocument();
    },
  );

  it("does not render or load protected content while restoration is pending", async () => {
    const adminUser = await services.auth.login({
      email: MOCK_FIXTURES.users.acmeAdmin.email,
      password: MOCK_FIXTURES.users.acmeAdmin.password,
    });
    await services.auth.logout();

    let resolveRestoration!: (user: AuthUser | null) => void;
    const restoration = new Promise<AuthUser | null>((resolve) => {
      resolveRestoration = resolve;
    });
    const pendingAuth: AuthService = {
      login: vi.fn(),
      register: vi.fn(),
      getCurrentUser: vi.fn(() => restoration),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    services = { ...services, auth: pendingAuth };

    render(
      <MemoryRouter initialEntries={[ROUTES.templates]}>
        <App services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("status"),
    ).toHaveTextContent("Checking your session…");
    expect(screen.queryByRole("heading", { name: "Templates" }))
      .not.toBeInTheDocument();
    expect(templateService.list).not.toHaveBeenCalled();

    await act(async () => resolveRestoration(adminUser));

    expect(
      await screen.findByRole("heading", { name: "Templates" }),
    ).toBeInTheDocument();
  });

  it("restores an authorized intended destination after login", async () => {
    const user = userEvent.setup();
    await renderApp([ROUTES.workers], null);

    await user.type(
      await screen.findByLabelText("Email"),
      MOCK_FIXTURES.users.acmeAdmin.email,
    );
    await user.type(
      screen.getByLabelText("Password"),
      MOCK_FIXTURES.users.acmeAdmin.password,
    );
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(
      await screen.findByRole("heading", { name: "Workers" }),
    ).toBeInTheDocument();
  });

  it("falls back to the role landing page for a forbidden intended destination", async () => {
    const user = userEvent.setup();
    await renderApp([ROUTES.templates], null);

    await user.type(
      await screen.findByLabelText("Email"),
      MOCK_FIXTURES.users.acmeActiveWorker.email,
    );
    await user.type(
      screen.getByLabelText("Password"),
      MOCK_FIXTURES.users.acmeActiveWorker.password,
    );
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(await screen.findByTestId("fixture-switcher")).toBeInTheDocument();
    expect(templateService.list).not.toHaveBeenCalled();
  });
});

describe("role-aware navigation", () => {
  it("shows exactly the Admin navigation actions", async () => {
    await renderApp([ROUTES.templates], "admin");

    const navigation = await screen.findByRole("navigation", {
      name: "Application",
    });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Generate Report", "My Reports", "Templates", "Workers"]);
    expect(within(navigation).getByRole("button", { name: "Logout" }))
      .toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "My Profile" }))
      .not.toBeInTheDocument();
  });

  it("shows exactly the Worker navigation actions", async () => {
    await renderApp([ROUTES.generateReport], "worker");

    const navigation = await screen.findByRole("navigation", {
      name: "Application",
    });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Generate Report", "My Reports", "My Profile"]);
    expect(within(navigation).getByRole("button", { name: "Logout" }))
      .toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Templates" }))
      .not.toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Workers" }))
      .not.toBeInTheDocument();
  });

  it("logs out and browser back cannot reveal protected content", async () => {
    const user = userEvent.setup();
    await loginAs("admin");
    render(
      <MemoryRouter
        initialEntries={[ROUTES.login, ROUTES.templates]}
        initialIndex={1}
      >
        <HistoryControls />
        <App services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Templates" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(
      await screen.findByRole("heading", { name: "Login" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Test back" }));
    expect(
      await screen.findByRole("heading", { name: "Login" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Templates" }))
      .not.toBeInTheDocument();
  });
});
