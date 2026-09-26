/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ".", "");
  if (mode === "production" && environment.VITE_AUTH_MODE !== "api") {
    throw new Error(
      'Production builds require VITE_AUTH_MODE="api"; mock accounts are development-only.',
    );
  }

  return {
    plugins: [react()],
    server: {
      // Proxy both public auth and protected API paths so cookie sessions remain
      // same-origin during local development.
      proxy: {
        "/api": "http://localhost:8080",
        "/auth": "http://localhost:8080",
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      // Pin the auth mode for tests to the deterministic mock default. Without
      // this, a developer's local .env.local (which may set VITE_AUTH_MODE=api
      // to point the dev server at the real backend) would leak into the test
      // run and change routing behaviour (e.g. /generate-report redirects to the
      // dashboard in api mode), breaking tests that assume the mock experience.
      env: {
        VITE_AUTH_MODE: "mock",
        VITE_API_BASE_URL: "",
      },
    },
  };
});
