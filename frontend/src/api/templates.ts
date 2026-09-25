import { endpointBuilders, API_ENDPOINTS } from "../config/endpoints";
import type {
  TemplateRecord,
  TemplateSummary,
  TemplateWriteInput,
} from "../services/contracts";
import { request } from "./client";

export {
  ApiAuthorizationError,
  ApiError,
  ApiValidationError,
} from "./client";
export type { ValidationError } from "./client";
export type { TemplateRecord, TemplateSummary } from "../services/contracts";

export function listTemplates(): Promise<TemplateSummary[]> {
  return request<TemplateSummary[]>("GET", API_ENDPOINTS.templates);
}

export function getTemplate(id: string): Promise<TemplateRecord> {
  return request<TemplateRecord>("GET", endpointBuilders.template(id));
}

export function createTemplate(input: TemplateWriteInput): Promise<TemplateRecord> {
  return request<TemplateRecord>("POST", API_ENDPOINTS.templates, input);
}

export function updateTemplate(
  id: string,
  input: TemplateWriteInput,
): Promise<TemplateRecord> {
  return request<TemplateRecord>("PUT", endpointBuilders.template(id), input);
}
