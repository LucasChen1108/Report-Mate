// ReportTable — the spreadsheet of one template's reports.
//
// This is the product's centrepiece: COLUMNS ARE THE TEMPLATE'S FIELDS, one row
// per report filed against it. Leading Date / Status / Customer columns, then
// one column per ReportTableColumn in the order the backend gave them, grouped
// under their sectionLabel, then a per-row actions column.
//
// -----------------------------------------------------------------------------
// FOUR THINGS THIS FILE IS CAREFUL ABOUT
//
// 1. IT DOES NOT KNOW WHAT A FIELD TYPE MEANS. Every cell is printed as
//    `row.cells[column.fieldId]` and nothing else. The backend has already
//    flattened checklists, signatures and photos to display strings (see the
//    long note at the top of api/reportTypes.ts). `column.type` is used ONLY
//    for alignment and column width — never to decide how to format a value.
//    A switch on FieldType here would re-create exactly the drift that contract
//    was designed to prevent.
//
// 2. THE TABLE SCROLLS, THE PAGE DOES NOT. A 15-field template is ~1800px wide
//    and this app is used on a phone. The table lives in a `overflow-x: auto`
//    container with `max-width: 100%` and `min-width: 0`, so horizontal
//    overflow is captured by that box. If the page itself scrolled sideways,
//    the header, the filters and the nav would slide off-screen with it — the
//    classic broken-mobile-table failure.
//
// 3. staleRevision ROWS ARE FLAGGED, NOT HIDDEN. A report filled against an
//    older template revision legitimately has no value for fields added since.
//    Unexplained blanks read as data loss, so those rows carry a "Rev N" badge
//    whose tooltip says exactly that, and their empty cells get their own
//    explanatory title.
//
// 4. REAL TABLE SEMANTICS. <table>, <caption>, <th scope="col"> per column,
//    <th scope="colgroup"> per section, <th scope="row"> for the date cell.
//    This is tabular data; a screen-reader user navigating it cell by cell
//    needs the headers announced, which a grid of <div>s cannot do.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ReportTableColumn, ReportTableRow } from "../../api/reportTypes";
import {
  colors,
  fontSize,
  radius,
  spacing,
  MIN_TAP_TARGET,
} from "../../styles/tokens";
import { formatDate, formatDateTime, formatStatus } from "./format";

// How long the ?highlight= row pulses before settling back. Long enough to find
// with your eyes after a page transition, short enough not to nag.
const FLASH_DURATION_MS = 2600;

// Keyframes cannot be expressed in an inline style object, and this component
// may not touch src/styles/theme.css (another agent owns it). A scoped <style>
// element rendered with the table is the contained way to get the flash, and it
// keeps the animation next to the code that triggers it.
const FLASH_STYLES = `
@keyframes rm-row-flash {
  0%, 100% { background-color: ${colors.surface}; }
  15%, 55% { background-color: ${colors.dropHighlight}; }
}
.rm-row-flash {
  animation: rm-row-flash ${FLASH_DURATION_MS}ms ease-in-out 1;
}
/* Respect a reduced-motion preference: keep the persistent highlight (it is
   the whole point — "your report is this one") and drop only the pulsing. */
@media (prefers-reduced-motion: reduce) {
  .rm-row-flash { animation: none; background-color: ${colors.dropHighlight}; }
}
`;

export interface ReportTableProps {
  columns: ReportTableColumn[];
  rows: ReportTableRow[];
  /** The template's CURRENT revision, for the stale-row explanation. */
  templateRevision: number;
  /** ?highlight= — scroll to this report and flash it. */
  highlightId: string | null;
  /** Row-level export download. */
  onExportRow: (reportId: string) => void;
}

