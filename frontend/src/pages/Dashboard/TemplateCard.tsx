// TemplateCard — one template's rollup on /dashboard.
//
// Shows the template's name, its Seed badge, how many reports have been filed
// against it (and how many of those are still drafts), when it was last used,
// and the two ways forward: view the reports, or start a new one.
//
// WHY A ZERO-REPORT TEMPLATE STILL RENDERS A CARD
//
// The obvious design hides templates nobody has used, which would make this
// grid a list of "things with history". But a technician's first question on a
// new job is "which form do I fill in?", and a template with no reports yet is
// the MOST likely answer to it — it is new. So an unused template keeps its
// card and leads with the "Start a report" action instead of "View reports".
// The card is a launcher that happens to show history, not a history entry.
//
// Presentational: it receives a rollup and renders it. All fetching is in
// useDashboard.ts.

import { Link } from "react-router-dom";
import type { DashboardTemplateRollup } from "../../api/reportTypes";
import {
  colors,
  fontSize,
  radius,
  spacing,
  MIN_TAP_TARGET,
} from "../../styles/tokens";
import { formatRelativeTime } from "./format";

export interface TemplateCardProps {
  rollup: DashboardTemplateRollup;
}

export function TemplateCard({ rollup }: TemplateCardProps) {
  const hasReports = rollup.reportCount > 0;
  const reportsHref = `/dashboard/templates/${encodeURIComponent(rollup.templateId)}`;
  const newReportHref = `/reports/new?templateId=${encodeURIComponent(rollup.templateId)}`;

  return (
    <article
      data-testid="template-card"
      data-template-id={rollup.templateId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
        padding: spacing.lg,
        background: colors.surface,
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: radius.lg,
      }}
    >
      <header style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" }}>
        <h3
          style={{
            margin: 0,
            fontSize: fontSize.lg,
            color: colors.text,
            // Long template names must wrap, not push the card wide enough to
            // make the grid scroll sideways on a phone.
            wordBreak: "break-word",
            minWidth: 0,
          }}
        >
          {rollup.name}
        </h3>
        {rollup.isSeed && <SeedBadge />}
      </header>

      <dl
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: `${spacing.sm}px ${spacing.xl}px`,
          margin: 0,
        }}
      >
        <Stat label="Reports" value={String(rollup.reportCount)} />
        <Stat
          label="Drafts"
          value={String(rollup.draftCount)}
          // Drafts are unfinished work: worth the eye-catch when there are any.
          emphasis={rollup.draftCount > 0}
        />
        <Stat label="Last activity" value={formatRelativeTime(rollup.lastReportAt)} />
      </dl>

      <p
        style={{
          margin: 0,
          fontSize: fontSize.xs,
          color: colors.textMuted,
        }}
      >
        {hasReports
          ? `Revision ${rollup.revision} · ${rollup.submittedCount} submitted · ${rollup.exportedCount} exported`
          : `Revision ${rollup.revision} · no reports filed yet`}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm, marginTop: "auto" }}>
        {/* Action order flips with usage: a used template leads with its
            history, an unused one leads with the way to give it some. */}
        {hasReports ? (
          <>
            <CardLink to={reportsHref} variant="primary" testId="view-reports-link">
              View reports
            </CardLink>
            <CardLink to={newReportHref} variant="secondary" testId="new-report-link">
              New report
            </CardLink>
          </>
        ) : (
          <>
            <CardLink to={newReportHref} variant="primary" testId="new-report-link">
              Start a report
            </CardLink>
            <CardLink to={reportsHref} variant="secondary" testId="view-reports-link">
              View reports
            </CardLink>
          </>
        )}
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: fontSize.xs, color: colors.textMuted, margin: 0 }}>
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: fontSize.lg,
          fontWeight: 600,
          color: emphasis ? colors.dangerText : colors.text,
        }}
      >
        {value}
      </dd>
    </div>
  );
}

export function SeedBadge() {
  return (
    <span
      data-testid="seed-badge"
      style={{
        fontSize: fontSize.xs,
        fontWeight: 600,
        padding: `2px ${spacing.sm}px`,
        borderRadius: 999,
        background: colors.seedBadgeBg,
        color: colors.primary,
        border: `1px solid ${colors.primary}`,
        whiteSpace: "nowrap",
      }}
    >
      Seed
    </span>
  );
}

// Links styled as buttons — navigation, so <Link>, never <button onClick=
// navigate>. Sized to the 44px tap minimum (Req 8.2) because these are the
// primary controls on a phone.
function CardLink({
  to,
  variant,
  testId,
  children,
}: {
  to: string;
  variant: "primary" | "secondary";
  testId: string;
  children: React.ReactNode;
}) {
  const isPrimary = variant === "primary";
  return (
    <Link
      to={to}
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: MIN_TAP_TARGET,
        padding: `${spacing.sm}px ${spacing.lg}px`,
        borderRadius: radius.md,
        fontSize: fontSize.base,
        fontWeight: 600,
        textDecoration: "none",
        background: isPrimary ? colors.primary : colors.surface,
        color: isPrimary ? colors.onPrimary : colors.primary,
        border: `1px solid ${isPrimary ? colors.primaryHover : colors.primary}`,
      }}
    >
      {children}
    </Link>
  );
}

export default TemplateCard;
