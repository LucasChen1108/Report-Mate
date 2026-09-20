// App — the top-level shell: auth provider + router.
//
// SCOPE (task 11.3): this file owns the route table and the persistent nav, and
// nothing else. It replaces the earlier two-tab shell that manually switched
// between the Builder and the Renderer.
//
// The structure is fixed so four agents can extend it in parallel without
// colliding:
//
//   <AuthProvider>            — session state, read by the nav and the guards
//     <RouterProvider>        — the route table below
//       <AppLayout>           — persistent nav + <Outlet />
//         /login              — the only route outside the gate
//         <RequireAuth>       — everything else: signed in, or sent to /login
//           <RequireRoleRoute>  — /templates*: dispatcher-admin only
//
// ROUTE OWNERSHIP (each route's page belongs to one agent; this table does not):
//   /login                              auth agent
//   /dashboard, /dashboard/templates/:id  dashboard agent
//   /templates*                         template builder (already built)
//   /reports*                           renderer agent
//
// WHY WRAPPERS: the three built pages (TemplateList, TemplateBuilder,
// ReportEditor) predate the router and take callbacks/initial props rather than
// reading route params. src/routes/* bridges that, so those pages stay
// untouched — see each wrapper's header for the specifics.
//
// DROPPED ON PURPOSE: the old shell's "Preview builder template in renderer"
// action, which piped the Builder's live schema into the Renderer in memory.
// That was a no-backend scaffold; the Builder now persists templates and the
// Renderer loads them by id.

import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./components/RequireAuth";
import { RequireRoleRoute } from "./components/RequireRoleRoute";
import { AppLayout } from "./routes/AppLayout";
import { TemplateListRoute } from "./routes/TemplateListRoute";
import { TemplateBuilderRoute } from "./routes/TemplateBuilderRoute";
import { ReportEditorRoute } from "./routes/ReportEditorRoute";
import { DashboardPage } from "./pages/Dashboard/DashboardPage";
import { TemplateReportsPage } from "./pages/Dashboard/TemplateReportsPage";
import { LoginPage } from "./pages/Login/LoginPage";

const router = createBrowserRouter([
  {
    // The layout route: persistent nav + <Outlet />. Every route sits under it,
    // including /login, so the app is never a dead end.
    element: <AppLayout />,
    children: [
      // /login is the ONE route outside the auth gate. It sits as a sibling of
      // <RequireAuth /> rather than inside it, because a route that redirects
      // the signed-out to /login cannot also contain /login.
      { path: "login", element: <LoginPage /> },

      {
        // The AUTHENTICATION gate. Everything below it requires a session;
        // a signed-out visitor is sent to /login carrying where they were
        // headed, and gets there after signing in. Declared ONCE, as a
        // pathless layout route, so a route added later is gated by
        // construction rather than by the author remembering to gate it.
        //
        // This is a DIFFERENT question from the role gate nested inside it —
        // see components/RequireAuth.tsx for why the two do not merge.
        element: <RequireAuth />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },

          { path: "dashboard", element: <DashboardPage /> },
          { path: "dashboard/templates/:templateId", element: <TemplateReportsPage /> },

          {
            // Dispatcher-admin only (Req 6.1, 6.2). A pathless layout route so
            // the guard is declared ONCE for the whole template-management
            // branch rather than repeated per route — a new /templates/* route
            // added later is guarded by construction.
            element: <RequireRoleRoute />,
            children: [
              { path: "templates", element: <TemplateListRoute /> },
              { path: "templates/new", element: <TemplateBuilderRoute /> },
              { path: "templates/:templateId/edit", element: <TemplateBuilderRoute /> },
            ],
          },

          // Report fill surface — open to technicians and dispatchers alike.
          // /reports/new reads ?templateId=; /reports/:reportId loads a saved one.
          { path: "reports/new", element: <ReportEditorRoute /> },
          { path: "reports/:reportId", element: <ReportEditorRoute /> },

          // Unknown path -> the landing screen, rather than a blank router
          // error. Inside the gate, so an unknown path while signed out lands
          // on /login rather than briefly rendering the dashboard.
          { path: "*", element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
]);

function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

export default App;
