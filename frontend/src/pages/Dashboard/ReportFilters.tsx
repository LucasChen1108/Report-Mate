// ReportFilters — status / date-range / free-text controls for the report table.
//
// Presentational and controlled: it renders whatever `filters` it is given and
// reports changes up. The values it shows come from the URL query string (see
// useDashboard.ts), so a filtered view is a shareable link and survives a
// refresh — this component neither knows nor cares about that.
//
// ONE PIECE OF LOCAL STATE, AND WHY
//
// The search box keeps a local draft of what has been typed and pushes it up on
// a 350ms debounce. Everything else calls onChange immediately. Without the
// debounce, every keystroke is a fetch AND a history entry, which on a phone
// with a slow connection produces a flickering table and a back button that
// takes eleven presses to leave the page. The draft resyncs from `filters` when
// the URL changes underneath us (back button, Clear).
//
// The date inputs are <input type="date">: on iOS and Android that opens the
// native date wheel, which is far better one-handed in a van than any custom
// picker we would write.

import { useEffect, useId, useRef, useState } from "react";
import type { ReportFilterState } from "./useDashboard";
import {
  colors,
  controlStyle,
  fontSize,
  radius,
  secondaryButtonStyle,
  spacing,
} from "../../styles/tokens";

const SEARCH_DEBOUNCE_MS = 350;

// The status vocabulary from ReportRecord["status"] in api/reportTypes.ts.
const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "exported", label: "Exported" },
];

export interface ReportFiltersProps {
  filters: ReportFilterState;
  onChange: (patch: Partial<ReportFilterState>) => void;
  onClear: () => void;
  /** Row count for the current filter, shown so the filter has visible effect. */
  resultCount: number;
  loading: boolean;
}

export function ReportFilters({
  filters,
  onChange,
  onClear,
  resultCount,
  loading,
}: ReportFiltersProps) {
  const idPrefix = useId();
  const statusId = `${idPrefix}-status`;
  const fromId = `${idPrefix}-from`;
  const toId = `${idPrefix}-to`;
  const searchId = `${idPrefix}-search`;

  const [searchDraft, setSearchDraft] = useState(filters.q);
  const committedSearch = useRef(filters.q);

  // Resync when the URL changes from outside this component (back button,
  // Clear, a shared link opened fresh) but NOT while the user is mid-word:
  // committedSearch holds what we last pushed up, so an echo of our own change
  // does not clobber the draft.
  useEffect(() => {
    if (filters.q !== committedSearch.current) {
      committedSearch.current = filters.q;
      setSearchDraft(filters.q);
    }
  }, [filters.q]);

  useEffect(() => {
    if (searchDraft === committedSearch.current) return;
    const timer = window.setTimeout(() => {
      committedSearch.current = searchDraft;
      onChange({ q: searchDraft });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchDraft, onChange]);

  const anyActive = Boolean(
    filters.status || filters.from || filters.to || filters.q,
  );

  // The range is invalid rather than empty-by-chance: say so, because a user
  // who swaps the two dates otherwise sees "no reports" and blames the data.
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);

  return (
    <form
      data-testid="report-filters"
      // Filters apply as they change; the form element is here for grouping and
      // for the Enter key, which must not reload the page.
      onSubmit={(event) => event.preventDefault()}
      role="search"
      aria-label="Filter reports"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
        padding: spacing.md,
        background: colors.surface,
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: radius.lg,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: spacing.md,
        }}
      >
        <Field label="Search" htmlFor={searchId} grow>
          <input
            id={searchId}
            data-testid="filter-search"
            type="search"
            inputMode="search"
            placeholder="Customer, value, anything"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            style={{ ...controlStyle, width: "100%", boxSizing: "border-box" }}
          />
        </Field>

        <Field label="Status" htmlFor={statusId}>
          <select
            id={statusId}
            data-testid="filter-status"
            value={filters.status}
            onChange={(event) => onChange({ status: event.target.value })}
            style={{ ...controlStyle, width: "100%", boxSizing: "border-box" }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="From" htmlFor={fromId}>
          <input
            id={fromId}
            data-testid="filter-from"
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => onChange({ from: event.target.value })}
            style={{ ...controlStyle, width: "100%", boxSizing: "border-box" }}
          />
        </Field>

        <Field label="To" htmlFor={toId}>
          <input
            id={toId}
            data-testid="filter-to"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => onChange({ to: event.target.value })}
            style={{ ...controlStyle, width: "100%", boxSizing: "border-box" }}
          />
        </Field>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.sm,
        }}
      >
        <p
          data-testid="filter-result-count"
          // Polite live region: the count updates as filters change, and a
          // screen-reader user gets the confirmation a sighted user gets from
          // watching the table shrink.
          aria-live="polite"
          style={{ margin: 0, fontSize: fontSize.sm, color: colors.textMuted }}
        >
          {loading
            ? "Loading reports…"
            : invalidRange
              ? "“From” is after “To” — no reports can match that range."
              : `${resultCount} ${resultCount === 1 ? "report" : "reports"}${
                  anyActive ? " match these filters" : " in total"
                }`}
        </p>

        {anyActive && (
          <button
            type="button"
            data-testid="filter-clear"
            onClick={onClear}
            style={secondaryButtonStyle}
          >
            Clear filters
          </button>
        )}
      </div>
    </form>
  );
}

// A label + control pair. `grow` lets the search box take the slack on a wide
// viewport while the three narrow controls keep their size; on a phone every
// one of them goes full width, which is what the 220px basis does.
function Field({
  label,
  htmlFor,
  grow = false,
  children,
}: {
  label: string;
  htmlFor: string;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.xs,
        flex: grow ? "2 1 220px" : "1 1 160px",
        minWidth: 0,
      }}
    >
      <label
        htmlFor={htmlFor}
        style={{ fontSize: fontSize.sm, fontWeight: 600, color: colors.text }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export default ReportFilters;
