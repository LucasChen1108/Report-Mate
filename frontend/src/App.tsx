import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { AppLayout } from "./components/AppLayout";
import { PublicOnlyRoute } from "./components/PublicOnlyRoute";
import { RequireAuth } from "./components/RequireAuth";
import { RequireRole } from "./components/RequireRole";
import { RoutePlaceholder } from "./components/RoutePlaceholder";
import { USER_ROLES } from "./auth/contracts";
import { ROUTES } from "./config/routes";
import { TemplateDraftProvider } from "./contexts/TemplateDraftContext";
import { LoginPage } from "./pages/Login/LoginPage";
import { RegistrationPage } from "./pages/Login/RegistrationPage";
import { ReportEditorRoute } from "./pages/ReportEditor/ReportEditorRoute";
import { TemplateBuilderRoute } from "./pages/TemplateBuilder/TemplateBuilderRoute";
import { TemplateListPage } from "./pages/TemplateList/TemplateListPage";
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
              <Route
                path={ROUTES.login}
                element={<LoginPage />}
              />
              <Route
                path={ROUTES.register}
                element={<RegistrationPage />}
              />
            </Route>

            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route
                  path={ROUTES.generateReport}
                  element={<ReportEditorRoute />}
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
                    element={
                      <RoutePlaceholder
                        title="Workers"
                        description="Worker management will be implemented in a later Stage A commit."
                      />
                    }
                  />
                </Route>

                <Route element={<RequireRole requiredRole={USER_ROLES.worker} />}>
                  <Route
                    path={ROUTES.profile}
                    element={
                      <RoutePlaceholder
                        title="My Profile"
                        description="The Worker profile will be implemented in a later Stage A commit."
                      />
                    }
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
