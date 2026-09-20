// RequireRole — a reusable frontend RBAC route guard (Req 6.2).
//
// PURPOSE: prevent a non-dispatcher-admin from reaching guarded content such as
// the Template Builder route. When the current user's role matches the required
// role, the guard renders its children; otherwise it renders a fallback (an
// "access denied" message by default, or invokes an optional redirect callback).
//
// AUTHORITY NOTE: this is a UX layer only. The backend RBAC middleware
// (`RequireRole("dispatcher_admin")`, already implemented) is the authoritative
// check — it rejects unauthorized `report_templates` writes with a 403 (Req 6.1,
// 6.3). This guard simply keeps technicians from seeing a page they cannot use;
// it is not a security boundary on its own.
//
// INTEGRATION NOTE: the app has no auth/routing system yet (owned by another
// teammate). To stay integration-ready and self-contained, the guard takes the
// canonical role via a typed prop rather than reaching into a context. Once the
// auth context lands, a thin wrapper can read the role from context and pass it
// here (e.g. `<RequireRole role={auth.user?.role} requiredRole="dispatcher_admin">`).
//
// Styling is minimal with large, readable tap targets (>=44px); full styling is
// a later task.

import type { CSSProperties, ReactNode } from "react";
import { USER_ROLES } from "../auth/contracts";
import type { UserRole } from "../auth/contracts";

// The canonical dispatcher-admin role string. Kept identical to the backend
// (`RequireRole("dispatcher_admin")`) so the UX guard and the authoritative
// backend check agree on the role name.
export const DISPATCHER_ADMIN_ROLE = USER_ROLES.admin;

export interface RequireRoleProps {
  // The current user's role. `null` (or undefined) means "no known role yet"
  // — e.g. before the auth context has loaded — and is treated as unauthorized.
  // The real auth context will supply this value later.
  role: UserRole | null | undefined;
  // The role required to view the guarded content, e.g. "dispatcher_admin".
  requiredRole: UserRole;
  // The guarded content, rendered only when `role === requiredRole`.
  children: ReactNode;
  // What to render when the user is not authorized. Defaults to a simple,
  // readable "access denied" message.
  fallback?: ReactNode;
  // Optional redirect callback invoked (as a side effect during render) when the
  // user is not authorized — e.g. to navigate away from the guarded route once a
  // router exists. When provided, it runs in addition to rendering `fallback`.
  onUnauthorized?: () => void;
}

const messageStyle: CSSProperties = {
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  padding: "16px",
  fontSize: 16,
  lineHeight: 1.5,
  color: "#c0392b",
};

// The default fallback: a plain, readable not-authorized message.
const defaultFallback: ReactNode = (
  <p role="alert" data-testid="require-role-denied" style={messageStyle}>
    You do not have access to this page.
  </p>
);

// RequireRole renders `children` only when the current role matches the required
// role; otherwise it renders `fallback` (and invokes `onUnauthorized` if given).
export function RequireRole({
  role,
  requiredRole,
  children,
  fallback = defaultFallback,
  onUnauthorized,
}: RequireRoleProps) {
  const authorized = role !== null && role === requiredRole;

  if (!authorized) {
    // Fire the optional redirect side effect. Guarded here (not in an effect)
    // so callers without a router still just see the fallback.
    onUnauthorized?.();
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

export default RequireRole;
