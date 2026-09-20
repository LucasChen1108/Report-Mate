import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RoutePlaceholder } from "./components/RoutePlaceholder";
import { ROUTES } from "./config/routes";
import { TemplateDraftProvider } from "./contexts/TemplateDraftContext";
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
      <TemplateDraftProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route
              path={ROUTES.root}
              element={<Navigate to={ROUTES.templates} replace />}
            />
            <Route path={ROUTES.templates} element={<TemplateListPage />} />
            <Route
              path={ROUTES.newTemplate}
              element={<TemplateBuilderRoute mode="new" />}
            />
            <Route
              path={ROUTES.templateDetail}
              element={<TemplateBuilderRoute mode="edit" />}
            />
            <Route
              path={ROUTES.generateReport}
              element={<ReportEditorRoute />}
            />
            <Route
              path={ROUTES.login}
              element={
                <RoutePlaceholder
                  title="Login"
                  description="Authentication will be implemented in a later Stage A commit."
                />
              }
            />
            <Route
              path={ROUTES.register}
              element={
                <RoutePlaceholder
                  title="Create account"
                  description="Account creation will be implemented in a later Stage A commit."
                />
              }
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
            <Route
              path={ROUTES.profile}
              element={
                <RoutePlaceholder
                  title="My Profile"
                  description="The Worker profile will be implemented in a later Stage A commit."
                />
              }
            />
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
          </Route>
        </Routes>
      </TemplateDraftProvider>
    </ServiceProvider>
  );
}

export default App;
