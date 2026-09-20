// useDashboard.ts — all dashboard state: fetching, filters, paging, loading and
// error handling.
//
// SCOPE: the two pages in this folder render; they do not fetch. Everything
// asynchronous or URL-bound lives here, which keeps DashboardPage and
// TemplateReportsPage presentational enough to read top-to-bottom and makes the
// table components trivially testable with literal props.
//
// -----------------------------------------------------------------------------
// WHY FILTER STATE LIVES IN THE URL, NOT IN useState
//
// `useTemplateReports` reads its filters and its paging offset FROM the query
// string and writes changes BACK to it. The query string is the state; there is
// no second copy in a useState to fall out of sync with it.
//
// That buys three things a useState cannot:
//   - a filtered view is a shareable link ("the drafts from last week" is a URL
//     a dispatcher can paste to a technician),
//   - a refresh, or a back-button after opening a report, restores the exact
//     view rather than dumping the user back at page 1 unfiltered,
//   - ?highlight= — the renderer navigates here after Save and Export — is the
//     same mechanism, so it needs no special plumbing.
//
// The cost is that every filter change is a navigation. They are `replace: true`
// so typing in the search box does not bury the previous page under thirty
// history entries; paging is a real push, because "back should undo the page I
// just turned" is what a user expects.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as api from "../../api/dashboard";
import { ApiAuthorizationError, ApiError } from "../../api/dashboard";
import type { ReportTableQuery } from "../../api/dashboard";
import type {
  DashboardTemplateRollup,
  ReportTableView,
} from "../../api/reportTypes";

/** Rows per page. Not in the URL: it is a layout decision, not a user filter. */
export const DEFAULT_PAGE_SIZE = 25;

/** The four user-settable filters, each mirrored to one query-string key. */
export interface ReportFilterState {
  /** "" = every status. Otherwise "draft" | "submitted" | "exported". */
  status: string;
  /** YYYY-MM-DD, inclusive lower bound. "" = unbounded. */
  from: string;
  /** YYYY-MM-DD, inclusive upper bound. "" = unbounded. */
  to: string;
  /** Free-text search. "" = no search. */
  q: string;
}

export const EMPTY_FILTERS: ReportFilterState = {
  status: "",
  from: "",
  to: "",
  q: "",
};

/** True when at least one filter is narrowing the result set. */
export function hasActiveFilters(filters: ReportFilterState): boolean {
  return Boolean(filters.status || filters.from || filters.to || filters.q);
}

