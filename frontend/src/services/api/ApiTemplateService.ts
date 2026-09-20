import {
  ApiAuthorizationError,
  ApiError,
  ApiValidationError,
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "../../api/templates";
import type {
  TemplateRecord,
  TemplateService,
  TemplateSummary,
  TemplateWriteInput,
} from "../contracts";
import { ServiceError, TemplateValidationError } from "../errors";

export class ApiTemplateService implements TemplateService {
  list(): Promise<TemplateSummary[]> {
    return this.mapErrors(() => listTemplates());
  }

  get(id: string): Promise<TemplateRecord> {
    return this.mapErrors(() => getTemplate(id));
  }

  create(input: TemplateWriteInput): Promise<TemplateRecord> {
    return this.mapErrors(() => createTemplate(input));
  }

  update(id: string, input: TemplateWriteInput): Promise<TemplateRecord> {
    return this.mapErrors(() => updateTemplate(id, input));
  }

  private async mapErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ApiValidationError) {
        throw new TemplateValidationError(error.message, error.elementId);
      }
      if (error instanceof ApiAuthorizationError) {
        throw new ServiceError({
          code: "forbidden",
          message: error.message,
          status: 403,
        });
      }
      if (error instanceof ApiError) {
        throw new ServiceError({
          code: error.status === 404 ? "not_found" : "internal_error",
          message: error.message,
          status: error.status,
        });
      }
      throw error;
    }
  }
}
