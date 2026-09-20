// ReportEditorPage — the interactive Report Renderer fill surface.
//
// Renders a template schema + report content as an EDITABLE A4 document: each
// section becomes a break-avoid block, each field renders its typed control via
// FieldRenderer, and the Parts Used table hangs off the report separately
// (handoff decision 2). Editing works throughout — this is a fill surface, not a
// read-only preview.
//
// STAGE: no backend. Content lives in React state, seeded from the mock fixtures
// (fixtures.ts, mirroring the Go seed templates). A fixture switcher in the
// editor-only toolbar lets you develop against all three seed templates. When
// the reports API lands, the fixture load is swapped for getTemplate()/getReport()
// through src/api — the component below is unchanged otherwise.
//
// EXPORT SEAM: the toolbar has an Export button. Right now it triggers the
// browser's print-to-PDF (window.print()), which honors the @page / break rules
// in reportEditor.css — a usable export today. The later task swaps this for a
// backend-generated PDF; the button/handler is the single seam to change.

import { useEffect, useMemo, useState } from "react";
import type { TemplateSchema } from "../../api/types";
import { colors, fontSize, radius, spacing } from "../../styles/tokens";
import { A4Document, A4Page, ReportHeader } from "./A4Document";
import { FieldRenderer } from "./FieldRenderer";
import { PartsUsedSection } from "./PartsUsedSection";
import { seedFixtures, sampleHvacContent } from "./fixtures";
import type { FieldValue, PartRow, ReportContent } from "./reportContent";
import { emptyContentForSchema } from "./reportContent";

interface ReportEditorPageProps {
  // Optional external template to render instead of the seed fixtures — e.g. a
  // template being built live in the Template Builder, passed through the app
  // shell. When provided, the fixture switcher is hidden and this schema drives
  // the document. Absent -> the standalone seed-fixture harness (default).
  externalSchema?: TemplateSchema;
  externalName?: string;
}

export function ReportEditorPage({
  externalSchema,
  externalName,
}: ReportEditorPageProps = {}) {
  const usingExternal = externalSchema !== undefined;

  // Which seed template is loaded. Defaults to HVAC (exercises all six types).
  const [fixtureId, setFixtureId] = useState<string>(seedFixtures[0].id);
  const fixture = useMemo(
    () => seedFixtures.find((f) => f.id === fixtureId) ?? seedFixtures[0],
    [fixtureId],
  );

  // The active schema + display name: an external (Builder) template when given,
  // otherwise the selected seed fixture.
  const schema: TemplateSchema = usingExternal ? externalSchema : fixture.schema;
  const displayName = usingExternal ? externalName || "Untitled template" : fixture.name;

  // Report content, keyed by field id. Seed HVAC starts partially-filled
  // (realistic preview); everything else starts empty.
  const [content, setContent] = useState<ReportContent>(() =>
    externalSchema ? emptyContentForSchema(externalSchema) : sampleHvacContent(),
  );

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

  // Write one field's value back into the content map.
  const setFieldValue = (fieldId: string, next: FieldValue) => {
    setContent((prev) => ({ ...prev, values: { ...prev.values, [fieldId]: next } }));
  };

  // Replace the Parts Used rows.
  const setParts = (next: PartRow[]) => {
    setContent((prev) => ({ ...prev, parts: next }));
  };

  // EXPORT SEAM — today: browser print-to-PDF (respects @page + break rules).
  // Later: POST to the backend reports export endpoint and download the PDF.
  const handleExport = () => {
    window.print();
  };

  const metaLines = [
    `Template: ${displayName}`,
    `Filled by: ${content.filledBy}`,
    `Generated: ${new Date().toLocaleDateString()}`,
  ];

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

        {usingExternal ? (
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

        <button
          type="button"
          data-testid="export-button"
          onClick={handleExport}
          style={{
            marginLeft: "auto",
            minHeight: 44,
            padding: `${spacing.sm}px ${spacing.lg}px`,
            fontSize: fontSize.base,
            borderRadius: radius.md,
            background: colors.primary,
            color: colors.onPrimary,
            border: `1px solid ${colors.primaryHover}`,
            cursor: "pointer",
          }}
        >
          Export (print to PDF)
        </button>
      </div>

      {/* The A4 document. One sheet for now; the CSS paginates overflow across
          physical pages on print/export. */}
      <A4Document>
        <A4Page pageNumber={1}>
          <ReportHeader templateName={displayName} metaLines={metaLines} />

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
                section.fields.map((field) => (
                  <div
                    key={field.id}
                    className="rm-report-field"
                    data-testid={`field-${field.id}`}
                  >
                    <FieldRenderer
                      field={field}
                      value={content.values[field.id]}
                      onChange={setFieldValue}
                    />
                  </div>
                ))
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

export default ReportEditorPage;
