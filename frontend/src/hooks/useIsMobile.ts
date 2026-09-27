// useIsMobile — reports whether the viewport is a phone (< the `sm` breakpoint).
//
// The navigation shell renders EITHER the desktop top nav OR the mobile bottom
// bar, never both, so the DOM has exactly one set of nav links (important for
// assistive tech and for tests that query links by role). CSS alone would keep
// both in the DOM and only hide one visually, so the choice is made here in JS
// via matchMedia and the matching nav is the only one rendered.
//
// SSR/test note: matchMedia may be absent (jsdom polyfills it in test setup).
// When unavailable we default to false (desktop), the safe default for the
// existing desktop-oriented tests and for any non-browser render.

import { useEffect, useState } from "react";
import { breakpoints } from "../styles/tokens";

// Phones are strictly below the `sm` (600px) breakpoint; >= sm is the tablet/
// desktop top-nav layout.
const MOBILE_QUERY = `(max-width: ${breakpoints.sm - 0.02}px)`;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange(); // sync in case it changed between render and effect
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
