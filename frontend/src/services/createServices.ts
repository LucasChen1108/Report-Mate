import type { FrontendConfig } from "../config/env";
import { frontendConfig } from "../config/env";
import type { ServiceBundle } from "./contracts";
import { ApiAuthService } from "./api/ApiAuthService";
import { ApiTemplateService } from "./api/ApiTemplateService";
import { ApiWorkerService } from "./api/ApiWorkerService";
import { MockAuthService } from "./mock/MockAuthService";
import {
  MockDataStore,
  type MockDataStoreOptions,
} from "./mock/MockDataStore";
import {
  MemoryStorage,
  MockSessionManager,
  type StorageLike,
} from "./mock/MockSessionManager";
import { MockTemplateService } from "./mock/MockTemplateService";
import { MockWorkerService } from "./mock/MockWorkerService";

export interface MockServiceOptions extends MockDataStoreOptions {
  storage?: StorageLike;
}

function defaultStorage(): StorageLike {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Some browser/privacy configurations disallow localStorage. Mock mode can
    // still operate for the current page using an in-memory session store.
  }
  return new MemoryStorage();
}

export function createMockServiceBundle(
  options: MockServiceOptions = {},
): ServiceBundle {
  const { storage = defaultStorage(), ...storeOptions } = options;
  const store = new MockDataStore(storeOptions);
  const sessions = new MockSessionManager(store, storage);
  return {
    auth: new MockAuthService(store, sessions),
    workers: new MockWorkerService(store, sessions),
    templates: new MockTemplateService(store),
  };
}

export function createApiServiceBundle(config: FrontendConfig): ServiceBundle {
  return {
    auth: new ApiAuthService(config.apiBaseUrl),
    workers: new ApiWorkerService(config.apiBaseUrl),
    templates: new ApiTemplateService(),
  };
}

export function createServiceBundle(
  config: FrontendConfig,
  mockOptions?: MockServiceOptions,
): ServiceBundle {
  return config.authMode === "mock"
    ? createMockServiceBundle(mockOptions)
    : createApiServiceBundle(config);
}

export const configuredServices = createServiceBundle(frontendConfig);
