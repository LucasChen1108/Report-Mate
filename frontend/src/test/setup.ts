import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom does not implement matchMedia. The navigation shell (useIsMobile) calls
// it to choose the desktop vs mobile nav. Default every query to "does not
// match", so tests render the desktop top nav (the layout the existing
// nav-structure assertions were written against) and the DOM carries exactly
// one set of nav links.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom does not implement canvas drawing. Signature controls already tolerate
// a missing context, so keep route tests quiet without emulating canvas APIs.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: vi.fn(() => null),
});
