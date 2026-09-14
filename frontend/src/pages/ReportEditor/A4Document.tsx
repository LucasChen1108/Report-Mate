// A4Document / A4Page — the paginated A4 layout shell for the Report Renderer.
//
// A4Document is the grey preview backdrop that holds one or more A4Page sheets.
// A4Page is a single 210x297mm sheet (see reportEditor.css for the geometry and
// the print/pagination rules).
//
// Pagination model (CSS-based, the chosen approach): a caller MAY split content
// into multiple <A4Page> sheets explicitly, but it does not have to. A single
// tall <A4Page> will paginate across physical pages on print/export via the
// break-* rules in reportEditor.css — a field/section is not sliced mid-way
// where avoidable. So the sheet count on screen is a preview convenience, and
// correctness of page breaks is owned by the CSS, not by manual measurement.

import type { ReactNode } from "react";
import "./reportEditor.css";

// --- A4Document ------------------------------------------------------------
interface A4DocumentProps {
  children: ReactNode;
}

/** The scrollable grey canvas that holds the A4 sheets. */
export function A4Document({ children }: A4DocumentProps) {
  return (
    <div className="rm-a4-canvas" data-testid="a4-document">
      {children}
    </div>
  );
}

// --- A4Page ----------------------------------------------------------------
interface A4PageProps {
  children: ReactNode;
  /** 1-based page number, shown in a footer for the preview. */
  pageNumber?: number;
}

/** A single A4 sheet. */
export function A4Page({ children, pageNumber }: A4PageProps) {
  return (
    <article className="rm-a4-page" data-testid="a4-page">
      {children}
      {pageNumber !== undefined && (
        <footer
          className="rm-a4-page-footer"
          style={{
            marginTop: "auto",
            paddingTop: "8mm",
            textAlign: "right",
            fontSize: "var(--rm-font-xs)",
            color: "var(--rm-color-text-muted)",
          }}
        >
          Page {pageNumber}
        </footer>
      )}
    </article>
  );
}

// --- ReportHeader ----------------------------------------------------------
interface ReportHeaderProps {
  templateName: string;
  /** Optional right-aligned meta lines (e.g. job id, date, technician). */
  metaLines?: string[];
}

/** The document header block at the top of the report's first sheet. */
export function ReportHeader({ templateName, metaLines = [] }: ReportHeaderProps) {
  return (
    <header className="rm-report-header" data-testid="report-header">
      <h1>{templateName}</h1>
      {metaLines.map((line, i) => (
        <p className="rm-report-meta" key={i}>
          {line}
        </p>
      ))}
    </header>
  );
}