export function ReportTable({
  columns,
  rows,
  templateRevision,
  highlightId,
  onExportRow,
}: ReportTableProps) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [flashingId, setFlashingId] = useState<string | null>(null);

  // THE SAVE-AND-EXPORT LANDING. The renderer navigates here with
  // ?highlight=<reportId> after a save, so the user arrives looking at the
  // report they just filed. Without this the table looks identical to before
  // the save and the app appears not to have updated.
  useEffect(() => {
    if (!highlightId) {
      setFlashingId(null);
      return;
    }
    const element = rowRefs.current.get(highlightId);
    if (!element) {
      // The row is not on this page (a filter or a page change moved it).
      // Nothing to flash; the page-level notice explains it.
      setFlashingId(null);
      return;
    }

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // `inline: "nearest"` is load-bearing: `center` would scroll the table's
    // horizontal container sideways as well, dumping the user in the middle of
    // a 15-field row with the Date column off-screen.
    element.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
      inline: "nearest",
    });

    setFlashingId(highlightId);
    const timer = window.setTimeout(() => setFlashingId(null), FLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId, rows]);

  // Contiguous runs of columns sharing a sectionLabel, in the order given. Runs
  // rather than a group-by: the backend emits columns in schema order and that
  // order is what the user authored, so re-sorting to merge two non-adjacent
  // sections would silently rearrange their spreadsheet.
  const groups = useMemo(() => buildSectionGroups(columns), [columns]);

  const hasFieldColumns = columns.length > 0;

  return (
    <div
      data-testid="report-table-scroll"
      // The horizontal scroll boundary. minWidth:0 is what actually lets this
      // box be narrower than its content inside a flex column parent — without
      // it the box grows to fit the table and the PAGE scrolls instead.
      style={{
        overflowX: "auto",
        maxWidth: "100%",
        minWidth: 0,
        WebkitOverflowScrolling: "touch",
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: radius.lg,
        background: colors.surface,
      }}
      // Focusable + labelled so a keyboard user can scroll the region with the
      // arrow keys; an unfocusable overflow box is unreachable without a mouse.
      tabIndex={0}
      role="region"
      aria-label="Reports table, scrolls horizontally"
    >
      <style>{FLASH_STYLES}</style>

      <table
        data-testid="report-table"
        style={{
          borderCollapse: "collapse",
          // NOT width:100% — the table must be allowed to exceed its container
          // so the container can scroll it. It still fills a wide viewport.
          minWidth: "100%",
          fontSize: fontSize.sm,
          color: colors.text,
        }}
      >
        <caption style={SR_ONLY}>
          Reports filed against this template. The first three columns are the
          report date, status and customer; the remaining columns are the
          template's fields.
        </caption>

        <thead>
          {/* Row 1: the leading columns (spanning both header rows) and one
              spanning header per section. */}
          <tr>
            <HeaderCell scope="col" rowSpan={hasFieldColumns ? 2 : 1} sticky>
              Date
            </HeaderCell>
            <HeaderCell scope="col" rowSpan={hasFieldColumns ? 2 : 1}>
              Status
            </HeaderCell>
            <HeaderCell scope="col" rowSpan={hasFieldColumns ? 2 : 1}>
              Customer
            </HeaderCell>

            {groups.map((group) => (
              <HeaderCell
                key={group.key}
                scope="colgroup"
                colSpan={group.columns.length}
                groupStart
                muted
              >
                {group.label}
              </HeaderCell>
            ))}

            <HeaderCell scope="col" rowSpan={hasFieldColumns ? 2 : 1} groupStart>
              Actions
            </HeaderCell>
          </tr>

          {/* Row 2: the field columns themselves. Omitted entirely when the
              template has no fields — an empty <tr> is not valid markup. */}
          {hasFieldColumns && (
            <tr>
              {groups.map((group) =>
                group.columns.map((column, indexInGroup) => (
                  <HeaderCell
                    key={column.fieldId}
                    scope="col"
                    align={column.type === "number" ? "right" : "left"}
                    groupStart={indexInGroup === 0}
                  >
                    {column.label}
                  </HeaderCell>
                )),
              )}
            </tr>
          )}
        </thead>

        <tbody>
          {rows.map((row) => {
            const isHighlighted = row.reportId === highlightId;
            return (
              <tr
                key={row.reportId}
                data-testid="report-row"
                data-report-id={row.reportId}
                ref={(element) => {
                  if (element) rowRefs.current.set(row.reportId, element);
                  else rowRefs.current.delete(row.reportId);
                }}
                className={flashingId === row.reportId ? "rm-row-flash" : undefined}
                style={{
                  borderTop: `1px solid ${colors.borderSubtle}`,
                  background: isHighlighted ? colors.dropHighlight : undefined,
                }}
              >
                {/* The date is the row header: it is what identifies the row
                    when a screen reader announces any other cell in it. */}
                <th
                  scope="row"
                  style={{
                    ...cellStyle,
                    textAlign: "left",
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Link
                    to={`/reports/${encodeURIComponent(row.reportId)}`}
                    title={formatDateTime(row.createdAt)}
                    style={{
                      color: colors.primary,
                      fontWeight: 600,
                      textDecoration: "underline",
                      display: "inline-flex",
                      alignItems: "center",
                      minHeight: MIN_TAP_TARGET,
                    }}
                  >
                    {formatDate(row.createdAt)}
                  </Link>
                </th>

                <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>
                  <StatusPill status={row.status} />
                </td>

                <td style={{ ...cellStyle, minWidth: 160 }}>
                  <span style={{ display: "block", marginBottom: row.staleRevision ? spacing.xs : 0 }}>
                    {row.customerName || "—"}
                  </span>
                  {row.staleRevision && (
                    <StaleBadge
                      rowRevision={row.templateRevision}
                      templateRevision={templateRevision}
                    />
                  )}
                </td>

                {groups.map((group) =>
                  group.columns.map((column, indexInGroup) => {
                    const value = row.cells[column.fieldId] ?? "";
                    return (
                      <td
                        key={column.fieldId}
                        style={{
                          ...cellStyle,
                          textAlign: column.type === "number" ? "right" : "left",
                          borderLeft:
                            indexInGroup === 0
                              ? `1px solid ${colors.borderSubtle}`
                              : undefined,
                          // Long text wraps at a readable measure instead of
                          // stretching one column to 900px.
                          maxWidth: 280,
                        }}
                      >
                        {value ? (
                          value
                        ) : (
                          <span
                            aria-label={
                              row.staleRevision
                                ? "No value — this field did not exist in the template revision this report was filled against"
                                : "No value"
                            }
                            title={
                              row.staleRevision
                                ? `Not collected: this report was filled against revision ${row.templateRevision}, before this field existed.`
                                : "Left blank"
                            }
                            style={{ color: colors.textMuted }}
                          >
                            —
                          </span>
                        )}
                      </td>
                    );
                  }),
                )}

                <td
                  style={{
                    ...cellStyle,
                    whiteSpace: "nowrap",
                    borderLeft: `1px solid ${colors.borderSubtle}`,
                  }}
                >
                  <div style={{ display: "flex", gap: spacing.xs, alignItems: "center" }}>
                    <Link
                      to={`/reports/${encodeURIComponent(row.reportId)}`}
                      data-testid="row-open-link"
                      style={rowActionStyle}
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      data-testid="row-export-button"
                      onClick={() => onExportRow(row.reportId)}
                      title="Download this report's exported document"
                      style={{ ...rowActionStyle, cursor: "pointer" }}
                    >
                      Export
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Pieces -----------------------------------------------------------------

interface SectionGroup {
  key: string;
  label: string;
  columns: ReportTableColumn[];
}

// Collapse the column list into contiguous same-section runs. A section that
// appears twice (possible if the backend ever interleaves) yields two groups,
// which is honest about the order rather than silently merging them.
export function buildSectionGroups(columns: ReportTableColumn[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const column of columns) {
    const label = column.sectionLabel || "Fields";
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.columns.push(column);
    } else {
      groups.push({ key: `${label}-${groups.length}`, label, columns: [column] });
    }
  }
  return groups;
}

const cellStyle: React.CSSProperties = {
  padding: `${spacing.sm}px ${spacing.md}px`,
  verticalAlign: "top",
  lineHeight: 1.4,
};

const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const rowActionStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: MIN_TAP_TARGET,
  minWidth: MIN_TAP_TARGET,
  padding: `0 ${spacing.sm}px`,
  borderRadius: radius.sm,
  fontSize: fontSize.sm,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surface,
  border: `1px solid ${colors.primary}`,
  textDecoration: "none",
};

function HeaderCell({
  children,
  scope,
  colSpan,
  rowSpan,
  align = "left",
  groupStart = false,
  muted = false,
  sticky = false,
}: {
  children: React.ReactNode;
  scope: "col" | "colgroup";
  colSpan?: number;
  rowSpan?: number;
  align?: "left" | "right";
  groupStart?: boolean;
  muted?: boolean;
  /** Reserved for the Date column; kept as a hook for a future sticky column. */
  sticky?: boolean;
}) {
  return (
    <th
      scope={scope}
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={{
        padding: `${spacing.sm}px ${spacing.md}px`,
        textAlign: align,
        whiteSpace: "nowrap",
        fontSize: muted ? fontSize.xs : fontSize.sm,
        fontWeight: muted ? 600 : 700,
        textTransform: muted ? "uppercase" : undefined,
        letterSpacing: muted ? "0.04em" : undefined,
        color: muted ? colors.textMuted : colors.text,
        background: muted ? colors.surfaceMuted : colors.surface,
        borderBottom: `2px solid ${colors.border}`,
        borderLeft: groupStart ? `1px solid ${colors.borderSubtle}` : undefined,
        verticalAlign: "bottom",
        ...(sticky ? {} : {}),
      }}
    >
      {children}
    </th>
  );
}

function StatusPill({ status }: { status: string }) {
  // Color is a reinforcement, never the only signal — the word is always there,
  // for colour-blind users and for a printed page.
  const tone =
    status === "draft"
      ? { bg: "#fdf3e3", fg: "#7a4b00", border: "#7a4b00" }
      : status === "exported"
        ? { bg: colors.seedBadgeBg, fg: colors.primary, border: colors.primary }
        : { bg: "#e7f5ec", fg: colors.successText, border: colors.successText };

  return (
    <span
      data-testid="status-pill"
      style={{
        display: "inline-block",
        padding: `2px ${spacing.sm}px`,
        borderRadius: 999,
        fontSize: fontSize.xs,
        fontWeight: 700,
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {formatStatus(status)}
    </span>
  );
}

// The stale-revision flag. The tooltip is the important part: a user seeing
// blank cells with no explanation assumes the app lost their data, and that
// assumption is very hard to walk back.
function StaleBadge({
  rowRevision,
  templateRevision,
}: {
  rowRevision: number;
  templateRevision: number;
}) {
  const explanation =
    `Filled against template revision ${rowRevision}; the template is now at ` +
    `revision ${templateRevision}. Columns added after revision ${rowRevision} ` +
    `were never part of this report, so they are blank here. No data is missing.`;

  return (
    <span
      data-testid="stale-badge"
      title={explanation}
      aria-label={explanation}
      style={{
        display: "inline-block",
        padding: `1px ${spacing.xs}px`,
        borderRadius: radius.sm,
        fontSize: fontSize.xs,
        fontWeight: 600,
        color: colors.textMuted,
        background: colors.surfaceMuted,
        border: `1px dashed ${colors.textMuted}`,
        // The cue is deliberately quiet: it explains a nuance, it is not a
        // problem to be fixed, and 30 loud badges would drown the data.
        cursor: "help",
        whiteSpace: "nowrap",
      }}
    >
      Rev {rowRevision}
    </span>
  );
}

export default ReportTable;
