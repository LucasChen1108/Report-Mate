import type {
  TemplateRecord,
  TemplateService,
  TemplateSummary,
  TemplateWriteInput,
} from "../contracts";
import { ServiceError, TemplateValidationError } from "../errors";
import { MockDataStore } from "./MockDataStore";

export class MockTemplateService implements TemplateService {
  constructor(private readonly store: MockDataStore) {}

  async list(): Promise<TemplateSummary[]> {
    return this.store.listTemplates().map(({ schema: _schema, createdAt: _createdAt, ...summary }) => summary);
  }

  async get(id: string): Promise<TemplateRecord> {
    const record = this.store.findTemplate(id);
    if (!record) {
      throw new ServiceError({
        code: "not_found",
        message: "Template not found.",
        status: 404,
      });
    }
    return record;
  }

  async create(input: TemplateWriteInput): Promise<TemplateRecord> {
    const normalized = this.validate(input);
    return this.store.createTemplate(normalized);
  }

  async update(
    id: string,
    input: TemplateWriteInput,
  ): Promise<TemplateRecord> {
    const normalized = this.validate(input);
    const record = this.store.updateTemplate(id, normalized);
    if (!record) {
      throw new ServiceError({
        code: "not_found",
        message: "Template not found.",
        status: 404,
      });
    }
    return record;
  }

  private validate(input: TemplateWriteInput): TemplateWriteInput {
    const name = input.name.trim();
    if (!name) throw new TemplateValidationError("Template name is required.");
    if (input.schema.version !== 1 || input.schema.sections.length === 0) {
      throw new TemplateValidationError(
        "A template must contain at least one section.",
      );
    }
    return { name, schema: input.schema };
  }
}
