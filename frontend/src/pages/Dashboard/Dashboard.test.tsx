// Dashboard.test.tsx — behavioural checks for the two dashboard screens.
//
// WHY THESE FIVE: the dashboard backend answered 501 while this screen was
// built (backend/internal/dashboard/handler.go registers stubs), so the things
// most likely to be wrong are the ones nobody could click through against real
// data — column order, URL round-tripping, and the ?highlight= landing. Each
// test below pins one of those.
//
// The API client is mocked rather than the network: api/dashboard.ts is the
// single seam (it is the only module in this folder that calls fetch), so
// mocking it exercises every line of the hook, both pages and all three
// presentational components.
//
// No @testing-library here on purpose — it is not a dependency of this project
// and adding one would touch package.json, which this task does not own.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type {
  DashboardTemplateRollup,
  ReportTableView,
} from "../../api/reportTypes";

vi.mock("../../api/dashboard", async () => {
  // The hook catches ApiError/ApiAuthorizationError by identity, so the real
  // classes must come through the mock unchanged.
  const actual = await vi.importActual<typeof import("../../api/dashboard")>(
    "../../api/dashboard",
  );
  return {
    ...actual,
    listDashboardTemplates: vi.fn(),
    getTemplateReportTable: vi.fn(),
    exportTemplateReportsCsv: vi.fn(),
    exportReportDocument: vi.fn(),
  };
});

import * as dashboardApi from "../../api/dashboard";
import { DashboardPage } from "./DashboardPage";
import { TemplateReportsPage } from "./TemplateReportsPage";

const ROLLUPS: DashboardTemplateRollup[] = [
  {
    templateId: "tpl_hvac",
    name: "HVAC Service Report",
    isSeed: true,
    revision: 4,
    reportCount: 12,
    draftCount: 2,
    submittedCount: 7,
    exportedCount: 3,
    lastReportAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    templateId: "tpl_empty",
    name: "Emergency Callout",
    isSeed: false,
    revision: 1,
    reportCount: 0,
    draftCount: 0,
    submittedCount: 0,
    exportedCount: 0,
    lastReportAt: null,
  },
];

const VIEW: ReportTableView = {
  template: { id: "tpl_hvac", name: "HVAC Service Report", revision: 4 },
  columns: [
    { fieldId: "f_unit", label: "Unit ID", type: "text", sectionLabel: "Site" },
    { fieldId: "f_temp", label: "Supply temp", type: "number", sectionLabel: "Readings" },
    { fieldId: "f_checks", label: "Safety checks", type: "checklist", sectionLabel: "Readings" },
    { fieldId: "f_sig", label: "Signature", type: "signature", sectionLabel: "Sign-off" },
  ],
  rows: [
    {
      reportId: "rpt_1",
      createdAt: "2026-09-18T09:00:00Z",
      status: "submitted",
      templateRevision: 4,
      customerName: "Northwind Logistics",
      cells: {
        f_unit: "AHU-101",
        f_temp: "14",
        f_checks: "Gloves, Hard hat",
        f_sig: "Signed",
      },
      staleRevision: false,
    },
    {
      reportId: "rpt_2",
      createdAt: "2026-09-12T09:00:00Z",
      status: "draft",
      templateRevision: 3,
      customerName: "Kestrel Foods",
      // f_sig absent: added after revision 3, so legitimately blank.
      cells: { f_unit: "AHU-102", f_temp: "18", f_checks: "Gloves" },
      staleRevision: true,
    },
  ],
  total: 2,
  limit: 25,
  offset: 0,
};

let container: HTMLDivElement;
let root: Root;
let currentSearch = "";

function LocationProbe() {
  currentSearch = useLocation().search;
  return null;
}

async function render(ui: React.ReactNode, initialPath: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes>
          <Route path="/dashboard" element={ui} />
          <Route path="/dashboard/templates/:templateId" element={ui} />
        </Routes>
      </MemoryRouter>,
    );
  });
  // Let the fetch promises settle and React flush the resulting state.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const all = (testId: string) =>
  Array.from(container.querySelectorAll(`[data-testid="${testId}"]`));
