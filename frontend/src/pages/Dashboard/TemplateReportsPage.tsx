// TemplateReportsPage — /dashboard/templates/:templateId.
//
// One template's reports as a spreadsheet: the template's FIELDS are the
// columns, each past report is a row. This is the screen the product is really
// about — the dashboard grid exists to get you here.
//
// Layout, top to bottom:
//   header   — back link, template name + revision, New report, Export CSV
//   filters  — status / date range / search, all mirrored into the URL
//   table    — ReportTable, scrolling horizontally inside its own container
//   paging   — total / limit / offset
//
// THE PAGE MUST NOT SCROLL SIDEWAYS. Everything here is a flex column with
// `minWidth: 0`, which is what allows ReportTable's overflow container to be
// narrower than the table inside it. Drop that and a 15-field template drags
// the header and the filter bar off the right edge of a phone — the single
// most likely way this screen breaks.
//
// State (fetch, filters, paging, exports, ?highlight=) is entirely in
// useDashboard.ts; this file is layout plus the loading / error / empty
// branches.

import { Link, useParams } from "react-router-dom";
import { ReportFilters } from "./ReportFilters";
import { ReportTable } from "./ReportTable";
import { EmptyState } from "./EmptyState";
import { hasActiveFilters, useTemplateReports } from "./useDashboard";
import {
  colors,
  fontSize,
  radius,
  spacing,
  primaryButtonStyle,
  secondaryButtonStyle,
  MIN_TAP_TARGET,
} from "../../styles/tokens";

export function TemplateReportsPage() {
  const { templateId = "" } = useParams<{ templateId: string }>();
  const {
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
    dismissExportError,
  } = useTemplateReports(templateId);

  const templateName = view?.template.name ?? "Reports";
  const rows = view?.rows ?? [];
  const filtersActive = hasActiveFilters(filters);

  // The highlighted report is not on this page: the user came from a Save and
  // Export but a filter or a page offset is hiding the row they were sent to
  // look at. Say so rather than letting them hunt for a flash that never comes.
  const highlightMissing =
    Boolean(highlightId) &&
    !loading &&
    !error &&
    rows.length > 0 &&
    !rows.some((row) => row.reportId === highlightId);

  return (
    <main
      style={{
        minWidth: 0,
        maxWidth: 1400,
        margin: "0 auto",
        padding: spacing.lg,
        display: "flex",
        flexDirection: "column",
        gap: spacing.lg,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: spacing.sm, minWidth: 0 }}>
        <Link
          to="/dashboard"
          data-testid="back-to-dashboard"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: MIN_TAP_TARGET,
            fontSize: fontSize.base,
            color: colors.primary,
            textDecoration: "underline",
            alignSelf: "flex-start",
          }}
        >
          ← All templates
        </Link>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: spacing.md,
            alignItems: "flex-start",
            justifyContent: "space-between",
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: fontSize.xl,
                color: colors.text,
                wordBreak: "break-word",
              }}
            >
              {templateName}
            </h1>
            <p style={{ margin: `${spacing.xs}px 0 0`, fontSize: fontSize.sm, color: colors.textMuted }}>
              {view ? `Revision ${view.template.revision}` : "Loading template…"}
              {view && total > 0 ? ` · ${total} ${total === 1 ? "report" : "reports"}` : ""}
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm }}>
            <Link
              to={`/reports/new?templateId=${encodeURIComponent(templateId)}`}
              data-testid="new-report-button"
              style={{
                ...primaryButtonStyle,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                textDecoration: "none",
              }}
            >
              New report
            </Link>
            <button
              type="button"
              data-testid="export-csv-button"
              onClick={exportCsv}
              // Disabled with nothing to export: a CSV of zero rows is a
              // confusing thing to hand someone.
              disabled={exporting || total === 0}
              title={
                filtersActive
                  ? "Downloads the reports matching the current filters"
                  : "Downloads every report for this template"
              }
              style={{
                ...secondaryButtonStyle,
                opacity: exporting || total === 0 ? 0.6 : 1,
                cursor: exporting || total === 0 ? "not-allowed" : "pointer",
              }}
            >
              {exporting ? "Preparing CSV…" : "Export CSV"}
            </button>
          </div>
        </div>
      </header>

      {exportError && (
        <p
          role="alert"
          data-testid="export-error"
          style={{
            margin: 0,
            padding: spacing.md,
            borderRadius: radius.md,
            border: `1px solid ${colors.dangerText}`,
            background: colors.surface,
            color: colors.dangerText,
            fontSize: fontSize.sm,
            display: "flex",
            flexWrap: "wrap",
            gap: spacing.sm,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{exportError}</span>
          <button type="button" onClick={dismissExportError} style={secondaryButtonStyle}>
            Dismiss
          </button>
        </p>
      )}

      <ReportFilters
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        resultCount={total}
        loading={loading}
      />

      {highlightMissing && (
        <p
          data-testid="highlight-missing-notice"
          role="status"
          style={{
            margin: 0,
            padding: spacing.md,
            borderRadius: radius.md,
            border: `1px solid ${colors.primary}`,
            background: colors.seedBadgeBg,
            color: colors.text,
            fontSize: fontSize.sm,
          }}
        >
          The report you just saved is not on this page — a filter or the current
          page is hiding it.{" "}
          <button
            type="button"
            onClick={clearFilters}
            style={{
              ...secondaryButtonStyle,
              minHeight: MIN_TAP_TARGET,
              marginLeft: spacing.sm,
            }}
          >
            Show all reports
          </button>
        </p>
      )}

      {loading && (
        <p data-testid="reports-loading" aria-live="polite" style={{ margin: 0, color: colors.textMuted }}>
          Loading reports…
        </p>
      )}

      {!loading && error && (
        <EmptyState
          tone="error"
          title="We could not load these reports"
          message={error}
          primaryAction={{ label: "Try again", onClick: reload }}
          secondaryAction={{ label: "Back to dashboard", to: "/dashboard" }}
        />
      )}

      {!loading && !error && rows.length === 0 && (
        // Two genuinely different empties: "your filter matched nothing" is a
        // dead end the user created and can undo; "nothing has ever been filed"
        // is an invitation to file the first one.
        <EmptyState
          title={filtersActive ? "No reports match these filters" : "No reports yet"}
          message={
            filtersActive
              ? "Nothing was filed against this template within the status, dates, or search text you chose. Clearing the filters brings the full history back."
              : "Nobody has filed a report against this template yet. The first one you submit will appear here, with one column per template field."
          }
          primaryAction={
            filtersActive
              ? { label: "Clear filters", onClick: clearFilters }
              : {
                  label: "Start a report",
                  to: `/reports/new?templateId=${encodeURIComponent(templateId)}`,
                }
          }
        />
      )}

      {!loading && !error && rows.length > 0 && view && (
        <>
          <ReportTable
            columns={view.columns}
            rows={rows}
            templateRevision={view.template.revision}
            highlightId={highlightId}
            onExportRow={exportRow}
          />

          <Pagination
            total={total}
            limit={limit}
            offset={offset}
            pageIndex={pageIndex}
            pageCount={pageCount}
            onGoToOffset={goToOffset}
          />
        </>
      )}
    </main>
  );
}

