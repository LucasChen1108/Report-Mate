import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { useAuth } from "../auth/AuthProvider";
import { USER_ROLES } from "../auth/contracts";
import { ROUTES } from "../config/routes";
import { useTemplateDraft } from "../contexts/TemplateDraftContext";
import { useIsMobile } from "../hooks/useIsMobile";
import type { ReportPreviewNavigationState } from "../routing/navigationState";
import { colors, fontSize, radius, spacing } from "../styles/tokens";
import {
  GenerateReportIcon,
  LogoutIcon,
  MenuIcon,
  MyReportsIcon,
  ProfileIcon,
  TemplatesIcon,
  WorkersIcon,
} from "./NavIcons";

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

// A navigation destination shown in both the desktop top nav and the mobile
// bottom tab bar. Icon is the bottom-bar glyph; label is shared.
interface NavItem {
  to: string;
  label: string;
  Icon: (props: { size?: number }) => ReactElement;
}

export function AppLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { draft } = useTemplateDraft();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const logoutPendingRef = useRef(false);
  const isMobile = useIsMobile();

  if (!user) return null;

  const isAdmin = user.role === USER_ROLES.admin;

  // The role-aware destinations, in priority order. Generate Report is first
  // because creating/filling a report is the technician's primary action.
  const navItems: NavItem[] = [
    { to: ROUTES.generateReport, label: "Generate Report", Icon: GenerateReportIcon },
    { to: ROUTES.dashboard, label: "My Reports", Icon: MyReportsIcon },
    ...(isAdmin
      ? [
          { to: ROUTES.templates, label: "Templates", Icon: TemplatesIcon },
          { to: ROUTES.workers, label: "Workers", Icon: WorkersIcon },
        ]
      : [{ to: ROUTES.profile, label: "My Profile", Icon: ProfileIcon }]),
  ];

  const previewDraft = () => {
    if (!draft) return;
    const state: ReportPreviewNavigationState = { previewTemplateDraft: true };
    setMenuOpen(false);
    navigate(ROUTES.generateReport, { state });
  };

  // Navigation state for a nav item. Generate Report carries the preview state
  // when a builder draft exists, so clicking it opens that draft directly in the
  // report editor; with no draft it navigates plainly and the editor falls back
  // to the seed-fixture harness (option b). Every other item navigates plainly.
  const navStateFor = (to: string): ReportPreviewNavigationState | undefined =>
    to === ROUTES.generateReport && draft
      ? { previewTemplateDraft: true }
      : undefined;

  const handleLogout = async () => {
    if (logoutPendingRef.current) return;
    logoutPendingRef.current = true;
    setIsLoggingOut(true);
    setMenuOpen(false);
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
      {/* ---- Desktop / tablet top nav (>=600px), the original layout ----
          Rendered only on non-mobile so the DOM carries exactly one set of nav
          links (the mobile bottom bar renders the same destinations below). */}
      {!isMobile && (
      <nav
        aria-label="Application"
        className="rm-no-print rm-desktop-nav"
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

        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} state={navStateFor(item.to)} style={linkStyle}>
            {item.label}
          </NavLink>
        ))}

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
      )}

      {/* Admin-only "preview builder template" action — desktop placement,
          unchanged from before. On mobile it lives in the overflow menu. */}
      {!isMobile && isAdmin && draft && (
        <div
          className="rm-no-print rm-desktop-nav"
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

      {/* ---- Mobile header (<600px): title + overflow menu ---- */}
      {isMobile && (
      <header className="rm-no-print rm-mobile-header">
        <strong style={{ fontSize: fontSize.lg }}>Report Mate</strong>
        <button
          type="button"
          aria-label="More actions"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 44,
            minHeight: 44,
            border: `1px solid ${colors.onPrimary}`,
            borderRadius: radius.md,
            background: "transparent",
            color: colors.onPrimary,
            cursor: "pointer",
          }}
        >
          <MenuIcon size={22} />
        </button>
      </header>
      )}

      {/* Mobile overflow menu: logout + admin preview (kept out of the tab bar
          so the bar stays uncluttered). */}
      {isMobile && menuOpen && (
        <div className="rm-no-print rm-mobile-menu" role="menu">
          {isAdmin && draft && (
            <button
              type="button"
              role="menuitem"
              className="rm-mobile-menu__item"
              onClick={previewDraft}
            >
              <TemplatesIcon size={20} />
              Preview builder template
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="rm-mobile-menu__item"
            onClick={handleLogout}
            disabled={isLoggingOut}
            style={{ color: colors.dangerText, cursor: isLoggingOut ? "wait" : "pointer" }}
          >
            <LogoutIcon size={20} />
            {isLoggingOut ? "Logging out…" : "Logout"}
          </button>
        </div>
      )}

      <Outlet />

      {/* ---- Mobile bottom tab bar (<600px) ---- */}
      {isMobile && (
        <nav aria-label="Primary" className="rm-no-print rm-bottom-nav">
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              state={navStateFor(to)}
              className="rm-bottom-nav__tab"
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
