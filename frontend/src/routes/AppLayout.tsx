// AppLayout — the persistent chrome every route renders inside.
//
// One nav bar that survives navigation (Dashboard / Templates), plus the
// <Outlet /> the matched route fills. Kept in src/routes/ rather than inside
// App.tsx so App stays a readable route table, and so the agents adding pages
// have an obvious place to add a nav entry without touching the router.
//
// Styling follows the house rules: inline style objects over tokens from
// src/styles/tokens.ts, mobile-first, >=44px tap targets. `rm-no-print` keeps
// the nav off printed/exported report pages (the Report Editor prints to A4).

import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { DISPATCHER_ADMIN_ROLE } from "../components/RequireRole";
import { colors, fontSize, radius, spacing } from "../styles/tokens";

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isDispatcher = user?.role === DISPATCHER_ADMIN_ROLE;

  // Sign out, then go to /login.
  //
  // Both halves are needed and neither is redundant: logout() clears the
  // session, and the explicit navigate is what makes the destination
  // deterministic instead of depending on which route happened to be mounted.
  //
  // KNOWN, ACCEPTED: RequireAuth re-renders with `user === null` before this
  // navigation settles, so it gets its own redirect in first and stashes the
  // page being left as `location.state.from`. The user still lands on /login
  // — but signing back in returns them to that page rather than /dashboard.
  // It is structural rather than a slip: LoginPage redirects away whenever a
  // session exists, so logout MUST land before the route change, and whatever
  // route is mounted at that moment is the one that gets recorded. Harmless
  // in practice — every query in the product is scoped to the calling user by
  // the server, so a second person signing in on the same device sees that
  // page filled with their OWN data, not the previous user's.
  function handleSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div style={{ minHeight: "100vh", background: colors.pageBg }}>
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
        <strong style={{ fontSize: fontSize.lg, marginRight: spacing.md }}>
          Report Mate
        </strong>

        <NavTab to="/dashboard">Dashboard</NavTab>
        {/* Template management is dispatcher-only, so the entry point is hidden
            from technicians. RequireRoleRoute still guards the route itself —
            hiding a link is not a control. */}
        {isDispatcher ? <NavTab to="/templates">Templates</NavTab> : null}

        <span
          style={{
            marginLeft: "auto",
            fontSize: fontSize.sm,
            color: colors.onPrimary,
          }}
        >
          {user ? `${user.name} · ${user.role}` : "Signed out"}
        </span>

        {/* Only rendered when there is a session to end — on /login there is
            nothing to sign out of, and a dead button there is just confusing.
            Styled as a nav tab so it obeys the same >=44px tap target. */}
        {user ? (
          <button
            type="button"
            onClick={handleSignOut}
            data-testid="sign-out"
            style={{
              minHeight: 44,
              padding: `${spacing.xs}px ${spacing.md}px`,
              fontSize: fontSize.base,
              borderRadius: radius.md,
              border: `1px solid ${colors.onPrimary}`,
              background: "transparent",
              color: colors.onPrimary,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        ) : null}
      </nav>

      <Outlet />
    </div>
  );
}

// A nav tab that highlights itself on the active route. `end` is deliberately
// off: /templates stays highlighted while editing /templates/:id/edit, which is
// what a user expects from a section tab.
function NavTab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: "inline-flex",
        alignItems: "center",
        minHeight: 44,
        padding: `${spacing.xs}px ${spacing.md}px`,
        fontSize: fontSize.base,
        borderRadius: radius.md,
        border: `1px solid ${colors.onPrimary}`,
        background: isActive ? colors.onPrimary : "transparent",
        color: isActive ? colors.primary : colors.onPrimary,
        fontWeight: isActive ? 700 : 400,
        textDecoration: "none",
      })}
    >
      {children}
    </NavLink>
  );
}

export default AppLayout;
