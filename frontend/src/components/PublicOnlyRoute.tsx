import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { getPostLoginRoute } from "../routing/authNavigation";
import { AuthLoadingState } from "./RequireAuth";

export function PublicOnlyRoute() {
  const { user, isRestoring } = useAuth();
  const location = useLocation();

  if (isRestoring) return <AuthLoadingState />;
  if (user) {
    return (
      <Navigate
        to={getPostLoginRoute(location.state, user.role)}
        replace
      />
    );
  }

  return <Outlet />;
}
