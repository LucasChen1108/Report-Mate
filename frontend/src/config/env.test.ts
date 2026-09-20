import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_BASE_URL,
  parseFrontendConfig,
} from "./env";

describe("frontend configuration", () => {
  it("uses safe development defaults", () => {
    expect(parseFrontendConfig({})).toEqual({
      authMode: "mock",
      apiBaseUrl: DEFAULT_API_BASE_URL,
    });
  });

  it("parses supported values and normalizes the API base URL", () => {
    expect(parseFrontendConfig({
      VITE_AUTH_MODE: " API ",
      VITE_API_BASE_URL: " https://api.example.test/ ",
    })).toEqual({
      authMode: "api",
      apiBaseUrl: "https://api.example.test",
    });
  });

  it("rejects unsupported auth modes", () => {
    expect(() => parseFrontendConfig({ VITE_AUTH_MODE: "production" }))
      .toThrow(/Unsupported VITE_AUTH_MODE/);
  });
});
