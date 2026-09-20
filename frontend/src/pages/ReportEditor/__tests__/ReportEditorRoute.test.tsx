// Tests for the route that turns a URL into a loaded report.
//
// The case that earned this file: React StrictMode double-invokes effects in
// development, and /reports/new CREATES A ROW. The first version of this route
// guarded with an "already started" flag, which both looked right and hung the
// page on "Loading report…" forever — the second effect run bailed out early
// while the first run's cleanup had already marked its result cancelled. Caught
// in a browser, pinned here.
//
// Both halves matter and pull against each other: exactly ONE draft must be
// created, AND the page must still render.

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportRecord } from "../../../api/reportTypes";
import type { TemplateSchema } from "../../../api/types";
import { ReportEditorRoute } from "../../../routes/ReportEditorRoute";

const { createReportMock, getReportMock, getTemplateMock } = vi.hoisted(() => ({
  createReportMock: vi.fn(),
  getReportMock: vi.fn(),
  getTemplateMock: vi.fn(),
}));

vi.mock("../../../api/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/reports")>();
  return { ...actual, createReport: createReportMock, getReport: getReportMock };
});
vi.mock("../../../api/templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/templates")>();
  return { ...actual, getTemplate: getTemplateMock };
});

const schema: TemplateSchema = {
  version: 1,
  sections: [
    {
      id: "sec_a",
      label: "Visit",
      fields: [{ id: "fld_notes", type: "text", label: "Notes", required: false }],
    },
  ],
};

const record: ReportRecord = {
  id: "rep_1",
  templateId: "tpl_1",
  templateRevision: 1,
  schemaSnapshot: schema,
  jobId: null,
  technicianId: null,
  title: "Report",
  customerName: "",
  content: { values: {}, parts: [], filledBy: "manual" },
  status: "draft",
  filledBy: "manual",
  submittedAt: null,
  exportedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
  createReportMock.mockReset().mockResolvedValue(record);
  getReportMock.mockReset().mockResolvedValue(record);
  getTemplateMock.mockReset().mockResolvedValue({
    id: "tpl_1",
    name: "HVAC Service Visit",
    schema,
    isSeed: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Every location the router visited, oldest first. */
const visited: string[] = [];

function LocationRecorder() {
  const location = useLocation();
  visited.push(location.pathname + location.search);
  return null;
}

/** Mount the route at `path` inside StrictMode, the way the real app runs it. */
async function renderRoute(path: string) {
  visited.length = 0;
  await act(async () => {
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <LocationRecorder />
          <Routes>
            <Route path="/reports/new" element={<ReportEditorRoute />} />
            <Route path="/reports/:reportId" element={<ReportEditorRoute />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
  });
  await act(async () => {});
}

const byTestId = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("/reports/new?templateId=", () => {
  it("creates exactly ONE draft under StrictMode, and still renders", async () => {
    await renderRoute("/reports/new?templateId=tpl_1");

    expect(createReportMock).toHaveBeenCalledTimes(1);
    expect(createReportMock).toHaveBeenCalledWith({ templateId: "tpl_1" });
    // The half that the "already started" guard broke.
    expect(container.textContent).not.toContain("Loading report…");
    expect(byTestId("a4-document")).toBeTruthy();
    expect(byTestId("field-fld_notes")).toBeTruthy();
  });

  it("fetches the template for its name, before creating a draft against it", async () => {
    await renderRoute("/reports/new?templateId=tpl_1");

    expect(getTemplateMock).toHaveBeenCalledWith("tpl_1");
    expect(getTemplateMock.mock.invocationCallOrder[0]).toBeLessThan(
      createReportMock.mock.invocationCallOrder[0],
    );
    expect(container.textContent).toContain("HVAC Service Visit");
  });

  it("does not create a draft when the template lookup fails", async () => {
    getTemplateMock.mockRejectedValue(new Error("template not found"));

    await renderRoute("/reports/new?templateId=nope");

    expect(createReportMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Could not open this report");
    expect(container.textContent).toContain("template not found");
  });

  // The URL must stop saying "new" as soon as the draft exists. When it did
  // not, a reload ran the create path again: the technician got a blank form
  // and a SECOND orphan draft row, while the one they had filled in sat on
  // the server with nothing pointing at it. On a phone in the field, a reload
  // is not an unusual thing to do.
  it("replaces /reports/new with /reports/<id> once the draft exists", async () => {
    await renderRoute("/reports/new?templateId=tpl_1");

    expect(visited[0]).toBe("/reports/new?templateId=tpl_1");
    expect(visited.at(-1)).toBe("/reports/rep_1");
  });

  it("does not re-fetch the report it just created when the URL changes", async () => {
    await renderRoute("/reports/new?templateId=tpl_1");

    // The route lands on /reports/:reportId, which normally loads by id — but
    // it is already holding that record, so a GET here would be a wasted
    // round trip and a visible "Loading report…" flash over a filled form.
    expect(getReportMock).not.toHaveBeenCalled();
    expect(createReportMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Loading report…");
    expect(byTestId("a4-document")).toBeTruthy();
  });

  it("asks for a template rather than creating a draft with no id", async () => {
    await renderRoute("/reports/new");

    expect(createReportMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No template chosen");
  });
});

describe("/reports/:reportId", () => {
  it("loads the saved report once and renders its snapshot", async () => {
    await renderRoute("/reports/rep_1");

    expect(getReportMock).toHaveBeenCalledTimes(1);
    expect(getReportMock).toHaveBeenCalledWith("rep_1");
    expect(createReportMock).not.toHaveBeenCalled();
    expect(byTestId("a4-document")).toBeTruthy();
  });

  it("surfaces a load failure instead of an empty form", async () => {
    getReportMock.mockRejectedValue(new Error("report not found"));

    await renderRoute("/reports/rep_gone");

    expect(container.textContent).toContain("Could not open this report");
    expect(byTestId("a4-document")).toBeNull();
  });
});

describe("?fixture= dev escape hatch", () => {
  it("renders the bundled fixture with no API call at all", async () => {
    await renderRoute("/reports/new?fixture=hvac");

    expect(getTemplateMock).not.toHaveBeenCalled();
    expect(createReportMock).not.toHaveBeenCalled();
    expect(getReportMock).not.toHaveBeenCalled();
    expect(byTestId("fixture-switcher")).toBeTruthy();
    expect(container.textContent).toContain("HVAC Service Visit");
  });
});
