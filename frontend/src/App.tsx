import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { USER_ROLES } from "./auth/contracts";
import { AppLayout } from "./components/AppLayout";
import { PublicOnlyRoute } from "./components/PublicOnlyRoute";
import { RequireAuth } from "./components/RequireAuth";
import { RequireRole } from "./components/RequireRole";
import { RoutePlaceholder } from "./components/RoutePlaceholder";
import { ROUTES } from "./config/routes";
import { TemplateDraftProvider } from "./contexts/TemplateDraftContext";
import { DashboardPage } from "./pages/Dashboard/DashboardPage";
import { TemplateReportsPage } from "./pages/Dashboard/TemplateReportsPage";
import { LoginPage } from "./pages/Login/LoginPage";
import { RegistrationPage } from "./pages/Login/RegistrationPage";
import { WorkerProfilePage } from "./pages/Profile/WorkerProfilePage";
import { ReportEditorRoute as PreviewReportEditorRoute } from "./pages/ReportEditor/ReportEditorRoute";
import { TemplateBuilderRoute } from "./pages/TemplateBuilder/TemplateBuilderRoute";
import { TemplateListPage } from "./pages/TemplateList/TemplateListPage";
import { WorkerManagementPage } from "./pages/Workers/WorkerManagementPage";
import { ReportEditorRoute as PersistedReportEditorRoute } from "./routes/ReportEditorRoute";
import type { ServiceBundle } from "./services/contracts";
import { configuredServices } from "./services/createServices";
import { ServiceProvider } from "./services/ServiceProvider";

interface AppProps {
  services?: ServiceBundle;
}

function App({ services = configuredServices }: AppProps) {
  return (
    <ServiceProvider services={services}>
      <AuthProvider>
        <TemplateDraftProvider>
          <Routes>
            <Route element={<PublicOnlyRoute />}>
              <Route
                path={ROUTES.root}
                element={<Navigate to={ROUTES.login} replace />}
              />
              <Route path={ROUTES.login} element={<LoginPage />} />
              <Route path={ROUTES.register} element={<RegistrationPage />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route
                  path={ROUTES.generateReport}
                  element={<PreviewReportEditorRoute />}
                />
                <Route path={ROUTES.dashboard} element={<DashboardPage />} />
                <Route
                  path={ROUTES.dashboardTemplate}
                  element={<TemplateReportsPage />}
                />
                <Route
                  path={ROUTES.newReport}
                  element={<PersistedReportEditorRoute />}
                />
                <Route
                  path={ROUTES.reportDetail}
                  element={<PersistedReportEditorRoute />}
                />

                <Route element={<RequireRole requiredRole={USER_ROLES.admin} />}>
                  <Route
                    path={ROUTES.templates}
                    element={<TemplateListPage />}
                  />
                  <Route
                    path={ROUTES.newTemplate}
                    element={<TemplateBuilderRoute mode="new" />}
                  />
                  <Route
                    path={ROUTES.templateDetail}
                    element={<TemplateBuilderRoute mode="edit" />}
                  />
                  <Route
                    path={ROUTES.workers}
                    element={<WorkerManagementPage />}
                  />
                </Route>

                <Route element={<RequireRole requiredRole={USER_ROLES.worker} />}>
                  <Route
                    path={ROUTES.profile}
                    element={<WorkerProfilePage />}
                  />
                </Route>
              </Route>
            </Route>

            <Route
              path="*"
              element={
                <RoutePlaceholder
                  title="Page not found"
                  description="The page you requested does not exist."
                  showHomeLink
                />
              }
            />
          </Routes>
        </TemplateDraftProvider>
      </AuthProvider>
    </ServiceProvider>
  );
}

export default App;
