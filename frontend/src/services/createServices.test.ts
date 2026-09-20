import { describe, expect, it } from "vitest";
import { ApiAuthService } from "./api/ApiAuthService";
import { ApiTemplateService } from "./api/ApiTemplateService";
import { ApiWorkerService } from "./api/ApiWorkerService";
import { createServiceBundle } from "./createServices";
import { MockAuthService } from "./mock/MockAuthService";
import { MemoryStorage } from "./mock/MockSessionManager";
import { MockTemplateService } from "./mock/MockTemplateService";
import { MockWorkerService } from "./mock/MockWorkerService";

describe("service composition", () => {
  it("selects one shared mock adapter family", () => {
    const services = createServiceBundle(
      { authMode: "mock", apiBaseUrl: "http://example.test" },
      { storage: new MemoryStorage() },
    );
    expect(services.auth).toBeInstanceOf(MockAuthService);
    expect(services.workers).toBeInstanceOf(MockWorkerService);
    expect(services.templates).toBeInstanceOf(MockTemplateService);
  });

  it("selects the API adapter family", () => {
    const services = createServiceBundle({
      authMode: "api",
      apiBaseUrl: "http://example.test",
    });
    expect(services.auth).toBeInstanceOf(ApiAuthService);
    expect(services.workers).toBeInstanceOf(ApiWorkerService);
    expect(services.templates).toBeInstanceOf(ApiTemplateService);
  });
});