const one = (testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`);

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  currentSearch = "";

  // jsdom implements neither of these; both are used by the highlight path.
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;

  vi.mocked(dashboardApi.listDashboardTemplates).mockResolvedValue(ROLLUPS);
  vi.mocked(dashboardApi.getTemplateReportTable).mockResolvedValue(VIEW);
  vi.mocked(dashboardApi.exportTemplateReportsCsv).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("DashboardPage", () => {
  it("renders a card per template, including the zero-report one", async () => {
    await render(<DashboardPage />, "/dashboard");

    const cards = all("template-card");
    expect(cards).toHaveLength(2);
    expect(cards[1].textContent).toContain("Emergency Callout");
    // The zero-report card leads with the way to start one...
    expect(cards[1].querySelector('[data-testid="new-report-link"]')?.textContent).toBe(
      "Start a report",
    );
    // ...and still links into its (empty) table.
    expect(
      cards[1].querySelector('[data-testid="view-reports-link"]')?.getAttribute("href"),
    ).toBe("/dashboard/templates/tpl_empty");
    expect(
      cards[0].querySelector('[data-testid="view-reports-link"]')?.getAttribute("href"),
    ).toBe("/dashboard/templates/tpl_hvac");
    // Summary tiles: 12 reports, 2 drafts, 1 template in use (not 2).
    expect(all("summary-tile").map((tile) => tile.textContent)).toEqual([
      "Reports12",
      "Drafts2",
      "Templates in use1",
    ]);
  });

  it("renders a deliberate error state with a retry, not a blank screen", async () => {
    vi.mocked(dashboardApi.listDashboardTemplates).mockRejectedValue(
      new dashboardApi.ApiError(501, "Not Implemented"),
    );
    await render(<DashboardPage />, "/dashboard");

    const empty = one("empty-state");
    expect(empty?.textContent).toContain("could not load your dashboard");
    expect(empty?.textContent).toContain("501");
  });
});

describe("TemplateReportsPage", () => {
  it("renders one column per schema field, in order, with the right values", async () => {
    await render(<TemplateReportsPage />, "/dashboard/templates/tpl_hvac");

    const headerRows = Array.from(
      container.querySelectorAll('[data-testid="report-table"] thead tr'),
    );
    // Row 1: leading columns + one spanning header per section + actions.
    expect(
      Array.from(headerRows[0].querySelectorAll("th")).map((th) => th.textContent?.trim()),
    ).toEqual(["Date", "Status", "Customer", "Site", "Readings", "Sign-off", "Actions"]);
    expect(headerRows[0].querySelectorAll('th[scope="colgroup"]')).toHaveLength(3);
    // Row 2: the field columns, in the order the backend gave them.
    expect(
      Array.from(headerRows[1].querySelectorAll("th")).map((th) => th.textContent),
    ).toEqual(["Unit ID", "Supply temp", "Safety checks", "Signature"]);

    const rows = all("report-row");
    expect(rows).toHaveLength(2);
    // tds are [Status, Customer, ...fields, Actions]; the date is a <th scope="row">.
    const cells = Array.from(rows[0].querySelectorAll("td")).map((td) => td.textContent);
    expect(cells.slice(2, 6)).toEqual([
      "AHU-101",
      "14",
      "Gloves, Hard hat",
      "Signed",
    ]);

    // The stale row is flagged and its missing cell explained, not hidden.
    expect(rows[1].querySelector('[data-testid="stale-badge"]')?.textContent).toBe("Rev 3");
    const staleCells = Array.from(rows[1].querySelectorAll("td")).map((td) => td.textContent);
    expect(staleCells[5]).toBe("—");
    expect(
      rows[1].querySelectorAll("td")[5].querySelector("span")?.getAttribute("title"),
    ).toContain("revision 3");
  });

  it("writes filter changes into the URL and refetches with them", async () => {
    await render(<TemplateReportsPage />, "/dashboard/templates/tpl_hvac");

    const select = one("filter-status") as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )!.set!;
      setter.call(select, "draft");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(currentSearch).toBe("?status=draft");
    expect(vi.mocked(dashboardApi.getTemplateReportTable).mock.lastCall).toEqual([
      "tpl_hvac",
      { status: "draft", from: "", to: "", q: "", limit: 25, offset: 0 },
    ]);
  });

  it("restores the same filtered view from a URL (refresh / shared link)", async () => {
    await render(
      <TemplateReportsPage />,
      "/dashboard/templates/tpl_hvac?status=draft&q=kestrel&from=2026-09-01",
    );

    expect((one("filter-status") as HTMLSelectElement).value).toBe("draft");
    expect((one("filter-search") as HTMLInputElement).value).toBe("kestrel");
    expect((one("filter-from") as HTMLInputElement).value).toBe("2026-09-01");
    expect(vi.mocked(dashboardApi.getTemplateReportTable).mock.lastCall?.[1]).toEqual({
      status: "draft",
      from: "2026-09-01",
      to: "",
      q: "kestrel",
      limit: 25,
      offset: 0,
    });
  });

  it("scrolls to and flashes the ?highlight= row", async () => {
    await render(
      <TemplateReportsPage />,
      "/dashboard/templates/tpl_hvac?highlight=rpt_2",
    );

    const rows = all("report-row");
    expect(rows[1].className).toBe("rm-row-flash");
    expect(rows[0].className).toBe("");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      // inline:"nearest" is what keeps the horizontal scroller from jumping.
      expect.objectContaining({ block: "center", inline: "nearest" }),
    );
  });

  it("exports the CSV through the client with the active filters", async () => {
    await render(<TemplateReportsPage />, "/dashboard/templates/tpl_hvac?status=draft");

    await act(async () => {
      (one("export-csv-button") as HTMLButtonElement).click();
    });

    expect(dashboardApi.exportTemplateReportsCsv).toHaveBeenCalledWith(
      "tpl_hvac",
      { status: "draft", from: "", to: "", q: "" },
      "HVAC Service Report",
    );
  });

  it("distinguishes 'no reports yet' from 'no reports match your filters'", async () => {
    vi.mocked(dashboardApi.getTemplateReportTable).mockResolvedValue({
      ...VIEW,
      rows: [],
      total: 0,
    });

    await render(<TemplateReportsPage />, "/dashboard/templates/tpl_hvac");
    expect(one("empty-state")?.textContent).toContain("No reports yet");

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(<TemplateReportsPage />, "/dashboard/templates/tpl_hvac?q=zzz");
    expect(one("empty-state")?.textContent).toContain("No reports match these filters");
  });
});
