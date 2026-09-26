// Tests for the renderer's save surface: what is sent, what is blocked, and in
// what ORDER the export flow does its four steps.
//
// The reports backend was still the 501 stub when this was written, so the API
// client is mocked here at the module boundary — which is also the right level
// to test at: these assert the CONTRACT the page holds the client to (that a
// blocked export makes no call at all, that print precedes navigation), and
// those hold whatever the server does.
//
// No @testing-library in this project, so rendering is react-dom/client + act
// directly, and elements are found by the data-testid attributes the page and
// controls already carry.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportRecord } from "../../../api/reportTypes";
import type { TemplateSchema } from "../../../api/types";
import { ReportEditorPage } from "../ReportEditorPage";

// --- The mocked report client ----------------------------------------------
// The error classes are kept real (the page does `instanceof` checks on them).
const { saveReportMock, saveAndExportMock } = vi.hoisted(() => ({
  saveReportMock: vi.fn(),
  saveAndExportMock: vi.fn(),
}));

vi.mock("../../../api/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/reports")>();
  return { ...actual, saveReport: saveReportMock, saveAndExportReport: saveAndExportMock };
});

import { ApiValidationError } from "../../../api/reports";

// --- Fixtures ---------------------------------------------------------------
const schema: TemplateSchema = {
  version: 1,
  sections: [
    {
      id: "sec_visit",
      label: "Visit",
      fields: [
        { id: "fld_notes", type: "text", label: "Arrival notes", required: false },
        { id: "fld_meter", type: "number", label: "Meter reading", required: true },
      ],
    },
    {
      id: "sec_signoff",
      label: "Sign-off",
      fields: [
        { id: "fld_sig", type: "signature", label: "Customer sign-off", required: true },
      ],
    },
  ],
};

function makeReport(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    id: "rep_1",
    templateId: "tpl_9",
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
    ...overrides,
  };
}

/** A filled-in report: every required field has a value. */
function filledReport(): ReportRecord {
  return makeReport({
    customerName: "Acme Ltd",
    content: {
      values: { fld_meter: "42.6", fld_sig: "data:image/png;base64,sig" },
      parts: [],
      filledBy: "manual",
    },
  });
}

// --- Harness ----------------------------------------------------------------
let container: HTMLDivElement;
let root: Root;
/** Ordered log of the side effects whose sequence is the thing under test. */
let events: string[];

// Records every navigation the router performs, so the export test can assert
// that the navigation happened AFTER the print.
function LocationProbe() {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  if (events[events.length - 1] !== `nav:${path}`) events.push(`nav:${path}`);
  return null;
}

