import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { MemoryRouterProps } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { routeBuilders, ROUTES } from "./config/routes";
import type { TemplateEditNavigationState } from "./routing/navigationState";
import type {
  ServiceBundle,
  TemplateRecord,
  TemplateService,
} from "./services/contracts";
import { createMockServiceBundle } from "./services/createServices";
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

let services: ServiceBundle;
let templateService: TemplateService;

async function renderApp(initialEntries: InitialEntries) {
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
  it("redirects the root route to the template list", async () => {
    await renderApp([ROUTES.root]);

    expect(
      await screen.findByRole("heading", { name: "Templates" }),
    ).toBeInTheDocument();
  });

  it("renders a useful page for an unknown route", async () => {
    await renderApp(["/not-a-real-page"]);

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to templates" }),
    ).toHaveAttribute("href", ROUTES.templates);
  });

  it.each([
    [ROUTES.login, "Login"],
    [ROUTES.register, "Create account"],
    [ROUTES.workers, "Workers"],
    [ROUTES.profile, "My Profile"],
  ])("renders the explicit placeholder at %s", async (path, heading) => {
    await renderApp([path]);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText(/implemented in a later Stage A commit/i))
      .toBeInTheDocument();
  });

  it("mounts the ordinary Report Editor with its seed fixtures", async () => {
    await renderApp([ROUTES.generateReport]);

    expect(screen.getByTestId("fixture-switcher")).toBeInTheDocument();
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