// Turn any thrown value into a sentence a field technician can act on.
//
// The 501 branch matters more than it looks: the dashboard endpoints ship after
// this screen does, and "Not Implemented" on a blank page is indistinguishable
// from a frontend bug. Naming the cause saves the next person half an hour.
export function describeError(err: unknown, subject = "the dashboard"): string {
  if (err instanceof ApiAuthorizationError) {
    return err.message;
  }
  if (err instanceof ApiError) {
    if (err.status === 501) {
      return `The ${subject} API is not available yet (the server answered 501 Not Implemented). Nothing is wrong with your data.`;
    }
    if (err.status === 404) {
      return `We could not find ${subject}. It may have been deleted.`;
    }
    if (err.status >= 500) {
      return `The server had a problem loading ${subject}. Please try again.`;
    }
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return `Something went wrong loading ${subject}.`;
}

// --- /dashboard -------------------------------------------------------------

export interface DashboardTotals {
  reports: number;
  drafts: number;
  /** Templates with at least one report — NOT the template count. */
  templatesInUse: number;
  templates: number;
}

export interface UseDashboardRollupsResult {
  rollups: DashboardTemplateRollup[];
  totals: DashboardTotals;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Loads the template rollups and derives the summary-tile numbers. */
export function useDashboardRollups(): UseDashboardRollupsResult {
  const [rollups, setRollups] = useState<DashboardTemplateRollup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Monotonic request id: a slow first response must not overwrite a fast
  // second one (retry-while-loading is the easy way to produce that).
  const latestRequest = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    let active = true;

    setLoading(true);
    setError(null);

    api
      .listDashboardTemplates()
      .then((next) => {
        if (!active || requestId !== latestRequest.current) return;
        setRollups(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || requestId !== latestRequest.current) return;
        setError(describeError(err));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadToken]);

  const totals = useMemo<DashboardTotals>(() => {
    let reports = 0;
    let drafts = 0;
    let templatesInUse = 0;
    for (const rollup of rollups) {
      reports += rollup.reportCount;
      drafts += rollup.draftCount;
      if (rollup.reportCount > 0) templatesInUse += 1;
    }
    return { reports, drafts, templatesInUse, templates: rollups.length };
  }, [rollups]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { rollups, totals, loading, error, reload };
}

// --- /dashboard/templates/:templateId ---------------------------------------

export interface UseTemplateReportsResult {
  view: ReportTableView | null;
  loading: boolean;
  error: string | null;
  reload: () => void;

  filters: ReportFilterState;
  /** Merge a partial filter change; always returns to the first page. */
  setFilters: (patch: Partial<ReportFilterState>) => void;
  clearFilters: () => void;

  limit: number;
  offset: number;
  total: number;
  pageIndex: number;
  pageCount: number;
  goToOffset: (offset: number) => void;

  /** The ?highlight= report id the renderer hands us after Save and Export. */
  highlightId: string | null;

  exporting: boolean;
  exportError: string | null;
  exportCsv: () => void;
  exportRow: (reportId: string) => void;
  dismissExportError: () => void;
}

export function useTemplateReports(templateId: string): UseTemplateReportsResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const status = searchParams.get("status") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const q = searchParams.get("q") ?? "";
  const highlightId = searchParams.get("highlight");
  const offset = parsePositiveInt(searchParams.get("offset"));

  // Memoized on the four primitives, not on searchParams, so an unrelated query
  // param change (?highlight=) does not hand components a new object and
  // re-trigger the fetch below.
  const filters = useMemo<ReportFilterState>(
    () => ({ status, from, to, q }),
    [status, from, to, q],
  );

  const [view, setView] = useState<ReportTableView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const latestRequest = useRef(0);

  useEffect(() => {
    if (!templateId) return;

    const requestId = ++latestRequest.current;
    let active = true;

    setLoading(true);
    setError(null);

    const query: ReportTableQuery = {
      status,
      from,
      to,
      q,
      limit: DEFAULT_PAGE_SIZE,
      offset,
    };

    api
      .getTemplateReportTable(templateId, query)
      .then((next) => {
        if (!active || requestId !== latestRequest.current) return;
        setView(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || requestId !== latestRequest.current) return;
        setError(describeError(err, "these reports"));
        // The previous page's rows are dropped on failure: showing stale rows
        // under a fresh error message invites the user to trust them.
        setView(null);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [templateId, status, from, to, q, offset, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const setFilters = useCallback(
    (patch: Partial<ReportFilterState>) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          // A new filter invalidates both the page window and the "look here"
          // pointer — the highlighted row may not even be in the result now.
          next.delete("offset");
          next.delete("highlight");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const key of ["status", "from", "to", "q", "offset", "highlight"]) {
          next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const goToOffset = useCallback(
    (nextOffset: number) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        if (nextOffset > 0) next.set("offset", String(nextOffset));
        else next.delete("offset");
        next.delete("highlight");
        return next;
      });
      // Paging leaves the user at the bottom of the old page otherwise, looking
      // at what appears to be an unchanged table.
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [setSearchParams],
  );

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportCsv = useCallback(() => {
    setExporting(true);
    setExportError(null);
    api
      .exportTemplateReportsCsv(
        templateId,
        { status, from, to, q },
        view?.template.name ?? "reports",
      )
      .catch((err: unknown) => setExportError(describeError(err, "the CSV export")))
      .finally(() => setExporting(false));
  }, [templateId, status, from, to, q, view?.template.name]);

  const exportRow = useCallback((reportId: string) => {
    setExportError(null);
    api
      .exportReportDocument(reportId)
      .catch((err: unknown) => setExportError(describeError(err, "that report")));
  }, []);

  const total = view?.total ?? 0;
  const limit = view?.limit ?? DEFAULT_PAGE_SIZE;
  const pageCount = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const pageIndex = limit > 0 ? Math.floor(offset / limit) : 0;

  return {
    view,
    loading,
    error,
    reload,
    filters,
    setFilters,
    clearFilters,
    limit,
    offset,
    total,
    pageIndex,
    pageCount,
    goToOffset,
    highlightId,
    exporting,
    exportError,
    exportCsv,
    exportRow,
    dismissExportError: useCallback(() => setExportError(null), []),
  };
}

// A query-string integer that refuses to become NaN, a negative offset, or
// "1e9" — any of which would produce a confusing empty page rather than an
// error the user could understand.
function parsePositiveInt(raw: string | null): number {
  if (!raw) return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
