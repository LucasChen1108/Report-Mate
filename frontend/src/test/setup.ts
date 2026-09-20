import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom does not implement canvas drawing. Signature controls already tolerate
// a missing context, so keep route tests quiet without emulating canvas APIs.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: vi.fn(() => null),
});