// Offset paging over total/limit/offset, exactly as the response reports them —
// no page number is kept in component state, so the URL and the server's window
// cannot disagree.
function Pagination({
  total,
  limit,
  offset,
  pageIndex,
  pageCount,
  onGoToOffset,
}: {
  total: number;
  limit: number;
  offset: number;
  pageIndex: number;
  pageCount: number;
  onGoToOffset: (offset: number) => void;
}) {
  if (total <= limit) {
    // One page of results: the controls would be three disabled buttons and a
    // count the header already shows.
    return null;
  }

  const firstShown = offset + 1;
  const lastShown = Math.min(offset + limit, total);
  const atStart = offset <= 0;
  const atEnd = lastShown >= total;

  const pagerButton = (disabled: boolean): React.CSSProperties => ({
    ...secondaryButtonStyle,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  return (
    <nav
      data-testid="report-pagination"
      aria-label="Report pages"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.sm,
      }}
    >
      <p aria-live="polite" style={{ margin: 0, fontSize: fontSize.sm, color: colors.textMuted }}>
        Showing {firstShown}–{lastShown} of {total} · page {pageIndex + 1} of {pageCount}
      </p>
      <div style={{ display: "flex", gap: spacing.sm }}>
        <button
          type="button"
          data-testid="page-previous"
          onClick={() => onGoToOffset(Math.max(0, offset - limit))}
          disabled={atStart}
          style={pagerButton(atStart)}
        >
          ← Previous
        </button>
        <button
          type="button"
          data-testid="page-next"
          onClick={() => onGoToOffset(offset + limit)}
          disabled={atEnd}
          style={pagerButton(atEnd)}
        >
          Next →
        </button>
      </div>
    </nav>
  );
}

export default TemplateReportsPage;
