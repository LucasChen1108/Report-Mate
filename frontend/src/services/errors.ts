import type {
  ServiceErrorCode,
  ServiceErrorShape,
} from "../auth/contracts";

export class ServiceError extends Error implements ServiceErrorShape {
  readonly code: ServiceErrorCode;
  readonly field?: string;
  readonly status?: number;

  constructor(shape: ServiceErrorShape) {
    super(shape.message);
    this.name = "ServiceError";
    this.code = shape.code;
    this.field = shape.field;
    this.status = shape.status;
    Object.setPrototypeOf(this, ServiceError.prototype);
  }
}

export class TemplateValidationError extends ServiceError {
  readonly elementId: string | null;

  constructor(message: string, elementId: string | null = null) {
    super({
      code: "validation_error",
      message,
      status: 422,
    });
    this.name = "TemplateValidationError";
    this.elementId = elementId;
    Object.setPrototypeOf(this, TemplateValidationError.prototype);
  }
}

export function isServiceError(value: unknown): value is ServiceError {
  return value instanceof ServiceError;
}
