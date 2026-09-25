import type { TemplateRecord } from "../services/contracts";

export interface TemplateEditNavigationState {
  template: TemplateRecord;
}

export interface ReportPreviewNavigationState {
  previewTemplateDraft: true;
}

export function getNavigatedTemplate(
  state: unknown,
  expectedId: string,
): TemplateRecord | null {
  if (typeof state !== "object" || state === null || !("template" in state)) {
    return null;
  }

  const template = (state as { template?: unknown }).template;
  if (typeof template !== "object" || template === null) {
    return null;
  }

  return (template as TemplateRecord).id === expectedId
    ? (template as TemplateRecord)
    : null;
}

export function isReportPreviewNavigation(
  state: unknown,
): state is ReportPreviewNavigationState {
  return (
    typeof state === "object" &&
    state !== null &&
    "previewTemplateDraft" in state &&
    (state as { previewTemplateDraft?: unknown }).previewTemplateDraft === true
  );
}
