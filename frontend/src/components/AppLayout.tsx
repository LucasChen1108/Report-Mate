import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useAuth } from "../auth/AuthProvider";
import { USER_ROLES } from "../auth/contracts";
import { ROUTES } from "../config/routes";
import { useTemplateDraft } from "../contexts/TemplateDraftContext";
import type { ReportPreviewNavigationState } from "../routing/navigationState";
import { colors, fontSize, radius, spacing } from "../styles/tokens";

const linkStyle = ({ isActive }: { isActive: boolean }): CSSProperties => ({
  minHeight: 44,
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
  const { user, logout } = useAuth();
  const { draft } = useTemplateDraft();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const logoutPendingRef = useRef(false);

  if (!user) return null;

  const previewDraft = () => {
    if (!draft) return;

    const state: ReportPreviewNavigationState = {
      previewTemplateDraft: true,
    };
    navigate(ROUTES.generateReport, { state });
  };

  const handleLogout = async () => {
    if (logoutPendingRef.current) return;

    logoutPendingRef.current = true;
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // AuthProvider clears frontend identity even if remote logout fails.
    } finally {
      navigate(ROUTES.login, { replace: true });
    }
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

        <NavLink to={ROUTES.generateReport} style={linkStyle}>
          Generate Report
        </NavLink>
        {user.role === USER_ROLES.admin ? (
          <>
            <NavLink to={ROUTES.templates} style={linkStyle}>
              Templates
            </NavLink>
            <NavLink to={ROUTES.workers} style={linkStyle}>
              Workers
            </NavLink>
          </>
        ) : (
          <NavLink to={ROUTES.profile} style={linkStyle}>
            My Profile
          </NavLink>
        )}
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          style={{
            marginLeft: "auto",
            minHeight: 44,
            padding: `${spacing.xs}px ${spacing.md}px`,
            fontSize: fontSize.base,
            borderRadius: radius.md,
            border: `1px solid ${colors.onPrimary}`,
            background: "transparent",
            color: colors.onPrimary,
            cursor: isLoggingOut ? "wait" : "pointer",
            opacity: isLoggingOut ? 0.7 : 1,
          }}
        >
          {isLoggingOut ? "Logging out…" : "Logout"}
        </button>
      </nav>

      {user.role === USER_ROLES.admin && draft && (
        <div
          className="rm-no-print"
          aria-label="Template tools"
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: `${spacing.sm}px ${spacing.lg}px 0`,
          }}
        >
          <button
            type="button"
            onClick={previewDraft}
            title="Render the template you're building"
            style={{
              minHeight: 44,
              padding: `${spacing.xs}px ${spacing.md}px`,
              fontSize: fontSize.sm,
              borderRadius: radius.md,
              border: `1px solid ${colors.primary}`,
              background: colors.onPrimary,
              color: colors.primary,
              cursor: "pointer",
            }}
          >
            Preview builder template in renderer →
          </button>
        </div>
      )}

      <Outlet />
    </div>
  );
}
