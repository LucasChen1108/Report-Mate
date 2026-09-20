// Frontend guards improve navigation and prevent protected UI from rendering,
// but they are not a security boundary. The backend must independently
// authenticate and authorize every protected request.

import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import type { UserRole } from "../auth/contracts";
import { ROUTES } from "../config/routes";
import type { AuthRedirectState } from "../routing/authNavigation";
import { getRoleLandingRoute } from "../routing/authNavigation";
import { AuthLoadingState } from "./RequireAuth";

export interface RequireRoleProps {
  requiredRole: UserRole;
  children?: ReactNode;
}

export function RequireRole({ requiredRole, children }: RequireRoleProps) {
  const { user, isRestoring } = useAuth();
  const location = useLocation();

  if (isRestoring) return <AuthLoadingState />;

  if (!user) {
    const state: AuthRedirectState = {
      from: {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
    };
    return <Navigate to={ROUTES.login} replace state={state} />;
  }

  if (user.role !== requiredRole) {
    return <Navigate to={getRoleLandingRoute(user.role)} replace />;
  }

  return children === undefined ? <Outlet /> : <>{children}</>;
}

export default RequireRole;
