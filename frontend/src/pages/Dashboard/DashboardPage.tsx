// DashboardPage — /dashboard. The user's own report history, by template.
//
// Three summary tiles across the top, then one card per template: what it is,
// how much has been filed against it, when it was last touched, and the way
// into either its report table or a new report.
//
// WHAT THIS SCREEN IS FOR: answering "what have we been filing, and where do I
// go next?" in one glance, on a phone, standing next to a van. That is why the
// tiles are counts rather than charts, why "last activity" is relative time
// rather than a timestamp, and why every card carries an action — a dashboard
// you can only look at is a dead end.
//
// Templates with ZERO reports appear here too. See the note in TemplateCard.tsx
// for why that is deliberate rather than an oversight.
//
// All state lives in useDashboard.ts; this file lays out what it returns and
// makes sure each of loading / error / empty renders something intentional.

import { useDashboardRollups } from "./useDashboard";
import { TemplateCard } from "./TemplateCard";
import { EmptyState } from "./EmptyState";
import {
  colors,
  fontSize,
  radius,
  spacing,
  secondaryButtonStyle,
} from "../../styles/tokens";

export function DashboardPage() {
  const { rollups, totals, loading, error, reload } = useDashboardRollups();

  return (
    <main
      style={{
        // minWidth:0 at every level from here down is what keeps a wide child
        // (the report table on the next screen) from widening the page.
        minWidth: 0,
        maxWidth: 1100,
        margin: "0 auto",
        padding: spacing.lg,
        display: "flex",
        flexDirection: "column",
        gap: spacing.lg,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
        <h1 style={{ margin: 0, fontSize: fontSize.xl, color: colors.text }}>
          Dashboard
        </h1>
        <p style={{ margin: 0, fontSize: fontSize.base, color: colors.textMuted }}>
          Your reports, grouped by the template they were filed against.
        </p>
      </header>

      <SummaryTiles
        loading={loading}
        totals={[
          { label: "Reports", value: totals.reports },
          { label: "Drafts", value: totals.drafts, emphasis: totals.drafts > 0 },
          { label: "Templates in use", value: totals.templatesInUse },
        ]}
      />

      {loading && (
        <p data-testid="dashboard-loading" style={statusTextStyle} aria-live="polite">
          Loading your templates…
        </p>
      )}

      {!loading && error && (
        <EmptyState
          tone="error"
          title="We could not load your dashboard"
          message={error}
          primaryAction={{ label: "Try again", onClick: reload }}
        />
      )}

      {!loading && !error && rollups.length === 0 && (
        <EmptyState
          title="No templates yet"
          message="Report templates define the fields a technician fills in. Once a template exists, every report filed against it shows up here."
          primaryAction={{ label: "Go to templates", to: "/templates" }}
        />
      )}

      {!loading && !error && rollups.length > 0 && (
        <section
          data-testid="template-card-grid"
          aria-label="Templates"
          style={{
            display: "grid",
            // min(100%, 280px) rather than a flat 280px: on a 400px phone the
            // flat value can exceed the available track and push the page wide.
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
            gap: spacing.md,
          }}
        >
          {rollups.map((rollup) => (
            <TemplateCard key={rollup.templateId} rollup={rollup} />
          ))}
        </section>
      )}

      {!loading && !error && rollups.length > 0 && (
        <p style={{ margin: 0 }}>
          <button type="button" onClick={reload} style={secondaryButtonStyle}>
            Refresh
          </button>
        </p>
      )}
    </main>
  );
}

interface TileSpec {
  label: string;
  value: number;
  emphasis?: boolean;
}

// The tiles render during loading too, showing "—" instead of a number. Blanking
// the whole region on every refresh makes the layout jump; a placeholder keeps
// the shape stable and still says "not known yet".
function SummaryTiles({ totals, loading }: { totals: TileSpec[]; loading: boolean }) {
  return (
    <dl
      data-testid="summary-tiles"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
        gap: spacing.md,
        margin: 0,
      }}
    >
      {totals.map((tile) => (
        <div
          key={tile.label}
          data-testid="summary-tile"
          style={{
            padding: spacing.lg,
            background: colors.surface,
            border: `1px solid ${colors.borderSubtle}`,
            borderRadius: radius.lg,
          }}
        >
          <dt style={{ margin: 0, fontSize: fontSize.sm, color: colors.textMuted }}>
            {tile.label}
          </dt>
          <dd
            style={{
              margin: 0,
              fontSize: fontSize.xl,
              fontWeight: 700,
              color: tile.emphasis && !loading ? colors.dangerText : colors.text,
            }}
          >
            {loading ? "—" : tile.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const statusTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: fontSize.base,
  color: colors.textMuted,
};

export default DashboardPage;
