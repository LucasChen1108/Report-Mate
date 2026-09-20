// RequireAuth — the AUTHENTICATION gate: are you signed in at all?
//
// NOT THE SAME THING AS RequireRole. That guard answers "is this signed-in
// user a dispatcher-admin?" and renders an access-denied message when the
// answer is no, because the user is legitimately here and simply cannot have
// this page. This one answers "is anybody signed in?" and REDIRECTS, because
// there is nothing to show a stranger and no message worth showing them.
//
// The two compose rather than overlap: /templates sits inside this gate and
// then inside RequireRoleRoute, so a signed-out visitor is bounced to /login
// and a signed-in technician gets the access-denied fallback. Neither guard
// knows about the other.
//
// GATING ON `loading` IS NOT OPTIONAL. AuthContext restores a session by
// asking GET /api/auth/me, which is a round trip. Until it answers, `user` is
// null for a user who is in fact signed in. Redirecting on that first frame
// would bounce every returning user to /login on every hard load, and then
// LoginPage would bounce them straight back once the fetch resolved — a
// visible flash of the login form on every refresh. So: hold the route while
// loading, decide after.
//
// WHERE THEY CAME FROM. The attempted location is handed to /login as
// `location.state.from`, which LoginPage already reads and redirects to after
// a successful sign-in. The WHOLE location goes in, not just the pathname:
// the dashboard keeps its filters and its ?highlight= in the query string
// (see pages/Dashboard/useDashboard.ts), so dropping the search would turn a
// shared "the drafts from last week" link into a bare, unfiltered page.
//
// AUTHORITY NOTE: like every guard in this folder, UX only. The backend
// answers 401 to an unauthenticated request whatever the router does.

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { colors, fontSize, spacing } from "../styles/tokens";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // Same shape as RequireRoleRoute's holding state, so the two guards
    // stacked on /templates do not produce two differently-styled flashes.
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
        Checking your session…
      </p>
    );
  }

  if (!user) {
    // `replace` so the back button does not land on the page that just
    // bounced them, which would bounce them again.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export default RequireAuth;
