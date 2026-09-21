/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy /api to the Go server so the frontend calls same-origin paths in
    // dev and the backend never needs CORS configured. api/client.ts leaves
    // BASE_URL empty by default, which makes every request land here.
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
  },
});
