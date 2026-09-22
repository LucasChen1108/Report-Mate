// ReportEditorPage — the interactive Report Renderer fill surface.
//
// Renders a template schema + report content as an EDITABLE A4 document: each
// section becomes a break-avoid block, each field renders its typed control via
// FieldRenderer, and the Parts Used table hangs off the report separately
// (handoff decision 2). Editing works throughout — this is a fill surface, not a
// read-only preview.
//
// -----------------------------------------------------------------------------
// WHERE THE SCHEMA COMES FROM — three modes, one renderer
//
//   report    (normal)  ReportEditorRoute loaded a ReportRecord from the API and
//                       passes it in. The document renders from the record's
//                       schemaSnapshot — the template AS IT WAS at fill time —
//                       so editing a template later never retroactively rewrites
//                       a submitted report. Saving is enabled.
//
//   external  (preview) A host shell passes a TemplateSchema directly (the
//                       Template Builder previewing its live working template).
//                       Nothing to save to, so the save actions are disabled.
//
//   fixture   (dev)     ?fixture=hvac. The bundled seed fixtures, no backend at
//                       all. KEPT ON PURPOSE: it is how the renderer stays
//                       developable while the reports API is down, and the HVAC
//                       fixture is the only template exercising all six field
//                       types in one document. Saving is disabled here too.
//
// The three differ ONLY in where `schema` and the initial content come from.
// Everything below that line is identical, which is the point — the dev harness
// exercises the same rendering path as a real report.
// -----------------------------------------------------------------------------
//
// SAVE MODEL: the draft row already exists by the time this page renders (the
// route creates it up front), so there is no create-vs-update branch here —
// every save is a PUT.
//
//   Save draft       saveReport(). No required-field check, stays on the page.
//                    A technician mid-job must be able to park a half-filled
//                    report.
//   Save and Export  validate -> saveAndExportReport() -> print -> navigate to
//                    the template's dashboard. See handleSaveAndExport for why
//                    that order is load-bearing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReportRecord } from "../../api/reportTypes";
import type { TemplateSchema } from "../../api/types";
import {
  ApiAuthorizationError,
  ApiError,
  ApiValidationError,
  saveAndExportReport,
  saveReport,
} from "../../api/reports";
import type { AgentFillResponse } from "../../api/agent";
import { colors, fontSize, radius, spacing } from "../../styles/tokens";
import { A4Document, A4Page, ReportHeader } from "./A4Document";
import { AgentAssistPanel } from "./AgentAssistPanel";
import { FieldRenderer } from "./FieldRenderer";
import { PartsUsedSection } from "./PartsUsedSection";
import { seedFixtures, sampleHvacContent } from "./fixtures";
import type { FieldValue, PartRow, ReportContent } from "./reportContent";
import {
  contentFromWire,
  contentToWire,
  emptyContentForSchema,
  findMissingRequiredFields,
} from "./reportContent";

// What the toolbar surfaces after an action. Mirrors the Template Builder's
// SaveStatus deliberately — a 422 carries the offending `elementId`, and the
// renderer highlights that element the same way the builder names it, rather
// than inventing a second error vocabulary for the same backend response.
type SaveStatus =
  | { kind: "idle" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string; elementId?: string | null };

// Which action is in flight. Both buttons are disabled for either, so a
// double-tap cannot race two writes at the same report.
type Busy = "none" | "draft" | "export";

interface ReportEditorPageProps {
  // MODE: report. The loaded record — its schemaSnapshot drives the document and
  // its id is the save target.
  report?: ReportRecord;
  // Display name of the template the report was filled against. ReportRecord
  // carries a title but not the template's name, so the route passes it down
  // from the template it fetched.
  templateName?: string;

  // MODE: external. An external template to render instead — e.g. a template
  // being built live in the Template Builder, passed through the app shell.
  // When provided, the fixture switcher is hidden and this schema drives the
  // document. Kept working: the builder's preview seam is not this agent's to
  // remove.
  externalSchema?: TemplateSchema;
  externalName?: string;

