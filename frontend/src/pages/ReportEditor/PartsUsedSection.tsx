// PartsUsedSection — the Parts Used table (handoff decision 2).
//
// Every real service template has a parts-used table (part / part number /
// quantity) as its OWN structural section, backed by the dedicated parts_used
// table in the data model — NOT a generic template field type. So it is
// rendered here as a first-class section outside the schema-driven field loop,
// editing ReportContent.parts directly.
//
// Editable: add a row, edit any cell, remove a row. Quantity is kept as a string
// (see reportContent.ts) so a partially-typed / empty entry round-trips.

import { colors, fontSize, radius, spacing } from "../../styles/tokens";
import type { PartRow } from "./reportContent";
import { emptyPartRow } from "./reportContent";

interface PartsUsedSectionProps {
  parts: PartRow[];
  onChange: (next: PartRow[]) => void;
}

const cellInputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  fontSize: fontSize.base,
  padding: `${spacing.xs}px ${spacing.sm}px`,
  borderRadius: radius.sm,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: colors.text,
};

export function PartsUsedSection({ parts, onChange }: PartsUsedSectionProps) {
  const updateRow = (id: string, patch: Partial<PartRow>) => {
    onChange(parts.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeRow = (id: string) => {
    onChange(parts.filter((row) => row.id !== id));
  };

  const addRow = () => {
    onChange([...parts, emptyPartRow()]);
  };

  return (
    <section
      data-testid="parts-used-section"
      className="rm-report-section"
      aria-label="Parts Used"
    >
      <h2
        style={{
          margin: `0 0 ${spacing.md}px`,
          fontSize: fontSize.lg,
          color: colors.text,
          borderBottom: `2px solid ${colors.primary}`,
          paddingBottom: spacing.xs,
        }}
      >
        Parts Used
      </h2>

      {parts.length === 0 ? (
        <p style={{ margin: `0 0 ${spacing.md}px`, color: colors.textMuted, fontSize: fontSize.sm }}>
          No parts recorded.
        </p>
      ) : (
        <div style={{ maxWidth: "100%", overflowX: "auto", marginBottom: spacing.md }}>
        <table
          data-testid="parts-used-table"
          style={{
            width: "100%",
            // A sensible minimum so the three inputs stay usable; on a phone the
            // wrapper scrolls horizontally instead of the row overflowing the page.
            minWidth: 320,
            tableLayout: "fixed",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr>
              <th style={headCellStyle}>Part</th>
              <th style={{ ...headCellStyle, width: "28%" }}>Part number</th>
              <th style={{ ...headCellStyle, width: "16%" }}>Qty</th>
              {/* Remove-column: no header text. */}
              <th style={{ ...headCellStyle, width: 44 }} aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {parts.map((row) => (
              <tr key={row.id} data-testid="parts-used-row">
                <td style={bodyCellStyle}>
                  <input
                    type="text"
                    aria-label="Part"
                    data-testid={`part-name-${row.id}`}
                    value={row.part}
                    onChange={(e) => updateRow(row.id, { part: e.target.value })}
                    style={cellInputStyle}
                  />
                </td>
                <td style={bodyCellStyle}>
                  <input
                    type="text"
                    aria-label="Part number"
                    data-testid={`part-number-${row.id}`}
                    value={row.partNumber}
                    onChange={(e) => updateRow(row.id, { partNumber: e.target.value })}
                    style={cellInputStyle}
                  />
                </td>
                <td style={bodyCellStyle}>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label="Quantity"
                    data-testid={`part-qty-${row.id}`}
                    value={row.quantity}
                    onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                    style={cellInputStyle}
                  />
                </td>
                <td style={{ ...bodyCellStyle, textAlign: "center" }}>
                  <button
                    type="button"
                    aria-label="Remove part"
                    data-testid={`part-remove-${row.id}`}
                    onClick={() => removeRow(row.id)}
                    className="rm-no-print"
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      fontSize: fontSize.base,
                      borderRadius: radius.sm,
                      border: `1px solid ${colors.border}`,
                      background: colors.surface,
                      color: colors.dangerText,
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <button
        type="button"
        data-testid="parts-add-row"
        onClick={addRow}
        className="rm-no-print"
        style={{
          minHeight: 44,
          padding: `${spacing.sm}px ${spacing.lg}px`,
          fontSize: fontSize.base,
          borderRadius: radius.md,
          background: colors.surface,
          color: colors.primary,
          border: `1px solid ${colors.primary}`,
          cursor: "pointer",
        }}
      >
        + Add part
      </button>
    </section>
  );
}

const headCellStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: fontSize.sm,
  color: colors.textMuted,
  padding: `${spacing.xs}px ${spacing.sm}px`,
  borderBottom: `1px solid ${colors.borderSubtle}`,
};

const bodyCellStyle: React.CSSProperties = {
  padding: `${spacing.xs}px ${spacing.sm}px`,
  verticalAlign: "middle",
};
