import { Navigate, useLocation } from "react-router-dom";
import { frontendConfig } from "../../config/env";
import { ROUTES } from "../../config/routes";
import { useTemplateDraft } from "../../contexts/TemplateDraftContext";
import { isReportPreviewNavigation } from "../../routing/navigationState";
import { ReportEditorPage } from "./ReportEditorPage";

export function ReportEditorRoute() {
  const location = useLocation();
  const { draft } = useTemplateDraft();
  const shouldPreviewDraft =
    draft !== null && isReportPreviewNavigation(location.state);

  if (!shouldPreviewDraft) {
    return frontendConfig.authMode === "api"
      ? <Navigate to={ROUTES.dashboard} replace />
      : <ReportEditorPage />;
  }

  return <ReportEditorPage externalSchema={draft.schema} externalName={draft.name} />;
}
