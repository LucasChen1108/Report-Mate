// RequireRoleRoute — the routing-aware wrapper around the RequireRole guard.
//
// components/RequireRole.tsx is presentational on purpose: it takes a plain
// `role` prop and knows nothing about auth or routing, which keeps it trivially
// testable. Its header comment asks for exactly this file — "once the auth
// context lands, a thin wrapper can read the role from context and pass it
// here". This is that wrapper, and it stays thin: it reads the role from
// useAuth(), renders react-router's <Outlet /> as the guarded children, and
// delegates every authorization decision to RequireRole. No guard logic is
// reimplemented here.
//
// Used as a react-router layout route wrapping the dispatcher-only branches:
//
//   { element: <RequireRoleRoute />, children: [ /templates, /templates/new, ... ] }
//
// AUTHORITY NOTE: UX only. The backend RBAC middleware is the real boundary.

import { Outlet } from "react-router-dom";
import { RequireRole, DISPATCHER_ADMIN_ROLE } from "./RequireRole";
import { useAuth } from "../auth/AuthContext";
import { colors, fontSize, spacing } from "../styles/tokens";

export interface RequireRoleRouteProps {
  // The role required for the routes beneath this one. Defaults to
  // dispatcher-admin, which is the only guarded role today.
  requiredRole?: string;
}

export function RequireRoleRoute({
  requiredRole = DISPATCHER_ADMIN_ROLE,
}: RequireRoleRouteProps) {
  const { user, loading } = useAuth();

  // Hold the route while the session restores. Without this, the first frame
  // has `user === null`, RequireRole correctly reports "no known role yet", and
  // a signed-in dispatcher sees a flash of "access denied".
  if (loading) {
    return (
      <p
        style={{
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          padding: spacing.lg,
          fontSize: fontSize.base,
          color: colors.textMuted,
        }}
      >
        Checking access…
      </p>
    );
  }

  return (
    <RequireRole role={user?.role ?? null} requiredRole={requiredRole}>
      <Outlet />
    </RequireRole>
  );
}

export default RequireRoleRoute;
