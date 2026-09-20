// App — the top-level shell.
//
// The app has no router yet (task 11.3), so this shell is a lightweight nav that
// switches between the two built pages: the Template Builder (drag-and-drop
// editor) and the Report Renderer (interactive A4 fill surface).
//
// It also demonstrates that the renderer is schema-driven, not hardcoded: the
// Builder's live working schema is captured here via its optional
// onSchemaChange/onNameChange observers, and "Preview in renderer" feeds that
// exact schema into the Report Editor (in-memory, no backend). Sections/fields
// you add or rename in the Builder show up in the rendered document.
//
// When the backend + real router land, this shell is replaced by proper routes;
// the two pages themselves are unchanged.

import { useCallback, useState } from "react";
import type { TemplateSchema } from "./api/types";
import { TemplateBuilderPage } from "./pages/TemplateBuilder/TemplateBuilderPage";
import { ReportEditorPage } from "./pages/ReportEditor/ReportEditorPage";
import { colors, fontSize, radius, spacing } from "./styles/tokens";

type View = "builder" | "renderer";
// Renderer source: the seed-fixture harness, or the schema captured live from
// the Builder.
type RendererSource = "seeds" | "builder";

function App() {
  const [view, setView] = useState<View>("builder");
  const [rendererSource, setRendererSource] = useState<RendererSource>("seeds");

  // The Builder's live working schema/name, mirrored here via its observers.
  const [builderSchema, setBuilderSchema] = useState<TemplateSchema | undefined>();
  const [builderName, setBuilderName] = useState<string>("");

  // Stable callbacks so the Builder's effect deps don't churn each render.
  const handleSchemaChange = useCallback((s: TemplateSchema) => setBuilderSchema(s), []);
  const handleNameChange = useCallback((n: string) => setBuilderName(n), []);

  // Jump to the renderer showing the current Builder template.
  const previewInRenderer = () => {
    setRendererSource("builder");
    setView("renderer");
  };

  const external = rendererSource === "builder" ? builderSchema : undefined;

  return (
    <div>
      <nav
        className="rm-no-print"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing.sm,
          padding: `${spacing.sm}px ${spacing.lg}px`,
          background: colors.primary,
          color: colors.onPrimary,
        }}
      >
        <strong style={{ fontSize: fontSize.lg, marginRight: spacing.md }}>Report Mate</strong>

        <TabButton active={view === "builder"} onClick={() => setView("builder")}>
          Template Builder
        </TabButton>
        <TabButton
          active={view === "renderer"}
          onClick={() => {
            setRendererSource("seeds");
            setView("renderer");
          }}
        >
          Report Renderer
        </TabButton>

        {/* Cross-page action: render the template being built right now. */}
        <button
          type="button"
          onClick={previewInRenderer}
          disabled={!builderSchema}
          title={builderSchema ? "Render the template you're building" : "Edit a template first"}
          style={{
            marginLeft: "auto",
            minHeight: 40,
            padding: `${spacing.xs}px ${spacing.md}px`,
            fontSize: fontSize.sm,
            borderRadius: radius.md,
            border: `1px solid ${colors.onPrimary}`,
            background: "transparent",
            color: colors.onPrimary,
            cursor: builderSchema ? "pointer" : "not-allowed",
            opacity: builderSchema ? 1 : 0.6,
          }}
        >
          Preview builder template in renderer →
        </button>
      </nav>

      {view === "builder" ? (
        <TemplateBuilderPage
          onSchemaChange={handleSchemaChange}
          onNameChange={handleNameChange}
        />
      ) : (
        <ReportEditorPage externalSchema={external} externalName={builderName} />
      )}
    </div>
  );
}

// A single high-contrast nav tab.
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        minHeight: 40,
        padding: `${spacing.xs}px ${spacing.md}px`,
        fontSize: fontSize.base,
        borderRadius: radius.md,
        border: `1px solid ${colors.onPrimary}`,
        background: active ? colors.onPrimary : "transparent",
        color: active ? colors.primary : colors.onPrimary,
        fontWeight: active ? 700 : 400,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export default App;
