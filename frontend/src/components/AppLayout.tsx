import { NavLink, Outlet, useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";
import { ROUTES } from "../config/routes";
import { useTemplateDraft } from "../contexts/TemplateDraftContext";
import type { ReportPreviewNavigationState } from "../routing/navigationState";
import { colors, fontSize, radius, spacing } from "../styles/tokens";

const linkStyle = ({ isActive }: { isActive: boolean }): CSSProperties => ({
  minHeight: 40,
  display: "inline-flex",
  alignItems: "center",
  padding: `${spacing.xs}px ${spacing.md}px`,
  fontSize: fontSize.base,
  borderRadius: radius.md,
  border: `1px solid ${colors.onPrimary}`,
  background: isActive ? colors.onPrimary : "transparent",
  color: isActive ? colors.primary : colors.onPrimary,
  fontWeight: isActive ? 700 : 400,
  textDecoration: "none",
});

export function AppLayout() {
  const navigate = useNavigate();
  const { draft } = useTemplateDraft();

  const previewDraft = () => {
    if (!draft) return;

    const state: ReportPreviewNavigationState = {
      previewTemplateDraft: true,
    };
    navigate(ROUTES.generateReport, { state });
  };

  return (
    <div>
      <nav
        aria-label="Application"
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
        <strong style={{ fontSize: fontSize.lg, marginRight: spacing.md }}>
          Report Mate
        </strong>

        <NavLink to={ROUTES.templates} style={linkStyle}>
          Templates
        </NavLink>
        <NavLink to={ROUTES.generateReport} style={linkStyle}>
          Generate Report
        </NavLink>

        <button
          type="button"
          onClick={previewDraft}
          disabled={!draft}
          title={draft ? "Render the template you're building" : "Edit a template first"}
          style={{
            marginLeft: "auto",
            minHeight: 40,
            padding: `${spacing.xs}px ${spacing.md}px`,
            fontSize: fontSize.sm,
            borderRadius: radius.md,
            border: `1px solid ${colors.onPrimary}`,
            background: "transparent",
            color: colors.onPrimary,
            cursor: draft ? "pointer" : "not-allowed",
            opacity: draft ? 1 : 0.6,
          }}
        >
          Preview builder template in renderer →
        </button>
      </nav>

      <Outlet />
    </div>
  );
}
