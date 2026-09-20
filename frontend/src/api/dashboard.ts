// dashboard.ts — typed API client for the dashboard surface.
//
// SCOPE: the three dashboard endpoints (template rollups, the per-template
// report table, that table as CSV) plus the per-report export download the
// report table's row action needs. Structured exactly like ./templates.ts:
// thin one-call-per-endpoint wrappers over the shared `request` helper in
// ./client, so the base URL, the Authorization header, and the typed
// 422/403/other error mapping stay in ONE place (src/api/README.md).
//
// No component in pages/Dashboard/ calls `fetch` — except through here.
//
// -----------------------------------------------------------------------------
// WHY THE TWO DOWNLOADS ARE NOT `<a href>`
//
// `export.csv` and `/api/reports/{id}/export` are authenticated endpoints. A
// plain anchor is a top-level browser navigation: it carries cookies, but NOT
// the `Authorization: Bearer <token>` header this app authenticates with (see
// client.ts). Today the dev identity shim makes every request succeed, so an
// anchor would appear to work and would start 401-ing the day real auth lands —
// the worst possible failure timing, in a demo, with no obvious cause.
//
// So both downloads go through fetch(): attach the header, read the body as a
// Blob, hand the blob to a synthetic <a download> via an object URL, and revoke
// the URL afterwards. That is the only way to authenticate a file download from
// a SPA without putting the token in a query string (where it would land in
// server logs and browser history).
// -----------------------------------------------------------------------------

import { BASE_URL, getStoredToken, ApiError, request } from "./client";
// Re-exported so pages/Dashboard/* catches the error contract by name from the
// module it already imports, the way the builder does with ./templates.
export { ApiValidationError, ApiAuthorizationError, ApiError } from "./client";

import type { DashboardTemplateRollup, ReportTableView } from "./reportTypes";

// The filter/paging window for the report table. Every member is optional: an
// absent one is simply left out of the query string so the backend applies its
// own default, rather than the frontend guessing at it.
export interface ReportTableQuery {
  /** "draft" | "submitted" | "exported"; omitted or "" means every status. */
  status?: string;
  /** Inclusive lower bound on report date, as YYYY-MM-DD. */
  from?: string;
  /** Inclusive upper bound on report date, as YYYY-MM-DD. */
  to?: string;
  /** Free-text search across the row (customer, title, cell values). */
  q?: string;
  limit?: number;
  offset?: number;
}

// Serialize a ReportTableQuery to a `?a=b&c=d` suffix (or "" when nothing is
// set). Empty strings are dropped, not sent: `?status=` and no status at all
// must mean the same thing, and only one of them should ever reach the server.
function toQueryString(query: ReportTableQuery = {}): string {
  const params = new URLSearchParams();

  if (query.status) params.set("status", query.status);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.q) params.set("q", query.q);
  if (typeof query.limit === "number") params.set("limit", String(query.limit));
  if (typeof query.offset === "number" && query.offset > 0) {
    params.set("offset", String(query.offset));
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

// GET /api/dashboard/templates — one rollup per template the user can see,
// INCLUDING templates with zero reports (the dashboard card doubles as a
// "start a report here" entry point, so a zero-count template must come back).
export function listDashboardTemplates(): Promise<DashboardTemplateRollup[]> {
  return request<DashboardTemplateRollup[]>("GET", "/api/dashboard/templates");
}

// GET /api/dashboard/templates/{id} — the report table: the template's columns,
// one page of rows, and the paging window that produced them.
export function getTemplateReportTable(
  templateId: string,
  query: ReportTableQuery = {},
): Promise<ReportTableView> {
  return request<ReportTableView>(
    "GET",
    `/api/dashboard/templates/${encodeURIComponent(templateId)}${toQueryString(query)}`,
  );
}

// --- File downloads ---------------------------------------------------------

// Fetch `path` with the auth header attached and hand the body to the browser
// as a download named `fallbackName`. Shared by both download helpers below.
//
// The server's Content-Disposition filename wins when it sends one — it knows
// the template name and the filter window; the caller's fallback is only for
// when it does not.
async function downloadAsFile(path: string, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, { method: "GET", headers });

  if (!response.ok) {
    // Deliberately NOT routed through request()'s error mapping: that helper
    // parses JSON, and a failed download's body is an error page as often as
    // it is JSON. A typed ApiError with the status is all the caller needs.
    const detail = await response.text().catch(() => "");
    throw new ApiError(
      response.status,
      detail || `Download failed with status ${response.status}`,
    );
  }

  const filename = filenameFromDisposition(
    response.headers.get("Content-Disposition"),
    fallbackName,
  );

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    // Appended to the DOM before clicking: Firefox ignores a click on an
    // anchor that is not in the document.
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Freed on the next tick — revoking synchronously can cancel the download
    // in some browsers before it has read the blob.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

// Pull `filename="…"` out of a Content-Disposition header, falling back when
// the header is absent or unparseable. Handles the RFC 5987 `filename*=` form
// first because that is what a server sends for a non-ASCII template name.
function filenameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  if (!header) return fallback;

  const extended = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // Malformed percent-encoding — fall through to the plain form.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

// GET /api/dashboard/templates/{id}/export.csv — the CURRENT filtered view as a
// CSV download. The same query the table was fetched with is passed through, so
// what the user exports is what the user is looking at; `limit`/`offset` are
// stripped because an export covers the whole filtered set, not just page 2.
export function exportTemplateReportsCsv(
  templateId: string,
  query: ReportTableQuery = {},
  templateName = "reports",
): Promise<void> {
  const { limit: _limit, offset: _offset, ...filters } = query;
  return downloadAsFile(
    `/api/dashboard/templates/${encodeURIComponent(templateId)}/export.csv${toQueryString(filters)}`,
    `${slugify(templateName)}-reports.csv`,
  );
}

// GET /api/reports/{id}/export — the generated document for ONE report, which
// is the row-level export action in the report table. It belongs to the reports
// API rather than the dashboard's, but the dashboard is the only caller and it
// needs the same authenticated-blob treatment, so the wrapper lives here.
export function exportReportDocument(reportId: string): Promise<void> {
  return downloadAsFile(
    `/api/reports/${encodeURIComponent(reportId)}/export`,
    `report-${reportId}.pdf`,
  );
}

// Filesystem-safe fallback filename stem.
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "reports"
  );
}