function render(ui: React.ReactNode) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/reports/rep_1"]}>
        <LocationProbe />
        <Routes>
          <Route path="*" element={<>{ui}</>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const byTestId = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function click(id: string) {
  const el = byTestId(id);
  if (!el) throw new Error(`no element with data-testid="${id}"`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Let queued promise callbacks run. */
const flush = () => act(async () => {});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  events = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });

  saveReportMock.mockReset().mockResolvedValue(makeReport());
  saveAndExportMock
    .mockReset()
    .mockResolvedValue({ report: makeReport(), exportUrl: "/api/reports/rep_1/export" });

  // Stand in for the print dialog: Chrome/Firefox fire `afterprint` before
  // print() returns, which is the signal the page waits on before navigating.
  vi.stubGlobal(
    "print",
    vi.fn(() => {
      events.push("print");
      window.dispatchEvent(new Event("afterprint"));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// --- Tests ------------------------------------------------------------------

describe("rendering a loaded report", () => {
  it("renders every section and field from the report's schema snapshot", () => {
    render(<ReportEditorPage report={makeReport()} templateName="HVAC Service Visit" />);

    expect(byTestId("section-sec_visit")).toBeTruthy();
    expect(byTestId("section-sec_signoff")).toBeTruthy();
    expect(byTestId("field-fld_notes")).toBeTruthy();
    expect(byTestId("field-fld_meter")).toBeTruthy();
    expect(byTestId("field-fld_sig")).toBeTruthy();
    expect(container.textContent).toContain("HVAC Service Visit");
    // The Parts Used table hangs off the report, not the schema.
    expect(byTestId("parts-used-section")).toBeTruthy();
  });

  it("seeds the customer input from the record and sends what is typed", async () => {
    render(<ReportEditorPage report={makeReport({ customerName: "Acme Ltd" })} />);
    const input = byTestId("report-customer-name") as HTMLInputElement;
    expect(input.value).toBe("Acme Ltd");

    await click("save-draft-button");
    expect(saveReportMock).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ customerName: "Acme Ltd" }),
    );
  });
});

describe("Save draft", () => {
  it("saves a report with required fields still empty, and shows when", async () => {
    render(<ReportEditorPage report={makeReport()} />);

    await click("save-draft-button");

    expect(saveReportMock).toHaveBeenCalledTimes(1);
    const [id, payload] = saveReportMock.mock.calls[0];
    expect(id).toBe("rep_1");
    // Every schema field is present in the payload, shaped per its type.
    expect(payload.content.values).toEqual({
      fld_notes: "",
      fld_meter: "",
      fld_sig: null,
    });
    expect(byTestId("report-save-status")?.textContent).toMatch(/Draft saved at/);
  });

  it("surfaces a failed save instead of failing silently", async () => {
    saveReportMock.mockRejectedValue(new Error("network down"));
    render(<ReportEditorPage report={makeReport()} />);

    await click("save-draft-button");

    expect(byTestId("report-save-error")?.textContent).toContain("network down");
    // The buttons are usable again — a failed save must be retryable.
    expect((byTestId("save-draft-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables both buttons while a save is in flight", async () => {
    let release!: (r: ReportRecord) => void;
    saveReportMock.mockReturnValue(new Promise<ReportRecord>((r) => (release = r)));
    render(<ReportEditorPage report={makeReport()} />);

    await click("save-draft-button");
    expect((byTestId("save-draft-button") as HTMLButtonElement).disabled).toBe(true);
    expect((byTestId("save-and-export-button") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      release(makeReport());
    });
    expect((byTestId("save-draft-button") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Save and Export", () => {
  it("is blocked client-side by an empty required field, with NO network call", async () => {
    render(<ReportEditorPage report={makeReport()} />);

    await click("save-and-export-button");

    expect(saveAndExportMock).not.toHaveBeenCalled();
    expect(saveReportMock).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();

    // The first missing required field (document order) is highlighted.
    expect(byTestId("field-fld_meter")?.dataset.highlighted).toBe("true");
    expect(byTestId("field-fld_sig")?.dataset.highlighted).toBeUndefined();

    const error = byTestId("report-save-error")?.textContent ?? "";
    expect(error).toContain("Meter reading");
    expect(error).toContain("2 required fields");
    // No navigation happened.
    expect(events.filter((e) => e.startsWith("nav:"))).toEqual(["nav:/reports/rep_1"]);
  });

  it("clears the highlight once the offending field is edited", async () => {
    render(<ReportEditorPage report={makeReport()} />);
    await click("save-and-export-button");
    expect(byTestId("field-fld_meter")?.dataset.highlighted).toBe("true");

    const input = byTestId("number-fld_meter") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "42.6");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(byTestId("field-fld_meter")?.dataset.highlighted).toBeUndefined();
    expect(byTestId("report-save-error")).toBeNull();
  });

  it("persists, prints, and THEN navigates to the template dashboard", async () => {
    render(<ReportEditorPage report={filledReport()} />);

    await click("save-and-export-button");
    await flush();

    expect(saveAndExportMock).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ customerName: "Acme Ltd" }),
    );

    // The ordering that matters: navigating before the print dialog resolves
    // would unmount the document out from under the preview.
    const printIndex = events.indexOf("print");
    const navIndex = events.indexOf("nav:/dashboard/templates/tpl_9?highlight=rep_1");
    expect(printIndex).toBeGreaterThanOrEqual(0);
    expect(navIndex).toBeGreaterThan(printIndex);
  });

  it("does not print or navigate when the save itself fails", async () => {
    saveAndExportMock.mockRejectedValue(new Error("server exploded"));
    render(<ReportEditorPage report={filledReport()} />);

    await click("save-and-export-button");
    await flush();

    expect(window.print).not.toHaveBeenCalled();
    expect(events.filter((e) => e.startsWith("nav:"))).toEqual(["nav:/reports/rep_1"]);
    expect(byTestId("report-save-error")?.textContent).toContain("server exploded");
  });

  it("highlights the field the server names in a 422", async () => {
    saveAndExportMock.mockRejectedValue(
      new ApiValidationError({
        code: "validation_error",
        message: "Customer sign-off is required",
        elementId: "fld_sig",
      }),
    );
    render(<ReportEditorPage report={filledReport()} />);

    await click("save-and-export-button");
    await flush();

    expect(byTestId("field-fld_sig")?.dataset.highlighted).toBe("true");
    expect(byTestId("report-save-error")?.textContent).toContain(
      "Customer sign-off is required",
    );
    expect(byTestId("report-save-error-element-id")?.textContent).toContain("fld_sig");
    expect(window.print).not.toHaveBeenCalled();
  });
});

describe("preview modes", () => {
  it("renders the seed fixture with no report and no API calls", () => {
    render(<ReportEditorPage fixtureId="hvac" />);

    expect(byTestId("fixture-switcher")).toBeTruthy();
    expect(container.textContent).toContain("HVAC Service Visit");
    // All six field types are present in this fixture.
    expect(byTestId("field-fld_arrival_notes")).toBeTruthy();
    expect(byTestId("field-fld_meter_reading")).toBeTruthy();
    expect(byTestId("field-fld_system_type")).toBeTruthy();
    expect(byTestId("field-fld_safety_checks")).toBeTruthy();
    expect(byTestId("field-fld_unit_photo")).toBeTruthy();
    expect(byTestId("field-fld_customer_signoff")).toBeTruthy();
    // Draft save needs an existing report, so it stays disabled in fixture
    // mode. Save & Export IS enabled: on click it materializes a real report
    // from the matching seeded template and exports it. No API call happens on
    // render — only on activation.
    expect((byTestId("save-draft-button") as HTMLButtonElement).disabled).toBe(true);
    expect((byTestId("save-and-export-button") as HTMLButtonElement).disabled).toBe(false);
    expect(saveReportMock).not.toHaveBeenCalled();
  });

  it("still honors the externalSchema prop (builder preview)", () => {
    render(<ReportEditorPage externalSchema={schema} externalName="Draft template" />);

    expect(container.textContent).toContain("Draft template");
    expect(byTestId("field-fld_meter")).toBeTruthy();
    // The fixture switcher is hidden in external mode.
    expect(byTestId("fixture-switcher")).toBeNull();
  });
});