  // MODE: fixture. Which bundled seed fixture to render (the ?fixture= dev
  // escape hatch). Absent -> the first fixture, when no other mode applies.
  fixtureId?: string;
}

export function ReportEditorPage({
  report,
  templateName,
  externalSchema,
  externalName,
  fixtureId: initialFixtureId,
}: ReportEditorPageProps = {}) {
  const navigate = useNavigate();

  const usingReport = report !== undefined;
  const usingExternal = !usingReport && externalSchema !== undefined;
  // Saving needs a report id; the other two modes are preview/dev harnesses.
  const canSave = usingReport;

  // --- Mode: fixture ---------------------------------------------------------
  // Which seed template the dev harness has loaded. Defaults to HVAC (the only
  // fixture exercising all six field types).
  const [fixtureId, setFixtureId] = useState<string>(
    () =>
      seedFixtures.find((f) => f.id === initialFixtureId)?.id ??
      seedFixtures[0].id,
  );
  const fixture = useMemo(
    () => seedFixtures.find((f) => f.id === fixtureId) ?? seedFixtures[0],
    [fixtureId],
  );

  // --- The active schema + display name --------------------------------------
  const schema: TemplateSchema = usingReport
    ? report.schemaSnapshot
    : usingExternal
      ? externalSchema
      : fixture.schema;

  const displayName = usingReport
    ? templateName || report.title || "Report"
    : usingExternal
      ? externalName || "Untitled template"
      : fixture.name;

  // --- Content ---------------------------------------------------------------
  // Report content, keyed by field id. A loaded report's stored content is
  // narrowed to the UI value union ONCE, here at the boundary (see
  // reportContent.ts); the dev HVAC fixture starts partially filled so the
  // harness shows realistic data; everything else starts empty.
  const [content, setContent] = useState<ReportContent>(() => {
    if (report) return contentFromWire(report.schemaSnapshot, report.content);
    if (externalSchema) return emptyContentForSchema(externalSchema);
    return fixtureId === "hvac"
      ? sampleHvacContent()
      : emptyContentForSchema(fixture.schema);
  });

  // The customer this report is for. Jobs are not built yet, so nothing else
  // populates this — without the input below, the dashboard's Customer column
  // is permanently empty. Sent as `customerName` on every save.
  const [customerName, setCustomerName] = useState<string>(
    () => report?.customerName ?? "",
  );

  // Reload content when the route swaps in a different report (a navigation
  // between two report ids reuses this component).
  const loadedReportId = useRef<string | undefined>(report?.id);
  useEffect(() => {
    if (!report) return;
    if (loadedReportId.current === report.id) return;
    loadedReportId.current = report.id;
    setContent(contentFromWire(report.schemaSnapshot, report.content));
    setCustomerName(report.customerName ?? "");
  }, [report]);

  // When the external schema changes (live edits in the Builder), rebuild empty
  // content for it so every current field id has a correctly-shaped value and
  // removed fields drop out. Only runs in external mode.
  useEffect(() => {
    if (externalSchema) setContent(emptyContentForSchema(externalSchema));
  }, [externalSchema]);

  const loadFixture = (id: string) => {
    const next = seedFixtures.find((f) => f.id === id) ?? seedFixtures[0];
    setFixtureId(id);
    setContent(id === "hvac" ? sampleHvacContent() : emptyContentForSchema(next.schema));
  };

  // --- Save state ------------------------------------------------------------
  const [busy, setBusy] = useState<Busy>("none");
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  // The field to call out: either a required field caught client-side or the
  // elementId the backend named in a 422.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // The set of field ids the agent flagged as unfillable on its last run — the
  // required fields it could not confidently fill, plus any required
  // photo/signature fields that need human capture (Req 3.2, 3.4). Highlighted
  // the same way as `highlightedId` but as a set, so the whole set stays lit
  // for review rather than just one field. Kept separate from `highlightedId`
  // so the save-validation highlight and the agent flags do not clobber each
  // other.
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(
    () => new Set<string>(),
  );

  // DOM nodes of the field wrappers, so a highlight can scroll to its field
  // without a document-wide query.
  const fieldNodes = useRef<Record<string, HTMLDivElement | null>>({});

  // Scroll the highlighted field into view once it is set. Runs after commit,
  // so the node is mounted and already carries its highlight styling.
  useEffect(() => {
    if (!highlightedId) return;
    const node = fieldNodes.current[highlightedId];
    if (!node) return;
    // Optional-called: not every environment implements scrollIntoView (jsdom
    // does not), and failing to scroll must never break the highlight itself.
    node.scrollIntoView?.({ behavior: "smooth", block: "center" });
    // Move focus to the first control inside it, so the highlight is not purely
    // visual — a keyboard or screen-reader user lands on the offending field.
    const control = node.querySelector<HTMLElement>(
      "input, textarea, select, button, canvas",
    );
    control?.focus({ preventScroll: true });
  }, [highlightedId]);

  // Any edit clears a stale saved indicator and a stale highlight: the value the
  // error referred to may be exactly what just changed.
  const noteEdit = useCallback(() => {
    setStatus((prev) => (prev.kind === "idle" ? prev : { kind: "idle" }));
    setHighlightedId((prev) => (prev === null ? prev : null));
  }, []);

  // Write one field's value back into the content map.
  const setFieldValue = useCallback(
    (fieldId: string, next: FieldValue) => {
      noteEdit();
      // Once the technician edits a field the agent flagged, drop it from the
      // flagged set — they have addressed it, so it should stop reading as
      // "needs attention".
      setFlaggedIds((prev) => {
        if (!prev.has(fieldId)) return prev;
        const nextSet = new Set(prev);
        nextSet.delete(fieldId);
        return nextSet;
      });
      setContent((prev) => ({ ...prev, values: { ...prev.values, [fieldId]: next } }));
    },
    [noteEdit],
  );

  // Replace the Parts Used rows.
  const setParts = useCallback(
    (next: PartRow[]) => {
      noteEdit();
      setContent((prev) => ({ ...prev, parts: next }));
    },
    [noteEdit],
  );

  // The agent finished a run and handed back the (reloaded) draft. Load its
  // content into the SAME editor state a loaded report goes through, so the
  // agent-filled draft lands in the existing review/edit surface (Req 4.3) —
  // the technician stays the author of record. Then light up the fields the
  // agent flagged as unfillable so they know exactly what still needs them
  // (Req 3.2, 3.4). This is purely additive: the manual Save draft / Save and
  // Export flow is untouched (Req 9.5).
  const handleAgentFilled = useCallback((response: AgentFillResponse) => {
    const filled = response.report;
    setContent(contentFromWire(filled.schemaSnapshot, filled.content));
    setCustomerName(filled.customerName ?? "");
    setFlaggedIds(new Set(response.flaggedFieldIds));
    // Clear any stale save-validation highlight — the content just changed
    // wholesale, so a single old highlight no longer refers to anything.
    setHighlightedId(null);
    // A fresh draft from the agent has nothing saved yet; drop a stale
    // saved-at indicator without inventing a new status.
    setStatus((prev) => (prev.kind === "idle" ? prev : { kind: "idle" }));
  }, []);

  // Map any rejection from the report client to a status. Kept in one place so
  // the draft and export paths report failures identically — the one thing that
  // must never happen here is a silent failed save on a filled-out report.
  const reportFailure = (err: unknown) => {
    if (err instanceof ApiValidationError) {
      // 422: the backend names the offending element. Highlight it (the field
      // may be one the client-side check could not know about) and surface the
      // message — the same handling the Template Builder gives this response.
      setHighlightedId(err.elementId);
      setStatus({ kind: "error", message: err.message, elementId: err.elementId });
      return;
    }
    if (err instanceof ApiAuthorizationError || err instanceof ApiError) {
      setStatus({ kind: "error", message: err.message });
      return;
    }
    setStatus({
      kind: "error",
      message:
        err instanceof Error
          ? err.message
          : "Could not save the report. Your entries are still here — try again.",
    });
  };

  // The body both save endpoints take. `contentToWire` is the single widening
  // point from the UI value union back to the wire shape.
  const savePayload = () => ({
    content: contentToWire(content),
    customerName: customerName.trim(),
  });

  // --- Save draft ------------------------------------------------------------
  // A plain PUT with NO required-field check: parking a half-filled report is
  // the whole point of a draft.
  const handleSaveDraft = async () => {
    if (!report || busy !== "none") return;
    setBusy("draft");
    setStatus({ kind: "idle" });
    try {
      await saveReport(report.id, savePayload());
      setStatus({ kind: "saved", at: new Date() });
    } catch (err) {
      reportFailure(err);
    } finally {
      setBusy("none");
    }
  };

  // --- Save and Export -------------------------------------------------------
  // The ordering below is load-bearing:
  //
  //   1. Client-side required-field check. On failure, highlight the FIRST
  //      missing field, scroll to it, and STOP — no network call. A round trip
  //      to be told what the form already knows is a round trip on a phone
  //      halfway up a roof.
  //   2. Persist via save-and-export (the backend re-validates; it is the source
  //      of truth, step 1 is only there to save the trip).
  //   3. Print.
  //   4. THEN navigate to the template's dashboard.
  //
  // Steps 3 and 4 must not be swapped. Navigating first unmounts the document
  // out from under the print preview and the user prints a blank dashboard, so
  // the navigation waits for the print dialog to resolve.
  const handleSaveAndExport = async () => {
    if (!report || busy !== "none") return;

    const missing = findMissingRequiredFields(schema, content);
    if (missing.length > 0) {
      const first = missing[0];
      setHighlightedId(first.fieldId);
      setStatus({
        kind: "error",
        message:
          missing.length === 1
            ? `"${first.label}" is required before exporting.`
            : `${missing.length} required fields are empty. First: "${first.label}" (${first.sectionLabel}).`,
        elementId: first.fieldId,
      });
      return; // No network call.
    }

    setBusy("export");
    setStatus({ kind: "idle" });
    setHighlightedId(null);
    try {
      await saveAndExportReport(report.id, savePayload());
    } catch (err) {
      reportFailure(err);
      setBusy("none");
      return;
    }

    // Saved. Print, wait for the dialog to close, then leave.
    await printAndWait();
    navigate(
      `/dashboard/templates/${encodeURIComponent(report.templateId)}?highlight=${encodeURIComponent(report.id)}`,
    );
  };

  const metaLines = [
    `Template: ${displayName}`,
    `Customer: ${customerName.trim() || "—"}`,
    `Filled by: ${content.filledBy}`,
    `Generated: ${new Date().toLocaleDateString()}`,
  ];

  const working = busy !== "none";

  return (
    <div>
      {/* Editor-only toolbar — hidden in print/export via .rm-no-print. */}
      <div
        className="rm-no-print"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing.md,
          padding: `${spacing.sm}px ${spacing.lg}px`,
          background: colors.surface,
          borderBottom: `1px solid ${colors.borderSubtle}`,
        }}
      >
        <strong style={{ fontSize: fontSize.base, color: colors.text }}>
          Report Renderer
        </strong>

        {usingReport ? (
          <span style={{ fontSize: fontSize.sm, color: colors.textMuted }}>
            Filling: <strong style={{ color: colors.text }}>{displayName}</strong>
          </span>
        ) : usingExternal ? (
          <span style={{ fontSize: fontSize.sm, color: colors.textMuted }}>
            Previewing: <strong style={{ color: colors.text }}>{displayName}</strong>
          </span>
        ) : (
          <label style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
            <span style={{ fontSize: fontSize.sm, color: colors.textMuted }}>Template</span>
            <select
              data-testid="fixture-switcher"
              value={fixtureId}
              onChange={(e) => loadFixture(e.target.value)}
              style={{
                minHeight: 44,
                fontSize: fontSize.base,
                padding: `${spacing.xs}px ${spacing.sm}px`,
                borderRadius: radius.md,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
              }}
            >
              {seedFixtures.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <button
            type="button"
            data-testid="save-draft-button"
            onClick={() => void handleSaveDraft()}
            disabled={!canSave || working}
            title={canSave ? undefined : "Preview mode — there is no report to save to."}
            style={{
              minHeight: 44,
              padding: `${spacing.sm}px ${spacing.lg}px`,
              fontSize: fontSize.base,
              borderRadius: radius.md,
              background: colors.surface,
              color: !canSave || working ? colors.textMuted : colors.primary,
              border: `1px solid ${!canSave || working ? colors.borderSubtle : colors.primary}`,
              cursor: !canSave || working ? "default" : "pointer",
            }}
          >
            {busy === "draft" ? "Saving…" : "Save draft"}
          </button>

          <button
            type="button"
            data-testid="save-and-export-button"
            onClick={() => void handleSaveAndExport()}
            disabled={!canSave || working}
            title={canSave ? undefined : "Preview mode — there is no report to save to."}
            style={{
              minHeight: 44,
              padding: `${spacing.sm}px ${spacing.lg}px`,
              fontSize: fontSize.base,
              borderRadius: radius.md,
              background: !canSave || working ? colors.textMuted : colors.primary,
              color: colors.onPrimary,
              border: `1px solid ${!canSave || working ? colors.textMuted : colors.primaryHover}`,
              cursor: !canSave || working ? "default" : "pointer",
            }}
          >
            {busy === "export" ? "Saving…" : "Save and Export"}
          </button>
        </div>

        {/* Status line: a saved-at indicator or a visible failure. Full width so
            a long validation message is not clipped by the toolbar row. */}
        {status.kind === "saved" && (
          <p
            role="status"
            data-testid="report-save-status"
            style={{
              flexBasis: "100%",
              margin: 0,
              fontSize: fontSize.sm,
              color: colors.successText,
            }}
          >
            Draft saved at {status.at.toLocaleTimeString()}
          </p>
        )}

        {status.kind === "error" && (
          <p
            role="alert"
            data-testid="report-save-error"
            style={{
              flexBasis: "100%",
              margin: 0,
              fontSize: fontSize.sm,
              color: colors.dangerText,
            }}
          >
            {status.message}
            {status.elementId ? (
              <>
                {" "}
                <span data-testid="report-save-error-element-id">
                  (field: {status.elementId})
                </span>
              </>
            ) : null}
          </p>
        )}

        {!canSave && (
          <p
            style={{
              flexBasis: "100%",
              margin: 0,
              fontSize: fontSize.xs,
              color: colors.textMuted,
            }}
          >
            Preview mode — no report is loaded, so saving is disabled.
          </p>
        )}
      </div>

      {/* The A4 document. One sheet for now; the CSS paginates overflow across
          physical pages on print/export. */}
      <A4Document>
        <A4Page pageNumber={1}>
          <ReportHeader templateName={displayName} metaLines={metaLines} />

          {/* AI assist — only in `report` mode: it needs a persisted report id
              to run against, so it is hidden in external (builder preview) and
              fixture (dev) modes, gated the same way the Save actions are on
              `usingReport`. The panel is additive: it owns its own in-flight /
              error state and hands the finished draft back through
              handleAgentFilled, so the manual fill path stays fully
              independent of the agent (Req 9.5). */}
          {usingReport && report && (
            <AgentAssistPanel reportId={report.id} onFilled={handleAgentFilled} />
          )}

          {/* Customer — an editable header field, not a schema field. Jobs are
              not built yet, so this is the only thing that populates the
              dashboard's Customer column. Hidden from the printed document,
              which shows the value through the meta line above. */}
          <label
            className="rm-no-print"
            htmlFor="report-customer-name"
            style={{ display: "block", marginBottom: spacing.xl }}
          >
            <span
              style={{
                display: "block",
                marginBottom: spacing.xs,
                fontSize: fontSize.sm,
                color: colors.textMuted,
              }}
            >
              Customer
            </span>
            <input
              id="report-customer-name"
              data-testid="report-customer-name"
              type="text"
              value={customerName}
              placeholder="Who is this report for?"
              onChange={(e) => {
                noteEdit();
                setCustomerName(e.target.value);
              }}
              style={{
                display: "block",
                width: "100%",
                minHeight: 44,
                fontSize: fontSize.base,
                padding: `${spacing.sm}px ${spacing.md}px`,
                borderRadius: radius.md,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
              }}
            />
          </label>

          {schema.sections.map((section) => (
            <section
              key={section.id}
              className="rm-report-section"
              data-testid={`section-${section.id}`}
              aria-label={section.label}
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
                {section.label}
              </h2>

              {section.fields.length === 0 ? (
                <p style={{ margin: 0, color: colors.textMuted, fontSize: fontSize.sm }}>
                  No fields in this section.
                </p>
              ) : (
                section.fields.map((field) => {
                  // A field reads as "needs attention" if it is the single
                  // save-validation highlight OR one of the agent's flagged
                  // fields (Req 3.2, 3.4).
                  const highlighted =
                    highlightedId === field.id || flaggedIds.has(field.id);
                  return (
                    <div
                      key={field.id}
                      ref={(node) => {
                        fieldNodes.current[field.id] = node;
                      }}
                      className="rm-report-field"
                      data-testid={`field-${field.id}`}
                      data-highlighted={highlighted ? "true" : undefined}
                      style={
                        highlighted
                          ? {
                              // Highlight the offending field: a tinted panel
                              // with a heavy left rule, so it reads as "this
                              // one" at arm's length in daylight. Negative
                              // margins keep the document's field rhythm.
                              margin: `0 -${spacing.md}px ${spacing.lg}px`,
                              padding: `${spacing.md}px`,
                              borderRadius: radius.md,
                              borderLeft: `4px solid ${colors.dangerText}`,
                              background: colors.dropHighlight,
                            }
                          : undefined
                      }
                    >
                      <FieldRenderer
                        field={field}
                        value={content.values[field.id]}
                        onChange={setFieldValue}
                      />
                    </div>
                  );
                })
              )}
            </section>
          ))}

          {/* Parts Used — a first-class section backed by content.parts, not a
              schema field (handoff decision 2). */}
          <PartsUsedSection parts={content.parts} onChange={setParts} />
        </A4Page>
      </A4Document>
    </div>
  );
}

// Print, and resolve once the print dialog has closed.
//
// window.print() blocks until the dialog resolves in most browsers, but not in
// all of them (Safari and some mobile browsers return immediately and fire
// `afterprint` later). Since the navigation that follows would unmount the
// document mid-preview, we wait for whichever signal arrives first and cap the
// wait so a browser that fires neither cannot strand the user on a report they
// already exported.
function printAndWait(timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("afterprint", finish);
      window.clearTimeout(timer);
      resolve();
    };

    const timer = window.setTimeout(finish, timeoutMs);
    window.addEventListener("afterprint", finish);

    try {
      window.print();
    } catch {
      // A browser that refuses to print should not block the navigation.
      finish();
      return;
    }

    // If print() blocked, `afterprint` has already fired inside that call and
    // `finish` ran — the promise is resolved. If it did not block, the listener
    // above is still armed and resolves when the dialog closes. The timeout
    // covers the browser that does neither.
  });
}

export default ReportEditorPage;
