import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { ROUTES } from "../config/routes";
import type { AuthRedirectState } from "../routing/authNavigation";

export function AuthLoadingState() {
  return (
    <main className="rm-page">
      <p role="status" aria-live="polite">
        Checking your session…
      </p>
    </main>
  );
}

export function RequireAuth() {
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

  return <Outlet />;
}
