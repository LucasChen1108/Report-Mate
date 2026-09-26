import { useLocation } from "react-router-dom";
import { useTemplateDraft } from "../../contexts/TemplateDraftContext";
import { isReportPreviewNavigation } from "../../routing/navigationState";
import { ReportEditorPage } from "./ReportEditorPage";

export function ReportEditorRoute() {
  const location = useLocation();
  const { draft } = useTemplateDraft();
  const shouldPreviewDraft =
    draft !== null && isReportPreviewNavigation(location.state);

  // No builder draft to preview: open the report editor's seed-fixture harness
  // so Generate Report always lands on an editor (option b), rather than
  // redirecting away. This is the same fixture experience in both auth modes.
  if (!shouldPreviewDraft) {
    return <ReportEditorPage />;
  }

  return <ReportEditorPage externalSchema={draft.schema} externalName={draft.name} />;
}
