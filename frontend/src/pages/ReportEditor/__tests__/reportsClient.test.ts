// Tests for api/reports.ts — the HTTP contract, not the UI.
//
// The reports backend was a 501 stub while this client was written, so these
// pin the request shapes the frozen contract specifies (method, path, body) and
// the error mapping the shared client provides. When the real server lands,
// these are what say whether the two sides agree.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ApiValidationError,
  createReport,
  getReport,
  listReports,
  reportExportPath,
  saveAndExportReport,
  saveReport,
} from "../../../api/reports";
import type { ReportContent } from "../../../api/reportTypes";

const content: ReportContent = { values: { f1: "x" }, parts: [], filledBy: "manual" };

let fetchMock: ReturnType<typeof vi.fn>;

const ok = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);

beforeEach(() => {
  fetchMock = vi.fn(() => ok({ id: "rep_1" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The (url, init) the client passed to fetch on its single call. */
function lastCall() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
}

describe("the report endpoints", () => {
  it("createReport POSTs the collection", async () => {
    await createReport({ templateId: "tpl_1" });
    const { url, init, body } = lastCall();
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(url).toBe("/api/reports");
    expect(body).toEqual({ templateId: "tpl_1" });
  });

  it("getReport GETs one report", async () => {
    await getReport("rep_1");
    const { url, init } = lastCall();
    expect(init.method).toBe("GET");
    expect(url).toBe("/api/reports/rep_1");
  });

  it("saveReport PUTs content + customerName (draft save)", async () => {
    await saveReport("rep_1", { content, customerName: "Acme Ltd" });
    const { url, init, body } = lastCall();
    expect(init.method).toBe("PUT");
    expect(url).toBe("/api/reports/rep_1");
    expect(body).toEqual({ content, customerName: "Acme Ltd" });
  });

  it("saveAndExportReport POSTs the save-and-export subpath", async () => {
    await saveAndExportReport("rep_1", { content });
    const { url, init } = lastCall();
    expect(init.method).toBe("POST");
    expect(url).toBe("/api/reports/rep_1/save-and-export");
  });

  it("listReports passes filters as query params and omits empty ones", async () => {
    const page = { reports: [], total: 0, limit: 25, offset: 0 };
    fetchMock.mockReturnValue(ok(page));

    // Paged envelope, not a bare array — the server returns a count alongside.
    await expect(listReports({ templateId: "tpl_1" })).resolves.toEqual(page);
    expect(lastCall().url).toBe("/api/reports?templateId=tpl_1");

    fetchMock.mockClear();
    await listReports({ status: "draft", q: "", limit: 10, offset: 20 });
    // An empty value is dropped: `?q=` reads server-side as a blank filter.
    expect(lastCall().url).toBe("/api/reports?status=draft&limit=10&offset=20");

    fetchMock.mockClear();
    await listReports();
    expect(lastCall().url).toBe("/api/reports");
  });

  it("escapes ids rather than splicing them into the path raw", async () => {
    await getReport("rep/../admin");
    expect(lastCall().url).toBe("/api/reports/rep%2F..%2Fadmin");
    expect(reportExportPath("a b")).toBe("/api/reports/a%20b/export");
  });
});

describe("error mapping (inherited from api/client)", () => {
  it("maps a 422 to ApiValidationError carrying elementId", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 422,
        text: () =>
          Promise.resolve(JSON.stringify({
            code: "validation_error",
            message: "Meter reading is required",
            elementId: "fld_meter_reading",
          })),
      } as Response),
    );

    await expect(saveAndExportReport("rep_1", { content })).rejects.toThrow(
      ApiValidationError,
    );

    await saveAndExportReport("rep_1", { content }).catch((err: unknown) => {
      expect(err).toBeInstanceOf(ApiValidationError);
      expect((err as ApiValidationError).elementId).toBe("fld_meter_reading");
    });
  });

  it("maps the reports stub's 501 to a generic ApiError", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 501,
        text: () => Promise.resolve("reports are not implemented yet"),
      } as Response),
    );

    await saveReport("rep_1", { content }).catch((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(501);
    });
    expect.assertions(2);
  });
});
