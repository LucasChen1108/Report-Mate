import { useLocation } from "react-router-dom";
import { useTemplateDraft } from "../../contexts/TemplateDraftContext";
import { isReportPreviewNavigation } from "../../routing/navigationState";
import { ReportEditorPage } from "./ReportEditorPage";

export function ReportEditorRoute() {
  const location = useLocation();
  const { draft } = useTemplateDraft();
  const shouldPreviewDraft =
    draft !== null && isReportPreviewNavigation(location.state);

  return (
    <ReportEditorPage
      externalSchema={shouldPreviewDraft ? draft.schema : undefined}
      externalName={shouldPreviewDraft ? draft.name : undefined}
    />
  );
}
